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
import { proxyOrderFor, proxyCommandBlocksOf, proxyVerdictBlocksOf, PROXY_COMMAND_BLOCKS_CAP } from '../src/staff.ts'
import { appendDirectiveEvent, loadDirectives } from '../src/directives.ts'
import { loadConfig } from '../src/config.ts'
import { registerDashboard, type RouteRegistry } from '../src/dashboard.ts'

const chat = {
  pending: [{ text: '现在舰队什么情况？', ts: '2026-10-20T10:00:00.000Z' }],
  history: [
    { role: 'you' as const, text: '舰长曾说过的话' },
    { role: 'manager' as const, text: '你上轮的答复' },
    { role: 'system' as const, text: '战报：t-1 已交证待验收' },
  ],
  digest: JSON.stringify({ pendingDecisions: [], commands: [], tasks: [], stats: { commands: 0, tasks: 0, inProgress: 0, reported: 0, failed: 0 } }),
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

test('【命令】块解析：单轮上限 5 条——超出部分弃收防幻觉风暴', () => {
  const text = Array.from({ length: PROXY_COMMAND_BLOCKS_CAP + 2 }, (_, i) => `【命令】\n第 ${i} 号命令`).join('\n')
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
