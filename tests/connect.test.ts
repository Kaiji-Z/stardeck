/**
 * D30 connect：一行接入代理舰长外接席——生成器纯函数面 + 真 daemon 全流程
 * （隔离端口/隔离宿主配置目录/隔离 STARDECK_CONFIG——config 污染坑不复发）。
 * 红线断言：任何注册面只含 --face proxy + STARDECK_PROXY_TOKEN，war_* 一件
 * 不出（出口协议）；注入家族纪律（首动备份/幂等/坏 JSON 拒绝覆盖）。
 * @module stardeck/tests/connect
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  buildClaudeProxyEntry, buildCodexProxyTable, buildOpencodeProxyEntry, buildZcodeProxyEntry, buildGenericBlock,
  hostConfigPaths, runConnect, PROXY_SERVER_NAME,
} = await import('../src/connect.ts')
const { startDaemon } = await import('../src/daemon.ts')
const { persistConfigPatch } = await import('../src/config.ts')

// connect 测的是 proxy-ON 面：矩阵 OFF 面（STARDECK_PROXY=0 env 全套注入）下
// 本文件显式回 ON——否则签席 404 是产品正确行为而测试误败。OFF 面的 404 纪律
// 由 proxy-external-seat.test.ts 的显式子进程（spawn env 逐键给 0）钉死，不受此影响。
process.env.STARDECK_PROXY = '1'
process.env.STARDECK_BRIDGE = '1'

const ARGS = { token: 'ab'.repeat(24), http: 'http://127.0.0.1:3970', bridgePath: 'C:/sd/dist/mcp-bridge.mjs', nodePath: 'C:/Program Files/nodejs/node.exe' }

// ── 生成器纯函数面：红线（war_* 不出 proxy 脸）逐宿主钉死 ──
test('生成器：四宿主+通用全部只含 --face proxy 与 token，war_* 一件不出', () => {
  const blob = JSON.stringify([
    buildClaudeProxyEntry(ARGS), JSON.parse(buildGenericBlock(ARGS)), buildOpencodeProxyEntry(ARGS), buildZcodeProxyEntry(ARGS),
  ]) + buildCodexProxyTable(ARGS)
  assert.ok(blob.includes('--face') && blob.includes('proxy'), 'proxy 脸参数在')
  assert.ok(blob.includes(ARGS.token), 'token 进配置（宿主本机文件，capability 语义）')
  assert.ok(blob.includes('STARDECK_PROXY_TOKEN'), 'token 走 env 键')
  for (const banned of ['STARDECK_AGENT', 'war_claim', 'war_submit', 'STARDECK_AGENT_ID']) {
    assert.ok(!blob.includes(banned), `war 面/执行者身份键不出现在 proxy 注册面：${banned}`)
  }
})

test('生成器：宿主形状各异（opencode command 数组 / zcode command 串 / codex TOML 表头）', () => {
  const oc = buildOpencodeProxyEntry(ARGS) as { type: string; command: string[]; environment: Record<string, string> }
  assert.equal(oc.type, 'local')
  assert.deepEqual(oc.command, [ARGS.nodePath, ARGS.bridgePath, '--face', 'proxy'])
  assert.equal(oc.environment.STARDECK_PROXY_TOKEN, ARGS.token)
  const zc = buildZcodeProxyEntry(ARGS) as { type: string; command: string; args: string[] }
  assert.equal(zc.type, 'stdio')
  assert.equal(zc.command, ARGS.nodePath)
  assert.deepEqual(zc.args, [ARGS.bridgePath, '--face', 'proxy'])
  const toml = buildCodexProxyTable(ARGS)
  assert.ok(toml.includes('[mcp_servers.stardeck-proxy]'), 'codex 表头')
  assert.ok(toml.includes(`args = [${JSON.stringify(ARGS.bridgePath)}, '--face', 'proxy']`), 'TOML args 行')
  const generic = JSON.parse(buildGenericBlock(ARGS)) as { mcpServers: Record<string, { command: string; args: string[] }> }
  assert.ok(generic.mcpServers[PROXY_SERVER_NAME] !== undefined, '通用块 mcpServers 键形')
})

test('hostConfigPaths：四宿主落点随 env 注入隔离（win/mac 无关路径）', () => {
  const p = { home: '/h', xdgConfig: '/h/.config-x', codexHome: '/h/.codex-x', zcodeHome: '/h/.zcode-x' }
  assert.equal(hostConfigPaths('claude', p), join('/h', '.claude.json'))
  assert.equal(hostConfigPaths('opencode', p), join('/h/.config-x', 'opencode', 'opencode.json'))
  assert.equal(hostConfigPaths('codex', p), join('/h/.codex-x', 'config.toml'))
  assert.equal(hostConfigPaths('zcode', p), join('/h/.zcode-x', 'cli', 'config.json'))
})

// ── 真 daemon 全流程（隔离面）──
function isolated(): { base: string; stateDir: string; home: string; paths: Record<string, string>; close: () => Promise<void> } {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-conn-state-'))
  const home = mkdtempSync(join(tmpdir(), 'sd-conn-home-'))
  // config 污染坑防疫：进程级 STARDECK_CONFIG 指到隔离目录（POST /fleet 写不进用户全局）。
  process.env.STARDECK_CONFIG = join(stateDir, 'config.json')
  process.env.STARDECK_STAFF = '0'
  const handle = startDaemon({ port: 41710 + (process.pid % 50), stateDir })
  const base = handle.base
  return {
    base, stateDir, home,
    paths: { home, xdgConfig: join(home, '.config-x'), codexHome: join(home, '.codex-x'), zcodeHome: join(home, '.zcode-x') },
    close: async () => {
      await handle.close()
      rmSync(stateDir, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('runConnect 真 daemon：四宿主写盘+generic 块+未知归 generic+席位签发', { timeout: 60_000 }, async () => {
  const env = isolated()
  try {
    // 等 daemon 活。
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`${env.base}/warroom/api/healthz`)).ok) break } catch { }
      await new Promise(r => setTimeout(r, 300))
    }
    for (const host of ['opencode', 'claude', 'codex', 'zcode', 'generic', '完全未知的宿主'] as const) {
      const out = await runConnect(host, { base: env.base, paths: env.paths, bridgePath: '/x/mcp-bridge.mjs', nodePath: '/x/node' })
      assert.equal(out.ok, true, `${host} 应成功：${out.error ?? ''}`)
      assert.match(out.seatId ?? '', /^proxyx-/, '席位签发')
      assert.ok(out.lines.some(l => l.includes(`${env.base}/`)), '回执含甲板地址')
    }
    // 写盘面抽查：opencode 结构+zcode 结构+codex 表+claude 键形。
    const oc = JSON.parse(readFileSync(join(env.paths.xdgConfig, 'opencode', 'opencode.json'), 'utf8')) as { mcp: Record<string, { command: string[] }> }
    assert.deepEqual(oc.mcp[PROXY_SERVER_NAME]!.command, ['/x/node', '/x/mcp-bridge.mjs', '--face', 'proxy'])
    const zc = JSON.parse(readFileSync(join(env.paths.zcodeHome, 'cli', 'config.json'), 'utf8')) as { mcp: { servers: Record<string, unknown> } }
    assert.ok(zc.mcp.servers[PROXY_SERVER_NAME] !== undefined, 'zcode mcp.servers 键形')
    const toml = readFileSync(join(env.paths.codexHome, 'config.toml'), 'utf8')
    assert.ok(toml.includes('[mcp_servers.stardeck-proxy]'), 'codex 表在')
    const cl = JSON.parse(readFileSync(join(env.paths.home, '.claude.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    assert.ok(cl.mcpServers[PROXY_SERVER_NAME] !== undefined, 'claude mcpServers 键形')
    // /fleet 带 proxyLoop 字段（D30 门面指引数据源）。
    const fleet = await fetch(`${env.base}/warroom/api/fleet`).then(r => r.json()) as { proxyLoop?: boolean }
    assert.equal(fleet.proxyLoop, false, '默认 env 下 proxyLoop=false')
  } finally {
    await env.close()
  }
})

test('runConnect 纪律：坏 JSON 拒绝覆盖（原文件原样）/ 首动备份 / 幂等复写', { timeout: 60_000 }, async () => {
  const env = isolated()
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`${env.base}/warroom/api/healthz`)).ok) break } catch { }
      await new Promise(r => setTimeout(r, 300))
    }
    // 坏 JSON：opencode 配置预置坏内容 → 拒绝且原样。
    const ocPath = join(env.paths.xdgConfig, 'opencode', 'opencode.json')
    mkdirSync(join(env.paths.xdgConfig, 'opencode'), { recursive: true })
    writeFileSync(ocPath, '{ 坏掉的 json', 'utf8')
    const bad = await runConnect('opencode', { base: env.base, paths: env.paths, bridgePath: '/x/mcp-bridge.mjs', nodePath: '/x/node' })
    assert.equal(bad.ok, false, '坏 JSON 应拒绝')
    assert.ok(bad.error?.includes('拒绝覆盖'), '错误文案教学')
    assert.equal(readFileSync(ocPath, 'utf8'), '{ 坏掉的 json', '原文件一字未动')
    // 好文件：首动备份 + 幂等。
    writeFileSync(ocPath, `${JSON.stringify({ theme: 'dark', mcp: { other: { type: 'local', command: ['x'] } } }, null, 2)}\n`, 'utf8')
    assert.equal((await runConnect('opencode', { base: env.base, paths: env.paths, bridgePath: '/x/mcp-bridge.mjs', nodePath: '/x/node' })).ok, true)
    const backupPath = `${ocPath}.pre-stardeck`
    assert.ok(existsSync(backupPath), '首动备份在')
    assert.ok(readFileSync(backupPath, 'utf8').includes('"theme": "dark"'), '备份=原文件')
    const after1 = readFileSync(ocPath, 'utf8')
    assert.equal((await runConnect('opencode', { base: env.base, paths: env.paths, bridgePath: '/x/mcp-bridge.mjs', nodePath: '/x/node' })).ok, true)
    const after2 = readFileSync(ocPath, 'utf8')
    // 每次连接签新席（token 必不同）——幂等=结构面不变，不是字节不变。
    const m1 = JSON.parse(after1) as { theme?: string; mcp: Record<string, { command: string[]; environment: Record<string, string> }> }
    const m2 = JSON.parse(after2) as typeof m1
    assert.deepEqual(Object.keys(m1), Object.keys(m2), '顶层键集不变')
    assert.equal(m2.theme, 'dark', '用户既有键保留')
    assert.ok(m2.mcp.other !== undefined, '他人 MCP 键保留')
    const stardeck2 = m2.mcp[PROXY_SERVER_NAME]!
    assert.deepEqual(stardeck2.command, ['/x/node', '/x/mcp-bridge.mjs', '--face', 'proxy'], 'proxy 脸命令刷新')
    assert.match(stardeck2.environment.STARDECK_PROXY_TOKEN, /^[0-9a-f]{48}$/, '新 token 48hex 入 env 键')
  } finally {
    await env.close()
  }
})

test('runConnect：daemon 缺席——无拉起器诚实报错；已在则拉起器不被调', { timeout: 60_000 }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-conn-up-'))
  const home = mkdtempSync(join(tmpdir(), 'sd-conn-uph-'))
  process.env.STARDECK_CONFIG = join(stateDir, 'config.json')
  process.env.STARDECK_STAFF = '0'
  const handle = startDaemon({ port: 41900 + (process.pid % 50), stateDir })
  const paths = { home, xdgConfig: join(home, '.config-x'), codexHome: join(home, '.codex-x'), zcodeHome: join(home, '.zcode-x') }
  try {
    const down = await runConnect('generic', { base: 'http://127.0.0.1:41990', paths })
    assert.equal(down.ok, false)
    assert.ok(down.error?.includes('daemon 未在运行'), '诚实报错（先 stardeck start）')
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`${handle.base}/warroom/api/healthz`)).ok) break } catch { }
      await new Promise(r => setTimeout(r, 300))
    }
    let spawned = 0
    const up = await runConnect('generic', { base: handle.base, paths, spawnDaemon: () => { spawned++ } })
    assert.equal(up.ok, true, 'daemon 已在=直接签席')
    assert.equal(spawned, 0, '已在=不拉')
  } finally {
    await handle.close()
    rmSync(stateDir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

// ── D35 形态 A：--panel 落 config + 一条提示词单一源 ──
test('persistConfigPatch：panel 往返（bridge:false 落盘/既有键保留/坏 JSON 拒绝）', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-cfg-patch-'))
  const prev = process.env.STARDECK_CONFIG
  process.env.STARDECK_CONFIG = join(stateDir, 'config.json')
  try {
    const first = persistConfigPatch({ bridge: false })
    assert.equal(first.ok, true)
    const disk = JSON.parse(readFileSync(process.env.STARDECK_CONFIG!, 'utf8')) as { bridge?: boolean }
    assert.equal(disk.bridge, false, 'bridge:false 落盘')
    const second = persistConfigPatch({ executor: 'opencode' })
    assert.equal(second.ok, true)
    const disk2 = JSON.parse(readFileSync(process.env.STARDECK_CONFIG!, 'utf8')) as { bridge?: boolean; executor?: string }
    assert.equal(disk2.bridge, false, '补丁不吞既有键')
    assert.equal(disk2.executor, 'opencode')
    writeFileSync(process.env.STARDECK_CONFIG!, '{oops', 'utf8')
    assert.equal(persistConfigPatch({ bridge: false }).ok, false, '坏 JSON 拒绝覆盖')
  } finally {
    if (prev !== undefined) process.env.STARDECK_CONFIG = prev
    else delete process.env.STARDECK_CONFIG
    rmSync(stateDir, { recursive: true, force: true })
  }
})

test('一条提示词（D35）：五步齐全——装/connect/验证/开板/块文法与不代行纪律', async () => {
  const { agentInstallPrompt, AGENT_INSTALL_PROMPT_EN } = await import('../src/agent-prompt.ts')
  const zh = agentInstallPrompt('zh')
  for (const needle of ['npm i -g stardeck', 'stardeck connect', 'read_digest', 'stardeck open', 'get_order', 'submit_reply', '【命令】', '不代行']) {
    assert.ok(zh.includes(needle), `zh 提示词含 ${needle}`)
  }
  assert.ok(zh.includes('http://127.0.0.1:3970'), '含看板地址')
  const en = AGENT_INSTALL_PROMPT_EN
  for (const needle of ['npm i -g stardeck', 'stardeck connect', 'read_digest', 'submit_reply']) {
    assert.ok(en.includes(needle), `en 提示词含 ${needle}`)
  }
})
