/**
 * 执行者适配层新面（HANDOFF②③）的确定性回归：
 * - injectOpencodeMcp（③ bound 合并注入）：全新直写 / 既有逐键合并保用户键 /
 *   首动备份原件 / 幂等重注入刷新身份 / 坏 JSON 拒绝覆盖（不毁用户配置）；
 * - codex/pi 适配器（② 面在但不撒谎）：spawn 落教学错误（含探测命令与接线
 *   指引），注册表三席在位；
 * - spawnHeadlessOpencode 框定产物：简报落地 + MCP 注入 + 日志前缀角色制。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { injectOpencodeMcp, injectCodexMcp, injectPiExtension, codexExecArgs, piPrintArgs, ADAPTERS, spawnHeadlessOpencode, executorBrief } from '../src/executor.ts'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'stardeck-exec-'))
}

const injectArgs = { http: 'http://127.0.0.1:3970', agentId: 'oc-t1-abc' }

test('injectOpencodeMcp：全新工作区直写（$schema + stardeck 桥 + 身份 env）', () => {
  const dir = tmpDir()
  try {
    injectOpencodeMcp(dir, injectArgs)
    const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8')) as Record<string, any>
    assert.equal(cfg.$schema, 'https://opencode.ai/config.json')
    assert.equal(cfg.mcp.stardeck.type, 'local')
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_HTTP, injectArgs.http)
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_AGENT, injectArgs.agentId)
    assert.ok(cfg.mcp.stardeck.command[1]!.endsWith('mcp-bridge.mjs'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('injectOpencodeMcp（③）：bound 工作区逐键合并——用户键与 mcp.* 全保留 + 首动备份原件', () => {
  const dir = tmpDir()
  try {
    const userCfg = { $schema: 'https://opencode.ai/config.json', theme: 'dark', mcp: { other: { type: 'local', command: ['x'] } }, keybindings: { run: 'f5' } }
    const dirPath = join(dir, 'bound-proj')
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(join(dirPath, 'opencode.json'), `${JSON.stringify(userCfg, null, 2)}\n`, 'utf8')
    injectOpencodeMcp(dirPath, injectArgs)
    const cfg = JSON.parse(readFileSync(join(dirPath, 'opencode.json'), 'utf8')) as Record<string, any>
    assert.equal(cfg.theme, 'dark')
    assert.equal(cfg.keybindings.run, 'f5')
    assert.equal(cfg.mcp.other.command[0], 'x')
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_AGENT, injectArgs.agentId)
    const backup = readFileSync(join(dirPath, '.stardeck', 'opencode.json.pre-stardeck'), 'utf8')
    assert.equal(backup, `${JSON.stringify(userCfg, null, 2)}\n`) // 备份=用户原件原字节
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('injectOpencodeMcp：幂等重注入只刷新 stardeck 身份，备份不二次覆盖', () => {
  const dir = tmpDir()
  try {
    mkdirSync(join(dir, '.stardeck'), { recursive: true })
    const userCfg = { mcp: { mine: { type: 'local', command: ['keep'] } } }
    writeFileSync(join(dir, 'opencode.json'), `${JSON.stringify(userCfg)}\n`, 'utf8')
    injectOpencodeMcp(dir, { http: 'http://h1', agentId: 'oc-a' })
    injectOpencodeMcp(dir, { http: 'http://h2', agentId: 'oc-b' }) // 二次征召换身份
    const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8')) as Record<string, any>
    assert.equal(cfg.mcp.mine.command[0], 'keep')
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_AGENT, 'oc-b')
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_HTTP, 'http://h2')
    assert.equal(readFileSync(join(dir, '.stardeck', 'opencode.json.pre-stardeck'), 'utf8'), `${JSON.stringify(userCfg)}\n`) // 仍是首动前的原件
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('injectOpencodeMcp：坏 JSON 拒绝覆盖（stardeck 不毁用户配置）', () => {
  const dir = tmpDir()
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'opencode.json'), '{ 不是 json', 'utf8')
    assert.throws(() => injectOpencodeMcp(dir, injectArgs), /拒绝覆盖/)
    assert.equal(readFileSync(join(dir, 'opencode.json'), 'utf8'), '{ 不是 json') // 原样未动
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('codex 注入（源码实证契约）：.codex/config.toml 写 [mcp_servers.stardeck]，用户 TOML 字节不动 + 首动备份 + 幂等整表替换', () => {
  const dir = tmpDir()
  try {
    const proj = join(dir, 'bound')
    mkdirSync(join(proj, '.codex'), { recursive: true })
    const userToml = '# 用户配置\nmodel = "gpt-5"\n[mcp_servers.mine]\ncommand = "keep"\n'
    writeFileSync(join(proj, '.codex', 'config.toml'), userToml, 'utf8')
    injectCodexMcp(proj, { http: 'http://h1', agentId: 'oc-a' })
    let toml = readFileSync(join(proj, '.codex', 'config.toml'), 'utf8')
    assert.ok(toml.includes('model = "gpt-5"'))
    assert.ok(toml.includes('[mcp_servers.mine]'))
    assert.ok(toml.includes('[mcp_servers.stardeck]'))
    assert.ok(toml.includes('STARDECK_AGENT = "oc-a"'))
    assert.equal(readFileSync(join(proj, '.stardeck', 'config.toml.pre-stardeck'), 'utf8'), userToml)
    // 二次征召换身份：stardeck 表整块替换（不叠表），mine 仍在，备份不二次覆盖。
    injectCodexMcp(proj, { http: 'http://h2', agentId: 'oc-b' })
    toml = readFileSync(join(proj, '.codex', 'config.toml'), 'utf8')
    assert.equal(toml.match(/\[mcp_servers\.stardeck\]/g)?.length, 1)
    assert.ok(toml.includes('STARDECK_AGENT = "oc-b"'))
    assert.ok(!toml.includes('STARDECK_AGENT = "oc-a"'))
    assert.ok(toml.includes('[mcp_servers.mine]'))
    assert.equal(readFileSync(join(proj, '.stardeck', 'config.toml.pre-stardeck'), 'utf8'), userToml)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('pi 注入：.pi/extensions/stardeck-tools.ts 注册出口协议三工具（typebox 契约 + 身份回连 env 兜底），幂等重写零备份', () => {
  const dir = tmpDir()
  try {
    injectPiExtension(dir, { http: 'http://h', agentId: 'oc-p' })
    const src = readFileSync(join(dir, '.pi', 'extensions', 'stardeck-tools.ts'), 'utf8')
    assert.ok(src.includes('import { Type } from "typebox"'))
    for (const tool of ['war_claim', 'war_submit', 'war_fail']) {
      assert.ok(src.includes(`name: "${tool}"`), tool)
    }
    assert.ok(src.includes('/warroom/api/tools/call'))
    assert.ok(src.includes(JSON.stringify('http://h')))
    assert.ok(src.includes('attempt_id'))
    assert.ok(src.includes('tests_evidence'), '取证轨迹参数缺席（V19.12 出口协议教学）')
    // 幂等：同身份重写内容相同→无备份；异源同名文件→首动备份一次。
    injectPiExtension(dir, { http: 'http://h', agentId: 'oc-p' })
    assert.ok(!existsSync(join(dir, '.stardeck', 'pi-extension.pre-stardeck')))
    
    writeFileSync(join(dir, '.pi', 'extensions', 'stardeck-tools.ts'), '// 用户手改版\n', 'utf8')
    injectPiExtension(dir, { http: 'http://h', agentId: 'oc-p2' })
    assert.equal(readFileSync(join(dir, '.stardeck', 'pi-extension.pre-stardeck'), 'utf8'), '// 用户手改版\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('argv 构造（纯）：codex exec 框定旗序 / pi -p 一次性 + --approve 放行项目扩展', () => {
  // V19.13 win32 沙箱分野：0.153 新沙箱拦一切命令（实弹三连拒）——win32=
  // danger-full-access，其余平台 workspace-write（期望值按平台同式计算）。
  const sandbox = process.platform === 'win32' ? 'danger-full-access' : 'workspace-write'
  assert.deepEqual(
    codexExecArgs({ workspacePath: '/w/t1', model: '', prompt: 'P' }),
    ['exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox, '-C', '/w/t1', 'P'],
  )
  assert.deepEqual(
    codexExecArgs({ workspacePath: '/w/t1', model: 'glm-5.2', prompt: 'P' }),
    ['exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox, '-C', '/w/t1', '-m', 'glm-5.2', 'P'],
  )
  assert.deepEqual(piPrintArgs({ model: '', prompt: 'P' }), ['--approve', '-p', 'P'])
  assert.deepEqual(piPrintArgs({ model: 'zai/glm-5.2', prompt: 'P' }), ['--approve', '-p', '--model', 'zai/glm-5.2', 'P'])
  assert.deepEqual(
    codexExecArgs({ workspacePath: '/w', model: 'glm-5.2', modelProvider: 'zai', prompt: 'P' }),
    ['exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox, '-C', '/w', '-c', 'model_provider=zai', '-m', 'glm-5.2', 'P'],
  )
  // V19.13 垫片优先：codexShimBase 非空=完整 provider 定义五旗压过裸 modelProvider。
  const shimArgv = codexExecArgs({ workspacePath: '/w', model: 'glm-5.2', modelProvider: 'zai', codexShimBase: 'http://127.0.0.1:3975/v1/', prompt: 'P' })
  assert.ok(shimArgv.includes('-c') && shimArgv.some(a => a.startsWith('model_provider=stardeck_shim')), shimArgv.join(' '))
  assert.ok(shimArgv.some(a => a === 'model_providers.stardeck_shim.base_url="http://127.0.0.1:3975/v1"'))
  assert.ok(!shimArgv.some(a => a.startsWith('model_provider=zai')), '垫片在场时裸 provider 不落')
  // MCP 注入走 -c 覆盖（0.44 实测：项目级 .codex/config.toml 旧版不加载）。
  const mcpArgv = codexExecArgs({ workspacePath: '/w', model: '', prompt: 'P', mcp: { command: 'node', args: ['b.mjs'], env: { STARDECK_HTTP: 'http://h', STARDECK_AGENT: 'oc-x' } } })
  assert.ok(mcpArgv.includes('-c') && mcpArgv.some(a => a.startsWith('mcp_servers.stardeck.command="node"')), mcpArgv.join(' '))
  assert.ok(mcpArgv.includes('mcp_servers.stardeck.args=["b.mjs"]'))
  assert.ok(mcpArgv.includes('mcp_servers.stardeck.env={ STARDECK_HTTP = "http://h", STARDECK_AGENT = "oc-x" }'))
})

test('适配器注册表三席在位（opencode 实弹 / codex+pi 契约实装）', () => {
  assert.equal(ADAPTERS.opencode!.id, 'opencode')
  assert.equal(ADAPTERS.codex!.id, 'codex')
  assert.equal(ADAPTERS.pi!.id, 'pi')
  // codex/pi 简报的接入面措辞分叉：pi 无 MCP，走扩展面教学。
  const face = { taskId: 't1', title: 'x', acceptance: 'y', workspacePath: '/w', http: 'http://h', agentId: 'oc-z', model: '', modelProvider: '', executorBin: '', stateDir: '/s' }
  assert.ok(executorBrief(face, 'pi-extension').includes('stardeck 扩展'))
  assert.ok(executorBrief(face).includes('MCP 服务'))
})

test('V19 腿1 战报纪律：三 face 简报都教「report=给舰长的最终答复」（结论先行/产物相对路径/不复述过程）', () => {
  const face = { taskId: 't1', title: 'x', acceptance: 'y', workspacePath: '/w', http: 'http://h', agentId: 'oc-z', model: '', modelProvider: '', executorBin: '', stateDir: '/s' }
  for (const f of ['mcp', 'pi-extension', 'http'] as const) {
    const brief = executorBrief(face, f)
    assert.ok(brief.includes('给舰长的最终答复'), `${f} face 教受众`)
    assert.ok(brief.includes('结论先行'), `${f} face 教首句结论`)
    assert.ok(brief.includes('相对路径'), `${f} face 教产物指路`)
    assert.ok(brief.includes('不复述执行过程'), `${f} face 教过程退后`)
  }
})

test('win32 spawn 通道：.cmd 垫片给教学错误；JS 入口经 node 直跑（首弹实测的坑）', async () => {
  const dir = tmpDir()
  try {
    const args = { taskId: 't1', title: 'x', acceptance: 'y', workspacePath: dir, http: 'http://h', agentId: 'oc-c', model: '', modelProvider: '', executorBin: 'codex.cmd', stateDir: dir }
    if (process.platform === 'win32') {
      await assert.rejects(() => ADAPTERS.codex!.spawn(args), /\.cmd 垫片/)
    }
    // JS 入口（假 CLI=node 脚本即刻退场）→ 框定产物齐、进程退场记账。
    const fake = join(dir, 'fake-cli.js')
    writeFileSync(fake, 'process.exit(3)\n', 'utf8')
    const piArgs = { ...args, executorBin: fake }
    const session = await ADAPTERS.pi!.spawn(piArgs)
    assert.ok(existsSync(join(dir, '.pi', 'extensions', 'stardeck-tools.ts')))
    await new Promise<void>(resolve => { if (session.exitCode !== null) resolve(); else session.child.once('exit', () => resolve()) })
    assert.equal(session.exitCode, 3)
    await new Promise(r => setTimeout(r, 100))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('spawnHeadlessOpencode：框定产物——简报落地 + MCP 注入 + 角色日志前缀', async () => {
  const dir = tmpDir()
  try {
    const brief = executorBrief({ taskId: 't-9', title: '示例', acceptance: '验收一；验收二', workspacePath: dir, http: 'http://h', agentId: 'oc-t9', model: '', executorBin: 'x', stateDir: dir })
    const session = await spawnHeadlessOpencode({
      workspacePath: dir, brief, title: 'stardeck:t-9', http: 'http://h', agentId: 'oc-t9',
      model: '', executorBin: process.execPath, stateDir: dir, role: 'executor',
    })
    // executorBin=node + opencode 参数 → 进程即刻报错退出，但框定产物必须齐：
    assert.ok(existsSync(join(dir, '.stardeck', 'brief.md')))
    assert.equal(readFileSync(join(dir, '.stardeck', 'brief.md'), 'utf8'), brief)
    const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8')) as Record<string, any>
    assert.equal(cfg.mcp.stardeck.environment.STARDECK_AGENT, 'oc-t9')
    assert.ok(session.logPath.endsWith('executor-oc-t9.log'))
    const staffSession = await spawnHeadlessOpencode({
      workspacePath: dir, brief: '大副简报', title: 'stardeck:staff:s1', http: 'http://h', agentId: 'staff-s1',
      model: '', executorBin: process.execPath, stateDir: dir, role: 'staff',
    })
    assert.ok(staffSession.logPath.endsWith('staff-staff-s1.log'))
    // 等进程退场、日志流收口再清理（Windows 目录锁——进程/句柄未断 rmSync 即 EPERM）。
    for (const s of [session, staffSession]) {
      if (s.exitCode !== null) continue
      await new Promise<void>(resolve => s.child.once('exit', () => resolve()))
    }
    await new Promise(r => setTimeout(r, 100))
    assert.notEqual(session.exitCode, null) // 假 bin 必须退场（exit code 已记账）
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('V24.1 seatAgentPrefix：编号前缀=席别（oc- 全席遗留退场）', async () => {
  const { seatAgentPrefix, SEAT_AGENT_PREFIX } = await import('../src/executor.ts')
  assert.equal(seatAgentPrefix('opencode'), 'oc')
  assert.equal(seatAgentPrefix('pi'), 'pi')
  assert.equal(seatAgentPrefix('zcode'), 'zx')
  assert.equal(seatAgentPrefix('claude'), 'cl')
  assert.equal(seatAgentPrefix('codex'), 'cx')
  assert.equal(seatAgentPrefix('dsh'), 'dsh')
  assert.equal(seatAgentPrefix('gemini'), 'gm')
  assert.equal(seatAgentPrefix('qwen'), 'qw')
  // 未知席=退前两字符，不抛错（新席先能跑再补表）。
  assert.equal(seatAgentPrefix('mistral'), 'mi')
  assert.ok(Object.keys(SEAT_AGENT_PREFIX).length >= 8)
})
