/**
 * D26 舰桥频道路由测试：三端点（messages GET/POST、digest）、旗 OFF 面 404
 * 与 /board 零 bridge 字段（字节等价红线）、revision 六账本、answer 通道
 * channel:'bridge' 透传、digest 待决语义（sign/clarify/review/retry）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendBridgeEvent } from '../src/bridge.ts'
import { appendDirectiveEvent } from '../src/directives.ts'
import { appendEvent } from '../src/events.ts'
import { boardRevision, bridgeDigest, registerDashboard, type RouteRegistry } from '../src/dashboard.ts'

function tmpStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'warroom-bridge-routes-'))
}

function fakeStore(active = true) {
  return { get: () => ({ version: 2 as const, active }), save: () => {} }
}

function getReq(url: string): { method: string; url: string } {
  return { method: 'GET', url }
}

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

function makeHandler(stateDir: string, deps: Record<string, unknown> = {}): {
  handler: (req: unknown, res: unknown) => Promise<void>
} {
  let handler: ((req: unknown, res: unknown) => void | Promise<void>) | undefined
  const registry: RouteRegistry = { register: route => { handler = route.handler; return () => {} } }
  registerDashboard(registry, {
    store: fakeStore() as never,
    stateDir,
    roster: () => ({ units: [], errors: [] }) as never,
    warRoot: '/w',
    ...deps,
  } as never)
  return { handler: (req, res) => Promise.resolve(handler!(req, res)) }
}

async function call(handler: (req: unknown, res: unknown) => Promise<void>, req: unknown): Promise<{ code: number; body: any }> {
  let body = ''
  const res: { setHeader(): void; write(): boolean; end(b?: string): void; on(): void; statusCode: number } = {
    setHeader: () => {},
    write: () => true,
    end: (b?: string) => { body = b ?? '' },
    on: () => {},
    statusCode: 200,
  }
  await handler(req, res)
  return { code: res.statusCode, body: body === '' ? {} : JSON.parse(body) }
}

test('bridge 路由：旗 OFF 面——三端点 404、/board 无 bridge 字段（字节等价）', async () => {
  const dir = tmpStateDir()
  try {
    const { handler } = makeHandler(dir, {}) // bridgeEnabled 缺席=OFF
    const msgs = await call(handler, getReq('/warroom/api/bridge/messages'))
    assert.equal(msgs.code, 404)
    const post = await call(handler, postReq('/warroom/api/bridge/messages', { text: 'hi' }))
    assert.equal(post.code, 404)
    const digest = await call(handler, getReq('/warroom/api/bridge/digest'))
    assert.equal(digest.code, 404)
    const board = await call(handler, getReq('/warroom/api/board'))
    assert.equal(board.code, 200)
    assert.equal('bridge' in board.body, false, '旗 OFF：/board 不带 bridge 面')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge 路由：旗 ON 面——/board 带 bridge.enabled；消息三端点全通', async () => {
  const dir = tmpStateDir()
  try {
    const { handler } = makeHandler(dir, { bridgeEnabled: true })
    const board = await call(handler, getReq('/warroom/api/board'))
    assert.equal(board.body.bridge?.enabled, true)
    // POST 校验三态：空 400 / 超长 400 / 正常 200 且落账。
    assert.equal((await call(handler, postReq('/warroom/api/bridge/messages', { text: '   ' }))).code, 400)
    assert.equal((await call(handler, postReq('/warroom/api/bridge/messages', { text: 'x'.repeat(8001) }))).code, 400)
    const sent = await call(handler, postReq('/warroom/api/bridge/messages', { text: '舰队什么情况？' }))
    assert.equal(sent.code, 200)
    assert.equal(typeof sent.body.ts, 'string')
    // GET 全量与 since 增量。
    const all = await call(handler, getReq('/warroom/api/bridge/messages'))
    assert.equal(all.code, 200)
    assert.equal(all.body.messages.length, 1)
    assert.equal(all.body.messages[0].text, '舰队什么情况？')
    const since = await call(handler, getReq(`/warroom/api/bridge/messages?since=${encodeURIComponent(sent.body.ts)}`))
    assert.equal(since.body.messages.length, 0, 'since 增量：已读之后无新')
    // digest 端点在。
    const digest = await call(handler, getReq('/warroom/api/bridge/digest'))
    assert.equal(digest.code, 200)
    assert.ok(Array.isArray(digest.body.digest.pendingDecisions))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge 路由：revision 六账本——bridge.jsonl 追加即 revision 变化', async () => {
  const dir = tmpStateDir()
  try {
    const before = boardRevision(dir)
    appendBridgeEvent(dir, { type: 'bridge_user_message', ts: new Date().toISOString(), text: 'hi' })
    const after = boardRevision(dir)
    assert.notEqual(before, after, 'bridge 入 revision 签名')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge 路由：answer 通道透传——channel=bridge 落到注入实现', async () => {
  const dir = tmpStateDir()
  try {
    const seen: Array<{ commandId: string; text: string; channel?: string }> = []
    const { handler } = makeHandler(dir, {
      bridgeEnabled: true,
      answerCommand: async (commandId: string, text: string, channel?: string) => {
        seen.push({ commandId, text, channel })
        return { ok: true, note: 'ok' }
      },
    })
    const out = await call(handler, postReq('/warroom/api/commands/answer', { commandId: 'cmd-x', text: '1A;2B', channel: 'bridge' }))
    assert.equal(out.code, 200)
    assert.equal(seen[0]!.channel, 'bridge')
    // 缺省仍是 board；脏值归一 board。
    await call(handler, postReq('/warroom/api/commands/answer', { commandId: 'cmd-x', text: 'y' }))
    await call(handler, postReq('/warroom/api/commands/answer', { commandId: 'cmd-x', text: 'z', channel: 'irc' }))
    assert.equal(seen[1]!.channel, 'board')
    assert.equal(seen[2]!.channel, 'board')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge digest：待决四语义——plan 待签>clarify（同令只出 sign）、reported=review、failed=retry', () => {
  const dir = tmpStateDir()
  try {
    const now = new Date().toISOString()
    appendDirectiveEvent(dir, { type: 'directive_created', ts: now, directiveId: 'cmd-sign', text: '签发令' })
    appendDirectiveEvent(dir, { type: 'directive_received', ts: now, directiveId: 'cmd-sign', staffSessionId: 's1' })
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: now, directiveId: 'cmd-sign', questions: ['1. q'], options: [[]] })
    appendDirectiveEvent(dir, { type: 'directive_clarification_answered', ts: now, directiveId: 'cmd-sign', text: '1A', channel: 'board' })
    appendDirectiveEvent(dir, { type: 'directive_brief_ready', ts: now, directiveId: 'cmd-sign', goal: 'g', background: 'b', acceptance: 'a', nonGoals: 'n', deliverables: 'd' })
    appendDirectiveEvent(dir, { type: 'directive_plan_opened', ts: now, directiveId: 'cmd-sign', plan: '呈批件' })
    appendDirectiveEvent(dir, { type: 'directive_created', ts: now, directiveId: 'cmd-clar', text: '澄清令' })
    appendDirectiveEvent(dir, { type: 'directive_talking', ts: now, directiveId: 'cmd-clar' })
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: now, directiveId: 'cmd-clar', questions: ['1. q'], options: [[]] })
    appendEvent(dir, { type: 'task_created', ts: now, campaignId: 't-r', title: '验收任务', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_submitted', ts: now, campaignId: 't-r', from: 'e1', report: '战报全文' })
    appendEvent(dir, { type: 'task_created', ts: now, campaignId: 't-f', title: '失败任务', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_failed', ts: now, campaignId: 't-f', reason: '尝试耗尽' })
    const d = bridgeDigest(dir)
    const kinds = d.pendingDecisions.map(p => `${p.kind}:${p.refId}`)
    assert.ok(kinds.includes('sign:cmd-sign'), `plan 待签→sign：${kinds}`)
    assert.ok(!kinds.includes('clarify:cmd-sign'), '同令 plan 待签胜出，不出重复 clarify 行')
    assert.ok(kinds.includes('clarify:cmd-clar'), `talking+澄清挂起→clarify：${kinds}`)
    assert.ok(kinds.includes('review:t-r'), `reported→review：${kinds}`)
    assert.ok(kinds.includes('retry:t-f'), `failed→retry：${kinds}`)
    assert.equal(d.stats.reported, 1)
    assert.equal(d.stats.failed, 1)
    const taskFace = d.tasks.find(t => t.taskId === 't-r')
    assert.equal(taskFace?.latestReport, '战报全文')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge digest：紧凑封顶——commands ≤8、tasks ≤8、标题/战报截断', () => {
  const dir = tmpStateDir()
  try {
    const now = new Date().toISOString()
    for (let i = 0; i < 12; i++) appendDirectiveEvent(dir, { type: 'directive_created', ts: now, directiveId: `cmd-${i}`, text: `${'令'.repeat(100)}${i}` })
    for (let i = 0; i < 12; i++) {
      appendEvent(dir, { type: 'task_created', ts: now, campaignId: `t-${i}`, title: `${'题'.repeat(100)}${i}`, brief: 'b', acceptance: 'a', priority: 'normal' })
    }
    const d = bridgeDigest(dir)
    assert.equal(d.commands.length, 8)
    assert.equal(d.tasks.length, 8)
    assert.ok(d.commands[0].title.length <= 61, '命令标题截断')
    assert.ok(d.tasks.every(t => t.title.length <= 61), '任务标题截断')
    assert.equal(d.stats.commands, 12)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
