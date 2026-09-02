/**
 * 附着面回归（2026-09-02 宿主前置第一刀）：
 * - 跳转模板与 argv 同构（三舰队：opencode/pi/codex）；
 * - opencode 事件流行捕获（ses_ 号首中即锁）+ attach-map 读写（坏 JSON 复位）；
 * - pi 会话目录编码（镜像 pi-mono getDefaultSessionDirPath，对齐本机实况）+
 *   惰性捕获（最新 .jsonl / minMtime 过滤 / 目录缺席 null）；
 * - win32 终端拉起命令构造（cmd start + /D cwd）；
 * - 召唤件三生成器 golden fixtures（tests/attach-snapshots/，含 codex 版本敏感注记）；
 * - jump 端点 dry-run（真 daemon 起服，映射命中→argv/cwd/executor 断言 + 409 缺映射）。
 * @module stardeck/tests/attach-face
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  JUMP_TEMPLATES,
  jumpArgs,
  opencodeSessionIdFromLine,
  opencodeSessionCapture,
  zcodeSessionIdFromLine,
  zcodeSessionCapture,
  detectZcodeBin,
  injectZcodeMcp,
  zcodeSummonArtifact,
  readAttachMap,
  writeAttachMapEntry,
  piSessionDirFor,
  piLatestSessionId,
  buildTerminalCommand,
  opencodeSummonArtifact,
  piSummonArtifact,
  codexSummonArtifact,
  claudePrintArgs,
  claudeSessionIdFromLine,
  claudeSessionCapture,
  detectClaudeBin,
  detectGeminiBin,
  geminiPrintArgs,
  injectGeminiMcp,
  claudeSummonArtifact,
  geminiSummonArtifact,
  qwenPrintArgs,
  detectQwenBin,
  injectQwenMcp,
  qwenSummonArtifact,
} from '../src/executor.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const BOARD = 'http://127.0.0.1:3970'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'stardeck-attach-'))
}

test('附着面：跳转模板与 argv 同构（三舰队）', () => {
  for (const executor of ['opencode', 'pi', 'codex']) {
    const argv = jumpArgs(executor, 'XID')
    assert.equal(argv.join(' '), JUMP_TEMPLATES[executor]!.replace('<会话号>', 'XID'))
    assert.ok(argv.includes('XID'))
  }
  assert.equal(jumpArgs('opencode', 'ses_1').join(' '), 'opencode --session ses_1')
  assert.equal(jumpArgs('pi', 'abc').join(' '), 'pi --session abc')
  assert.equal(jumpArgs('codex', 's-9').join(' '), 'codex resume s-9')
})

test('附着面：opencode 事件流行捕获——首中 ses_ 即写映射并闭锁', () => {
  const dir = tmpDir()
  try {
    assert.equal(opencodeSessionIdFromLine('{"type":"text","sessionID":"ses_fa1d08c46ffeFuEhrOi2aAr2rE"}'), 'ses_fa1d08c46ffeFuEhrOi2aAr2rE')
    assert.equal(opencodeSessionIdFromLine('no session here'), null)
    assert.equal(opencodeSessionIdFromLine('"id":"prt_05e2fa29e001WtGF7T6clggMX4"'), null) // part id 不是会话号
    const capture = opencodeSessionCapture({ stateDir: dir, taskId: 't1', workspacePath: 'C:\\ws' })
    capture('garbage line')
    assert.deepEqual(readAttachMap(dir)['t1'], undefined)
    capture('{"sessionID":"ses_first001"}')
    capture('{"sessionID":"ses_second02"}')
    const map = readAttachMap(dir)
    assert.equal(map['t1']?.sessionId, 'ses_first001')
    assert.equal(map['t1']?.executor, 'opencode')
    assert.equal(map['t1']?.workspacePath, 'C:\\ws')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('附着面：attach-map 读写往返 + 坏 JSON 复位为空表', () => {
  const dir = tmpDir()
  try {
    writeAttachMapEntry(dir, 't-a', { executor: 'opencode', sessionId: 'ses_a', workspacePath: 'C:\\a', capturedAt: '2026-09-02T00:00:00Z' })
    writeAttachMapEntry(dir, 't-b', { executor: 'pi', sessionId: 'p1', workspacePath: 'C:\\b', capturedAt: '2026-09-02T00:00:01Z' })
    const map = readAttachMap(dir)
    assert.equal(map['t-a']?.sessionId, 'ses_a')
    assert.equal(map['t-b']?.sessionId, 'p1')
    writeFileSync(join(dir, 'attach-map.json'), '{broken json', 'utf8')
    assert.deepEqual(readAttachMap(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('附着面：pi 会话目录编码对齐本机实况 + 惰性捕获最新会话', () => {
  // 实况对照：20260901-231703-69f0 任务的真实 pi 会话目录名（本机 ~/.pi/agent/sessions/）。
  const agentDir = tmpDir()
  try {
    const ws = 'C:\\Users\\tester\\.stardeck\\tasks\\tasks\\20260901-231703-69f0'
    const dir = piSessionDirFor(ws, agentDir)
    assert.equal(dir, join(agentDir, 'sessions', '--C--Users-tester-.stardeck-tasks-tasks-20260901-231703-69f0--'))
    assert.equal(piLatestSessionId(dir), null) // 目录缺席 → null
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '20260901_120000_11111111-1111-1111-1111-111111111111.jsonl'), '{}\n')
    writeFileSync(join(dir, '20260901_130000_22222222-2222-2222-2222-222222222222.jsonl'), '{}\n')
    assert.equal(piLatestSessionId(dir), '22222222-2222-2222-2222-222222222222')
    // minMtime 过滤：新文件被压回阈值之下后只认旧文件（或全灭）。
    const oldFile = join(dir, '20260901_120000_11111111-1111-1111-1111-111111111111.jsonl')
    const past = Date.now() / 1000 - 3600
    utimesSync(oldFile, past, past)
    assert.equal(piLatestSessionId(dir, Date.now() + 60000), null)
    assert.equal(piLatestSessionId(dir, past - 10), '22222222-2222-2222-2222-222222222222')
  } finally {
    rmSync(agentDir, { recursive: true, force: true })
  }
})

test('附着面：win32 终端拉起命令构造（cmd start + /D cwd）', () => {
  if (process.platform !== 'win32') return // 非 win32 契约面抛教学错误，此处只测 win32 实弹
  const t = buildTerminalCommand('C:\\foo bar', jumpArgs('opencode', 'ses_x'))
  assert.equal(t.file, 'cmd.exe')
  // 无标题位：裸 'stardeck' 会被 start 当程序名（首弹「找不到文件」实测）；
  // 首参裸名 node 无引号，不存在标题吞噬，/D 携 cwd 后接命令。
  assert.deepEqual(t.args, ['/c', 'start', '/D', 'C:\\foo bar', 'opencode', '--session', 'ses_x'])
  // keepOpen（zcode 汇报模式）：cmd /k 包裹——跑完留屏
  assert.deepEqual(buildTerminalCommand('C:\\w', ['node', 'x'], true).args, ['/c', 'start', '/D', 'C:\\w', 'cmd', '/k', 'node', 'x'])
  // 非 win32 分支抛教学错误（契约面）——本机即 win32，无法在此实测该分支。
})

test('附着面：zcode 舰队——跳转/会话捕获/工具面注入', () => {
  // 跳转：node + 探测到的 zcode.cjs 绝对路径（引擎无 PATH 裸名）+ 视察汇报
  //（zcode 无独立 TUI 分发——@zcode/tui 仅内嵌 SEA 形态、公开 npm 无包，
//  官网仅桌面安装包——秒退实测 → 无头汇报降级，cmd /k 留屏）
  const argv = jumpArgs('zcode', 'sess_x9')
  assert.equal(argv[0], 'node')
  assert.equal(argv[2], '--resume')
  assert.equal(argv[3], 'sess_x9')
  assert.equal(argv[4], '--prompt')
  assert.ok(argv[5]!.includes('视察'))
  assert.equal(argv[6], '--json')
  if (process.platform === 'win32') assert.ok(argv[1]!.endsWith('zcode.cjs'))
  assert.ok(JUMP_TEMPLATES.zcode.includes('--resume <会话号> --prompt <视察汇报>'))
  // 会话行捕获：--json 尾包字段（0.16.5 实测）
  assert.equal(zcodeSessionIdFromLine('  "sessionId": "sess_bb7f187e-e2e7-4ed7-9e69-03ccf942a371",'), 'sess_bb7f187e-e2e7-4ed7-9e69-03ccf942a371')
  assert.equal(zcodeSessionIdFromLine('"response": "收到"'), null)
  const dir = tmpDir()
  try {
    const capture = zcodeSessionCapture({ stateDir: dir, taskId: 'tz', workspacePath: 'C:\\ws' })
    capture('noise')
    assert.equal(readAttachMap(dir)['tz'], undefined)
    capture('"sessionId": "sess_ok0001"')
    assert.equal(readAttachMap(dir)['tz']?.sessionId, 'sess_ok0001')
    assert.equal(readAttachMap(dir)['tz']?.executor, 'zcode')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // 工具面注入：全新工作区直写 .mcp.json（stdio 桥）+ bound 合并 + 首动备份
  const ws = tmpDir()
  try {
    injectZcodeMcp(ws, { http: 'http://127.0.0.1:3970', agentId: 'zc-t1' })
    const cfg = JSON.parse(readFileSync(join(ws, '.mcp.json'), 'utf8')) as Record<string, any>
    assert.equal(cfg.mcpServers.stardeck.type, 'stdio')
    assert.equal(cfg.mcpServers.stardeck.env.STARDECK_AGENT, 'zc-t1')
    assert.ok(cfg.mcpServers.stardeck.args[0].endsWith('mcp-bridge.mjs'))
    const userCfg = { mcpServers: { other: { type: 'stdio', command: 'x' } }, custom: 1 }
    writeFileSync(join(ws, '.mcp.json'), JSON.stringify(userCfg), 'utf8')
    injectZcodeMcp(ws, { http: 'http://127.0.0.1:3970', agentId: 'zc-t2' })
    const merged = JSON.parse(readFileSync(join(ws, '.mcp.json'), 'utf8')) as Record<string, any>
    assert.equal(merged.custom, 1)
    assert.ok(merged.mcpServers.other)
    assert.ok(merged.mcpServers.stardeck)
    assert.ok(readFileSync(join(ws, '.stardeck', 'mcp.json.pre-stardeck'), 'utf8').includes('other'))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
  if (process.platform === 'win32') assert.ok(detectZcodeBin('').endsWith('zcode.cjs'))
  const zc = zcodeSummonArtifact({ boardUrl: BOARD })
  assert.equal(zc.relativePath, 'skills/stardeck/SKILL.md')
  assert.ok(zc.content.includes('--resume <会话号> --prompt <视察汇报>') || zc.content.includes('zcode'))
  assert.equal(zc.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'zcode-stardeck.md'), 'utf8'))
})

test('附着面：召唤件三生成器 golden fixtures（含 codex 版本敏感注记）', () => {
  const oc = opencodeSummonArtifact({ boardUrl: BOARD })
  assert.equal(oc.relativePath, '.opencode/command/stardeck.md')
  assert.ok(oc.content.includes(`curl -s -o /dev/null -w "%{http_code}" ${BOARD}/warroom/api/board`))
  assert.ok(oc.content.includes('不要伪造成功'))
  const pi = piSummonArtifact({ boardUrl: BOARD })
  assert.equal(pi.relativePath, '.pi/extensions/stardeck-summon.ts')
  assert.ok(pi.content.includes('pi.registerCommand("stardeck"'))
  assert.ok(pi.content.includes(JUMP_TEMPLATES.pi)) // 召唤件与跳转面同构（舰长口径）
  const cx = codexSummonArtifact({ boardUrl: BOARD })
  assert.equal(cx.relativePath, 'prompts/stardeck.md')
  assert.ok(cx.content.includes(JUMP_TEMPLATES.codex))
  assert.ok(cx.content.includes('#15939'))
  assert.ok(cx.content.includes('版本敏感'))
  // golden 对照（逐字）
  assert.equal(oc.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'opencode-stardeck.md'), 'utf8'))
  assert.equal(pi.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'pi-stardeck-summon.ts'), 'utf8'))
  assert.equal(cx.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'codex-stardeck.md'), 'utf8'))
})

test('附着面：claude/gemini 两席全件（argv/捕获/注入/跳转/召唤/探测）', () => {
  // argv：claude -p --output-format json --dangerously-skip-permissions（无头
  // 免批——默认权限模式拒一切工具，首弹实测）；gemini -p（0.58 无 json 面）。
  assert.deepEqual(claudePrintArgs({ model: '', prompt: 'go' }), ['-p', 'go', '--output-format', 'json', '--dangerously-skip-permissions'])
  assert.deepEqual(claudePrintArgs({ model: 'glm-5.2', prompt: 'go' }), ['--model', 'glm-5.2', '-p', 'go', '--output-format', 'json', '--dangerously-skip-permissions'])
  assert.deepEqual(geminiPrintArgs({ model: '', prompt: 'go' }), ['-p', 'go'])
  assert.deepEqual(geminiPrintArgs({ model: 'gemini-2.5-pro', prompt: 'go' }), ['-m', 'gemini-2.5-pro', '-p', 'go'])
  // 捕获：claude 尾包 session_id（uuid 形——区别于 zcode sess_ 与 opencode ses_）。
  const sid = claudeSessionIdFromLine('{"type":"result","subtype":"success","session_id":"2ea857bd-dd82-4f1a-9c3d-1a2b3c4d5e6f","result":"OK"}')
  assert.equal(sid, '2ea857bd-dd82-4f1a-9c3d-1a2b3c4d5e6f')
  assert.equal(claudeSessionIdFromLine('{"sessionID":"ses_x"}'), null) // opencode 形不认
  const capDir = tmpDir()
  const cap = claudeSessionCapture({ stateDir: capDir, taskId: 't-cl', workspacePath: capDir })
  cap('{"session_id":"11111111-2222-3333-4444-555555555555"}')
  cap('{"session_id":"99999999-2222-3333-4444-555555555555"}') // 闭锁：只认首中
  assert.equal(readAttachMap(capDir)['t-cl']!.sessionId, '11111111-2222-3333-4444-555555555555')
  // 跳转模板与 argv 同构。
  assert.deepEqual(jumpArgs('claude', 'S-1'), ['claude', '--resume', 'S-1'])
  assert.deepEqual(jumpArgs('gemini', 'S-2'), ['gemini', '--resume', 'S-2'])
  // gemini 注入：.gemini/settings.json mcpServers.stardeck（合并不动他键+坏 JSON 拒绝）。
  const gws = tmpDir()
  mkdirSync(join(gws, '.gemini'), { recursive: true })
  writeFileSync(join(gws, '.gemini', 'settings.json'), '{"theme":"dark","mcpServers":{"other":{"command":"x"}}}', 'utf8')
  injectGeminiMcp(gws, { http: 'http://h', agentId: 'a-1' })
  const gcfg = JSON.parse(readFileSync(join(gws, '.gemini', 'settings.json'), 'utf8')) as { theme: string; mcpServers: Record<string, { command: string; env: Record<string, string> }> }
  assert.equal(gcfg.theme, 'dark')
  assert.equal(gcfg.mcpServers.other!.command, 'x')
  assert.equal(gcfg.mcpServers.stardeck!.env.STARDECK_AGENT, 'a-1')
  writeFileSync(join(gws, '.gemini', 'settings.json'), '{broken', 'utf8')
  assert.throws(() => injectGeminiMcp(gws, { http: 'http://h', agentId: 'a-2' }), /拒绝覆盖/)
  // 召唤件：claude 斜杠命令 md + gemini TOML（prompt 必填——bundle 实证）。
  const cl = claudeSummonArtifact({ boardUrl: BOARD })
  assert.equal(cl.relativePath, '.claude/commands/stardeck.md')
  assert.ok(cl.content.includes(JUMP_TEMPLATES.claude))
  assert.equal(cl.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'claude-stardeck.md'), 'utf8'))
  const gm = geminiSummonArtifact({ boardUrl: BOARD })
  assert.equal(gm.relativePath, '.gemini/commands/stardeck.toml')
  assert.ok(gm.content.includes('prompt = """'))
  assert.ok(gm.content.includes(JUMP_TEMPLATES.gemini))
  assert.equal(gm.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'gemini-stardeck.toml'), 'utf8'))
  // 探测：win32 优先包内入口（claude 原生 exe / gemini JS）。
  if (process.platform === 'win32') {
    assert.ok(detectClaudeBin('').includes('claude'), `claude 探测形：${detectClaudeBin('')}`)
    assert.ok(detectGeminiBin('').endsWith('gemini.js') || detectGeminiBin('') === 'gemini')
  }
  assert.equal(detectClaudeBin('C:/custom/claude.exe'), 'C:/custom/claude.exe')
  assert.equal(detectGeminiBin('C:/custom/gemini.js'), 'C:/custom/gemini.js')
  rmSync(capDir, { recursive: true, force: true, maxRetries: 3 })
  rmSync(gws, { recursive: true, force: true, maxRetries: 3 })
})

test('附着面：qwen 席全件（argv/注入/跳转/召唤/探测；契约双证 VK+本机）', () => {
  // argv：-p 一次性 + --yolo 免批（VK qwen.rs 同款）+ --auth-type openai
  //（openai 兼容网关鉴权面；模型可选前置）。
  assert.deepEqual(qwenPrintArgs({ model: '', prompt: 'go' }), ['--auth-type', 'openai', '--yolo', '-p', 'go'])
  assert.deepEqual(qwenPrintArgs({ model: 'glm-5.2', prompt: 'go' }), ['--model', 'glm-5.2', '--auth-type', 'openai', '--yolo', '-p', 'go'])
  assert.deepEqual(jumpArgs('qwen', 'S-9'), ['qwen', '--resume', 'S-9'])
  // 注入：.qwen/settings.json mcpServers.stardeck（合并他键 + 坏 JSON 拒绝）。
  const qws = tmpDir()
  mkdirSync(join(qws, '.qwen'), { recursive: true })
  writeFileSync(join(qws, '.qwen', 'settings.json'), '{"theme":"dark","mcpServers":{"other":{"command":"x"}}}', 'utf8')
  injectQwenMcp(qws, { http: 'http://h', agentId: 'a-1' })
  const qcfg = JSON.parse(readFileSync(join(qws, '.qwen', 'settings.json'), 'utf8')) as { theme: string; mcpServers: Record<string, { command: string; env: Record<string, string> }> }
  assert.equal(qcfg.theme, 'dark')
  assert.equal(qcfg.mcpServers.other!.command, 'x')
  assert.equal(qcfg.mcpServers.stardeck!.env.STARDECK_AGENT, 'a-1')
  writeFileSync(join(qws, '.qwen', 'settings.json'), '{broken', 'utf8')
  assert.throws(() => injectQwenMcp(qws, { http: 'http://h', agentId: 'a-2' }), /拒绝覆盖/)
  // 召唤件：.qwen/commands/stardeck.toml（gemini-cli 谱系 TOML 命令面）。
  const qs = qwenSummonArtifact({ boardUrl: BOARD })
  assert.equal(qs.relativePath, '.qwen/commands/stardeck.toml')
  assert.ok(qs.content.includes('prompt = """'))
  assert.ok(qs.content.includes(JUMP_TEMPLATES.qwen))
  assert.equal(qs.content, readFileSync(join(repoRoot, 'tests', 'attach-snapshots', 'qwen-stardeck.toml'), 'utf8'))
  if (process.platform === 'win32') assert.ok(detectQwenBin('').endsWith('cli-entry.js') || detectQwenBin('') === 'qwen')
  assert.equal(detectQwenBin('C:/custom/qwen.js'), 'C:/custom/qwen.js')
  rmSync(qws, { recursive: true, force: true, maxRetries: 3 })
})

test('附着面：jump 端点 dry-run（真 daemon）——映射命中 409 缺映射', async t => {
  const port = 40790 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const stateDir = tmpDir()
  const ws = tmpDir()
  let daemon: ChildProcess | undefined
  t.after(() => {
    daemon?.kill()
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 })
    rmSync(ws, { recursive: true, force: true, maxRetries: 3 })
  })
  // 账本：一条任务（建+发布，工作区指向临时目录）。
  mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
  const events = [
    { type: 'task_created', ts: '2026-09-02T00:00:00.000Z', campaignId: 'attach-test-task', title: '附着面测试', brief: 'b', acceptance: 'a', priority: 'normal' },
    { type: 'task_published', ts: '2026-09-02T00:00:01.000Z', campaignId: 'attach-test-task', workspacePath: ws },
  ]
  writeFileSync(join(stateDir, 'campaigns', 'attach-test-task.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  // 映射：opencode 原生会话号。
  writeAttachMapEntry(stateDir, 'attach-test-task', { executor: 'opencode', sessionId: 'ses_probe001', workspacePath: ws, capturedAt: '2026-09-02T00:00:02Z' })
  // 会话历史库（STARDECK_OPENCODE_DB 覆盖到临时 sqlite——history 端点零 token 读档）。
  const ocDb = join(stateDir, 'opencode-probe.db')
  {
    const db = new DatabaseSync(ocDb)
    db.exec('CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)')
    db.exec('CREATE TABLE part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)')
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run('m1', 'ses_probe001', 100, 100, JSON.stringify({ role: 'user', time: { created: 100 } }))
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run('m2', 'ses_probe001', 200, 200, JSON.stringify({ role: 'assistant', time: { created: 200 } }))
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run('p1', 'm1', 'ses_probe001', 101, 101, JSON.stringify({ type: 'text', text: 'Mission: read brief' }))
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)').run('p2', 'm2', 'ses_probe001', 201, 201, JSON.stringify({ type: 'text', text: '任务已交证' }))
    db.close()
  }
  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_OPENCODE_DB: ocDb },
    stdio: 'ignore',
  })
  // 等健康检查就绪（tsx 首编需数秒）。
  let up = false
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise(r => setTimeout(r, 500))
    up = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
  }
  assert.ok(up, 'daemon 未就绪')
  const res = await fetch(`${base}/warroom/api/attach/jump`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'attach-test-task', dryRun: true }),
  })
  assert.equal(res.status, 200)
  const out = await res.json() as { ok?: boolean; dryRun?: boolean; executor?: string; sessionId?: string; cwd?: string; argv?: string[] }
  assert.equal(out.ok, true)
  assert.equal(out.dryRun, true)
  assert.equal(out.executor, 'opencode')
  assert.equal(out.sessionId, 'ses_probe001')
  assert.equal(out.cwd, ws)
  assert.deepEqual(out.argv, ['opencode', '--session', 'ses_probe001'])
  // 缺映射且无 pi 会话文件 → 409 诚实拒绝。
  const res2 = await fetch(`${base}/warroom/api/attach/jump`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'no-such-task', dryRun: true }),
  })
  assert.equal(res2.status, 404)
  writeFileSync(join(stateDir, 'campaigns', 'no-map-task.jsonl'), events.map(e => JSON.stringify(e).replace('attach-test-task', 'no-map-task')).join('\n'), 'utf8')
  const res3 = await fetch(`${base}/warroom/api/attach/jump`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'no-map-task', dryRun: true }),
  })
  assert.equal(res3.status, 409)
  // 方案2 双键型：staff-<id>（大副原生会话）无 campaign 也能命中——「任务会话」
  // 钮独立形态跳转走的就是这条（映射优先，账本查找只在任务分支）。
  writeAttachMapEntry(stateDir, 'staff-m9', { executor: 'opencode', sessionId: 'ses_staff777', workspacePath: ws, capturedAt: '2026-09-02T00:00:03Z' })
  const res4 = await fetch(`${base}/warroom/api/attach/jump`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'staff-m9', dryRun: true }),
  })
  assert.equal(res4.status, 200)
  const out4 = await res4.json() as { ok?: boolean; executor?: string; sessionId?: string; cwd?: string; argv?: string[] }
  assert.equal(out4.ok, true)
  assert.equal(out4.executor, 'opencode')
  assert.equal(out4.sessionId, 'ses_staff777')
  assert.equal(out4.cwd, ws)
  assert.deepEqual(out4.argv, ['opencode', '--session', 'ses_staff777'])
  // 方案2·二段：entries 轻查（板面 TUI 行可见性数据源）。
  const res5 = await fetch(`${base}/warroom/api/attach/entries`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskIds: ['attach-test-task', 'staff-m9', 'no-such'] }),
  })
  assert.equal(res5.status, 200)
  const out5 = await res5.json() as { ok?: boolean; entries?: Record<string, { executor?: string; sessionId?: string } | null> }
  assert.equal(out5.ok, true)
  assert.equal(out5.entries!['attach-test-task']!.executor, 'opencode')
  assert.equal(out5.entries!['staff-m9']!.sessionId, 'ses_staff777')
  assert.equal(out5.entries!['no-such'], null)
  // history 端点：零 token 读档（env 覆盖库里的 ses_probe001 两条消息）。
  const res6 = await fetch(`${base}/warroom/api/attach/history`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'attach-test-task' }),
  })
  assert.equal(res6.status, 200)
  const out6 = await res6.json() as { ok?: boolean; executor?: string; sessionId?: string; messages?: Array<{ role: string; parts: Array<{ text: string }> }> }
  assert.equal(out6.ok, true)
  assert.equal(out6.executor, 'opencode')
  assert.equal(out6.sessionId, 'ses_probe001')
  assert.equal(out6.messages!.length, 2)
  assert.equal(out6.messages![0]!.parts[0]!.text, 'Mission: read brief')
  assert.equal(out6.messages![1]!.parts[0]!.text, '任务已交证')
  // history：缺映射键 → 404 同 jump。
  const res7 = await fetch(`${base}/warroom/api/attach/history`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: 'no-such' }),
  })
  assert.equal(res7.status, 404)
  // 绑定回执（定案「回执给一句」）：POST /fleet note 字段按席别交代模型语义。
  const res8 = await fetch(`${base}/warroom/api/fleet`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executor: 'gemini', model: 'gemini-2.5-pro' }),
  })
  assert.equal(res8.status, 200)
  const out8 = await res8.json() as { ok?: boolean; note?: string }
  assert.equal(out8.ok, true)
  assert.ok((out8.note ?? '').includes('已按 gemini 语义透传'), `gemini 回执应含透传语义：${out8.note}`)
  const res9 = await fetch(`${base}/warroom/api/fleet`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executor: 'zcode', model: 'whatever' }),
  })
  const out9 = await res9.json() as { ok?: boolean; note?: string }
  assert.equal(out9.ok, true)
  assert.ok((out9.note ?? '').includes('不透传'), `zcode 回执应明示不透传：${out9.note}`)
  const res10 = await fetch(`${base}/warroom/api/fleet`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executor: 'opencode', model: '' }),
  })
  const out10 = await res10.json() as { ok?: boolean; note?: string }
  assert.ok((out10.note ?? '').includes('自身默认模型'), `空模型回执应说沿用默认：${out10.note}`)
})
