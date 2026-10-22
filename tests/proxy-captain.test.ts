/**
 * D27 代理舰长席核心测试：proxyOrderFor（授权段 flag 区分）、【命令】/
 * 【定夺】块解析（多块/畸形/上限/弃收）、issuedBy 账面贯通（事件→fold→
 * /commands 投影）、授权开关路由（bridge/settings 翻转/校验/501/404）、
 * 双旗配置面（STARDECK_PROXY / STARDECK_PROXY_VERDICT）。
 * 收割 glue（harvestProxyReply）在 daemon 内联，由 live 门 STARDECK_LIVE_PROXY
 * 相位覆盖；B3 授权门单测在 tests/proxy-verdict-gate.test.ts。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { proxyOrderFor, proxyCommandBlocksOf, proxyVerdictBlocksOf, proxySceneBlocksOf, proxyManagementBlocksOf, PROXY_COMMAND_BLOCKS_CAP, PROXY_SCENE_DRAFT_CAP, PROXY_MANAGEMENT_BLOCKS_CAP } from '../src/staff.ts'
import { appendDirectiveEvent, loadDirectives } from '../src/directives.ts'
import { appendBridgeEvent, foldBridge, loadBridgeMessages } from '../src/bridge.ts'
import { loadConfig } from '../src/config.ts'
import { registerDashboard, ledgerSlice, type RouteRegistry } from '../src/dashboard.ts'

const chat = {
  pending: [{ text: '现在舰队什么情况？', ts: '2026-10-20T10:00:00.000Z' }],
  history: [
    { role: 'you' as const, text: '舰长曾说过的话' },
    { role: 'manager' as const, text: '你上轮的答复' },
    { role: 'system' as const, text: '战报：t-1 已交证待验收' },
  ],
  digest: JSON.stringify({ pendingDecisions: [], commands: [], tasks: [], stats: { commands: 0, tasks: 0, inProgress: 0, reported: 0, failed: 0 } }),
  ledger: '[]',
}

test('proxyOrderFor：无授权面——代理舰长条令+携史+速览+【命令】块正典在场，无【定夺】', () => {
  const order = proxyOrderFor(chat)
  assert.ok(order.includes('# 舰桥 · 代理舰长条令'), '代理舰长人格在场（非大副条令）')
  assert.ok(!order.includes('贴身大副条令'), '不与共享大副条令文本')
  assert.ok(order.includes('舰长曾说过的话') && order.includes('你上轮的答复'), '携史双向')
  assert.ok(order.includes('现在舰队什么情况？'), '未答新话单列')
  assert.ok(order.includes('【命令块格式】'), '命令块格式正典')
  assert.ok(!order.includes('【定夺授权】'), '无授权段')
  assert.ok(!order.includes('war_claim') && !order.includes('war_publish') && !order.includes('war_close_task'), '不教任何出口/舰务工具动词（禁令句除外）')
})

test('proxyOrderFor：授权面——【定夺授权】段与【定夺】块格式仅在 verdictAuthorized 时在场', () => {
  const order = proxyOrderFor(chat, { verdictAuthorized: true })
  assert.ok(order.includes('【定夺授权】'), '授权段在场')
  assert.ok(order.includes('【定夺块格式】'), '定夺块格式在场')
  assert.ok(order.includes('不代行'), '越界纪律在场')
})

test('【命令】块解析：多块逐条、空块/超长弃收、其他结构化块终止收集', () => {
  const long = '字'.repeat(2001)
  const text = [
    '先答复舰长的话。',
    '【命令】',
    '在工作区根创建 hello.txt，内容为当前时刻；完成后跑 check.js 校验退出码 0。',
    '',
    '【命令】',
    '再给 README 补一段使用说明。',
    '',
    '【命令】',
    '', // 空块——弃收
    '【命令】',
    long, // 超 2000 字——弃收
    '【任务书】（cmd-x）',
    '目标：不应被误收为命令',
  ].join('\n')
  const out = proxyCommandBlocksOf(text)
  assert.equal(out.commands.length, 2, '两条有效命令')
  assert.ok(out.commands[0]!.includes('hello.txt'))
  assert.ok(out.commands[1]!.includes('README'))
  assert.equal(out.dropped, 2, '空块+超长各计一次弃收')
})

test('【命令】块解析（D33 live 回归）：头缀散文行尾、体在下一行——照样成令', () => {
  // 2026-10-23 实弹原样：glm-5.3-flash 把【命令】缀在「……我再补一道。」行尾，
  // 旧解析 `/^【命令】\s*$/` 整行锚定吃不到——拟令超时判 FAIL。
  const text = [
    '命令要点：只做落文件本身，验收标准写死（根目录 + 含指定串），不加前几道考题的 check.js 实跑环节——要加的话说一声，我再补一道。【命令】',
    '!!直接做：在任务工作区根创建 loop-live.txt（内容包含字符串 stardeck-loop-live）。仅此一文件：不写校验脚本、不改工作区其他文件、不引入任何依赖。',
    '',
    '命令已按最小范围立好——只有落文件本身。',
  ].join('\n')
  const out = proxyCommandBlocksOf(text)
  assert.equal(out.commands.length, 1, '散文行尾的头照样开块')
  assert.ok(out.commands[0]!.startsWith('!!直接做'), '命令体从下一行起（散文前缀不入体）')
  assert.ok(!out.commands[0]!.includes('命令要点'), '前导散文不入命令体')
  assert.equal(out.dropped, 0)
})

test('【命令】块解析（方差族）：头+空白+体同行——开块且体首行就地取', () => {
  const inline = proxyCommandBlocksOf('【命令】 !!直接做：在工作区根创建 a.txt。')
  assert.equal(inline.commands.length, 1, '头+空格+体同行照样成令')
  assert.ok(inline.commands[0]!.startsWith('!!直接做'))
  const noSpace = proxyCommandBlocksOf('【命令】是什么格式？')
  assert.equal(noSpace.commands.length, 0, '行首引用无空白不算块')
  const mention = proxyCommandBlocksOf('要下令先落【命令】块再走。')
  assert.equal(mention.commands.length, 0, '行中提及带后缀不算块')
})

test('【命令】块解析：单轮上限 5 条——超出部分弃收防幻觉风暴', () => {  const text = Array.from({ length: PROXY_COMMAND_BLOCKS_CAP + 2 }, (_, i) => `【命令】\n第 ${i} 号命令`).join('\n')
  const out = proxyCommandBlocksOf(text)
  assert.equal(out.commands.length, PROXY_COMMAND_BLOCKS_CAP)
  assert.equal(out.dropped, 2)
})

test('【定夺】块解析：taskId+判定+理由；畸形头行（缺判定词/未知格式）忽略', () => {
  const text = [
    '【定夺】（20261020-0236-ab）通过',
    '证据：验收 6 项全过、check.js 退出码 0（速览在案）。',
    '【定夺】（20261020-0999-xx）',
    '缺判定词的头行不算块',
    '【定夺】（bad id）打回',
    ' taskId 含空格——解析器不认',
  ].join('\n')
  const out = proxyVerdictBlocksOf(text)
  assert.equal(out.length, 1)
  assert.equal(out[0]!.taskId, '20261020-0236-ab')
  assert.equal(out[0]!.pass, true)
  assert.ok(out[0]!.reason.includes('退出码 0'))
})

test('issuedBy 账面贯通：directive_created 携带 → fold 读回 → 旧事件缺省不炸', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxy-issued-'))
  try {
    appendDirectiveEvent(dir, { type: 'directive_created', ts: 't0', directiveId: 'cmd-p1', text: '代理舰长拟的令', issuedBy: 'proxy-abc123' })
    appendDirectiveEvent(dir, { type: 'directive_created', ts: 't1', directiveId: 'cmd-h1', text: '舰长亲下的令' })
    const byId = new Map(loadDirectives(dir).map(d => [d.id, d]))
    assert.equal(byId.get('cmd-p1')?.issuedBy, 'proxy-abc123', 'fold 携带 issuedBy')
    assert.equal(byId.get('cmd-h1')?.issuedBy, undefined, '旧命令缺省=舰长亲手语义')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 路由面：/commands issuedBy 入账 + /bridge/settings 授权开关 ----------

function postReq(url: string, body: unknown): { method: string; url: string; on(event: string, cb: (chunk?: unknown) => void): void } {
  const text = JSON.stringify(body)
  return {
    method: 'POST',
    url,
    on(event, cb) {
      if (event === 'data') queueMicrotask(() => cb(text))
      if (event === 'end') queueMicrotask(() => cb())
    },
  }
}

function makeHandler(stateDir: string, deps: Record<string, unknown> = {}): (req: unknown, res: unknown) => Promise<void> {
  let handler: ((req: unknown, res: unknown) => void | Promise<void>) | undefined
  const registry: RouteRegistry = { register: route => { handler = route.handler; return () => {} } }
  registerDashboard(registry, {
    store: { get: () => ({ version: 2 as const, active: true }), save: () => {} } as never,
    stateDir,
    roster: () => ({ units: [], errors: [] }) as never,
    warRoot: '/w',
    ...deps,
  } as never)
  return (req, res) => Promise.resolve(handler!(req, res))
}

async function call(handler: (req: unknown, res: unknown) => Promise<void>, req: unknown): Promise<{ code: number; body: any }> {
  let body = ''
  const res: { setHeader(): void; write(): boolean; end(b?: string): void; on(): void; statusCode: number } = {
    setHeader: () => {},
    write: () => true,
    end: (b?: string) => { body = b ?? '' },
    on: () => {},
    statusCode: 0,
  }
  await handler(req, res)
  return { code: res.statusCode, body: body === '' ? {} : JSON.parse(body) }
}

test('POST /commands：外部 issuedBy 自报入账（≤64 字截断）；缺省不写字段', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxy-cmd-'))
  try {
    const handler = makeHandler(dir)
    const a = await call(handler, postReq('/warroom/api/commands', { text: '外部 agent 的令', issuedBy: 'external-mcp:agent-777' }))
    assert.equal(a.body.ok, true)
    const b = await call(handler, postReq('/warroom/api/commands', { text: '舰长亲下的令' }))
    assert.equal(b.body.ok, true)
    const ledger = readFileSync(join(dir, 'directives.jsonl'), 'utf8')
    assert.ok(ledger.includes('"issuedBy":"external-mcp:agent-777"'), '自报来源入账')
    assert.ok(!ledger.includes('"issuedBy":""'), '缺省不写空串')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /bridge/settings：授权翻转经 bridgeProxy 面；非布尔 400；面缺席 501；旗 OFF 404', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxy-auth-'))
  try {
    let verdict = false
    const handler = makeHandler(dir, {
      bridgeEnabled: true,
      bridgeProxy: { proxy: () => true, proxyVerdict: () => verdict, setProxyVerdict: (v: boolean) => { verdict = v } },
    })
    const grant = await call(handler, postReq('/warroom/api/bridge/settings', { proxyVerdict: true }))
    assert.equal(grant.body.ok, true)
    assert.equal(grant.body.verdictAuthorized, true)
    assert.equal(verdict, true, '面被调用（翻转生效）')
    const bad = await call(handler, postReq('/warroom/api/bridge/settings', { proxyVerdict: 'yes' }))
    assert.equal(bad.code, 400)
    const revoke = await call(handler, postReq('/warroom/api/bridge/settings', { proxyVerdict: false }))
    assert.equal(revoke.body.verdictAuthorized, false)
    assert.equal(verdict, false)

    const noFace = makeHandler(dir, { bridgeEnabled: true })
    const p501 = await call(noFace, postReq('/warroom/api/bridge/settings', { proxyVerdict: true }))
    assert.equal(p501.code, 501)

    const off = makeHandler(dir, {})
    const p404 = await call(off, postReq('/warroom/api/bridge/settings', { proxyVerdict: true }))
    assert.equal(p404.code, 404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('双旗配置面：STARDECK_PROXY 默认开、=0 关；STARDECK_PROXY_VERDICT 默认关、=1 开', () => {
  const home = mkdtempSync(join(tmpdir(), 'stardeck-proxy-cfg-'))
  const prevConfig = process.env.STARDECK_CONFIG
  const prevHome = process.env.STARDECK_HOME
  try {
    process.env.STARDECK_HOME = home
    process.env.STARDECK_CONFIG = join(home, 'config.json')
    delete process.env.STARDECK_PROXY
    delete process.env.STARDECK_PROXY_VERDICT
    const def = loadConfig()
    assert.equal(def.proxy, true, 'proxy 默认开')
    assert.equal(def.proxyVerdict, false, 'verdict 默认关（安全缺省）')
    process.env.STARDECK_PROXY = '0'
    process.env.STARDECK_PROXY_VERDICT = '1'
    const flipped = loadConfig()
    assert.equal(flipped.proxy, false)
    assert.equal(flipped.proxyVerdict, true)
    delete process.env.STARDECK_PROXY
    process.env.STARDECK_PROXY = 'off'
    const offWord = loadConfig()
    assert.equal(offWord.proxy, false, 'off/false/no 词面同关')
  } finally {
    if (prevConfig === undefined) delete process.env.STARDECK_CONFIG
    else process.env.STARDECK_CONFIG = prevConfig
    if (prevHome === undefined) delete process.env.STARDECK_HOME
    else process.env.STARDECK_HOME = prevHome
    delete process.env.STARDECK_PROXY
    delete process.env.STARDECK_PROXY_VERDICT
    rmSync(home, { recursive: true, force: true })
  }
})

// ---------- D28 百事通：图景/管理块解析 + 知识面（ledger/只读通道） ----------

test('D28 order 教学：舰队日志/只读通道/图景格式/管理块格式在场；只读只教 GET、不教任何写通道', () => {
  const order = proxyOrderFor({ ...chat, ledger: '[{"kind":"directive","type":"directive_created","ts":"t1","id":"cmd-1","summary":"测试令"}]' })
  assert.ok(order.includes('【舰队日志】'), '账本切片段在场')
  assert.ok(order.includes('directive_created'), '切片内容入提示词')
  assert.ok(order.includes('【只读通道】'), '只读通道教学在场')
  assert.ok(order.includes('/warroom/api/board') && order.includes('/warroom/api/ledger'), '只读端点教学在场')
  assert.ok(order.includes('只许 GET'), '只许 GET 红线句在场')
  assert.ok(!order.includes('/warroom/api/tools/call'), '不教工具写通道'
  )
  assert.ok(!order.includes('/warroom/api/commands\"'), '不教命令写端点')
  assert.ok(order.includes('【图景块格式】') && order.includes('```timeline') && order.includes('```cards'), '图景组件教学在场')
  assert.ok(order.includes('对不上整页拒收'), '对账纪律句在场')
  assert.ok(order.includes('【管理块格式】') && order.includes('【撤令】') && order.includes('【重派】') && order.includes('【定时令】') && order.includes('【绑席】'), '四管理块教学在场')
  assert.ok(!order.includes('war_claim') && !order.includes('war_submit') && !order.includes('war_publish') && !order.includes('war_close_task'), '出口/舰务动词仍然全禁')
})

test('D28 proxySceneBlocksOf：单轮一份、空/超 6000 字弃收计 dropped', () => {
  const good = '# 标题\n```stats\n键: 值\n```'
  const two = `【图景】\n${good}\n\n【图景】\n${good}`
  const out = proxySceneBlocksOf(two)
  assert.equal(out.scene, good, '首份收下')
  assert.equal(out.dropped, 1, '第二份弃收')
  assert.equal(proxySceneBlocksOf('【图景】\n\n【命令】\n正文').scene, null, '空块弃收（body 判空）')
  assert.equal(proxySceneBlocksOf(`【图景】\n${'x'.repeat(PROXY_SCENE_DRAFT_CAP + 1)}`).dropped, 1, '超 6000 字弃收')
})

test('D28 proxyManagementBlocksOf：四类块解析+理由上限+单轮 3 块上限+畸形头忽略', () => {
  const text = [
    '正文话。',
    '【撤令】（cmd-20261020-abcd）',
    '方向变了，不做了。',
    '【重派】（20261020-1234）',
    '上次超时，再试一次。',
    '【定时令】（cmd-20261020-efff）停',
    '【撤令】（cmd-bad',
    '这不构成块头',
  ].join('\n')
  const { blocks, dropped } = proxyManagementBlocksOf(text)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0]!.kind, '撤令')
  assert.equal(blocks[0]!.id, 'cmd-20261020-abcd')
  assert.equal(blocks[0]!.reason, '方向变了，不做了。')
  assert.equal(blocks[1]!.kind, '重派')
  assert.equal(blocks[2]!.kind, '定时令停')
  assert.equal(blocks[2]!.reason, '', '停用块无理由行=空理由（审计可见）')
  assert.equal(dropped, 0)
  // 绑席块：理由位=模型串（可空=沿用当前）。
  const bind = proxyManagementBlocksOf('【绑席】（pi）\nzai/glm-5.2')
  assert.equal(bind.blocks[0]!.kind, '绑席')
  assert.equal(bind.blocks[0]!.id, 'pi')
  assert.equal(bind.blocks[0]!.reason, 'zai/glm-5.2')
  const bindBare = proxyManagementBlocksOf('【绑席】（opencode）')
  assert.equal(bindBare.blocks[0]!.reason, '', '省略模型=空串（daemon 补当前模型）')
  // 理由超 300 字弃收。
  const longReason = ['【撤令】（cmd-x1）', 'y'.repeat(301)].join('\n')
  assert.equal(proxyManagementBlocksOf(longReason).dropped, 1)
  // 单轮 3 块上限（第 4 块起弃收）。
  const many = ['【撤令】（c1）', 'r', '【撤令】（c2）', 'r', '【撤令】（c3）', 'r', '【撤令】（c4）', 'r'].join('\n')
  const capped = proxyManagementBlocksOf(many)
  assert.equal(capped.blocks.length, PROXY_MANAGEMENT_BLOCKS_CAP)
  assert.equal(capped.dropped, 1)
})

test('D28 图景/管理块头强调包裹容忍（glm-5.3 粗体风格）', () => {
  const bold = '**【图景】**\n# t\n```stats\n键: 值\n```\n\n**【撤令】**（cmd-bold）\n理由'
  assert.equal(proxySceneBlocksOf(bold).scene, '# t\n```stats\n键: 值\n```')
  const mgmt = proxyManagementBlocksOf(bold)
  assert.equal(mgmt.blocks.length, 1)
  assert.equal(mgmt.blocks[0]!.id, 'cmd-bold')
})

function getReq(url: string): { method: string; url: string; on(event: string, cb: (chunk?: unknown) => void): void } {
  return { method: 'GET', url, on: (_e, _cb) => {} }
}

test('D28 GET /ledger：scope 过滤、limit 钳制、坏 scope 400；ledgerSlice 两尾形状', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-ledger-'))
  try {
    appendDirectiveEvent(dir, { type: 'directive_created', ts: '2026-10-20T01:00:00.000Z', directiveId: 'cmd-l1', text: '第一条令' })
    appendDirectiveEvent(dir, { type: 'directive_created', ts: '2026-10-20T02:00:00.000Z', directiveId: 'cmd-l2', text: '第二条令' })
    const handler = makeHandler(dir)
    const all = await call(handler, getReq('/warroom/api/ledger'))
    assert.equal(all.body.ok, true)
    assert.ok(Array.isArray(all.body.entries) && all.body.entries.length === 2)
    assert.equal(all.body.entries[0]!.id, 'cmd-l2', '时间降序（最新在前）')
    const scoped = await call(handler, getReq('/warroom/api/ledger?scope=task'))
    assert.equal(scoped.body.entries.length, 0, 'task 面无事件')
    const clamped = await call(handler, getReq('/warroom/api/ledger?limit=99999'))
    assert.equal(clamped.body.limit, 200, 'limit 封顶 200')
    const bad = await call(handler, getReq('/warroom/api/ledger?scope=nonsense'))
    assert.equal(bad.code, 400)
    // ledgerSlice（提示词切片）：时间升序、摘要 clip 生效。
    const slice = ledgerSlice(dir)
    assert.equal(slice.length, 2)
    assert.equal(slice[0]!.id, 'cmd-l1', '升序（读史顺序）')
    assert.ok(slice[0]!.summary.includes('第一条令'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D28 bridge artifact 账面贯通：agent 话轮带 artifact → fold 读回；scene 战报 noticeKind 生效', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-artifact-'))
  try {
    appendBridgeEvent(dir, { type: 'bridge_agent_message', ts: '2026-10-20T03:00:00.000Z', text: '配图说明', agentId: 'proxy-x', artifact: { id: 'scene-abc', title: '舰队晨报' } })
    appendBridgeEvent(dir, { type: 'bridge_system_notice', ts: '2026-10-20T03:01:00.000Z', noticeKind: 'scene', dedupKey: 'scene:proxy-x:t', text: '图景渲染未过对账：cards 编号不在册' })
    const msgs = loadBridgeMessages(dir)
    assert.equal(msgs[0]!.artifact?.id, 'scene-abc', 'artifact 随话轮入账可读回')
    assert.equal(msgs[1]!.noticeKind, 'scene', 'scene 战报第六种在场')
    const legacy = foldBridge([{ type: 'bridge_agent_message', ts: 't', text: '旧消息' }])
    assert.equal(legacy[0]!.artifact, undefined, '旧消息零迁移（条件 spread）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
