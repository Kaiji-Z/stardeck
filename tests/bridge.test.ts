/**
 * D26 舰桥频道账本测试：append/fold 往返、未答判定、携史窗口、机械战报五触发
 * 与幂等（dedupKey=源事件指纹）、崩断半行容错。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendBridgeEvent, loadBridgeMessages, foldBridge, bridgeUnanswered, bridgeHistoryWindow, bridgeNoticeKeys, collectBridgeNoticeEvents, syncBridgeNotices, estimateTokens, type BridgeEvent, type BridgeMessage } from '../src/bridge.ts'
import { appendDirectiveEvent } from '../src/directives.ts'
import { appendEvent } from '../src/events.ts'

function tmpStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'warroom-bridge-'))
}

test('bridge：append + fold 往返——user/agent/system 三态与 refs/dedupKey/会话字段', () => {
  const dir = tmpStateDir()
  try {
    appendBridgeEvent(dir, { type: 'bridge_user_message', ts: '2026-10-20T10:00:00Z', text: '现在舰队什么情况？' })
    appendBridgeEvent(dir, { type: 'bridge_agent_message', ts: '2026-10-20T10:00:30Z', text: '一切平稳。', commandRefs: ['cmd-1'], agentId: 'staff-abc', sessionId: 'ses_1' })
    appendBridgeEvent(dir, { type: 'bridge_system_notice', ts: '2026-10-20T10:01:00Z', noticeKind: 'reported', dedupKey: 'reported:t1:2026', text: '任务交证待你验收', refs: { taskId: 't1' } })
    const msgs = loadBridgeMessages(dir)
    assert.equal(msgs.length, 3)
    assert.equal(msgs[0]!.kind, 'user')
    assert.equal(msgs[1]!.commandRefs?.[0], 'cmd-1')
    assert.equal(msgs[1]!.agentId, 'staff-abc')
    assert.equal(msgs[1]!.sessionId, 'ses_1')
    assert.equal(msgs[2]!.noticeKind, 'reported')
    assert.equal(msgs[2]!.dedupKey, 'reported:t1:2026')
    assert.equal(msgs[2]!.refs?.taskId, 't1')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge：未答判定——末次经理人话轮之后的 user 集合；机械战报不算「答」', () => {
  const msgs = foldBridge([
    { type: 'bridge_user_message', ts: '01', text: 'a' },
    { type: 'bridge_agent_message', ts: '02', text: '回' },
    { type: 'bridge_system_notice', ts: '03', noticeKind: 'reported', dedupKey: 'k', text: '战报' },
    { type: 'bridge_user_message', ts: '04', text: 'b' },
    { type: 'bridge_user_message', ts: '05', text: 'c' },
  ] as BridgeEvent[])
  const pending = bridgeUnanswered(msgs)
  assert.equal(pending.length, 2)
  assert.equal(pending[0]!.text, 'b')
  assert.equal(pending[1]!.text, 'c')
  // 战报在末答之后也不清空待答（03 在 02 后、04/05 仍待答——上断言已证）。
  const noneAfterReply = bridgeUnanswered(foldBridge([
    { type: 'bridge_user_message', ts: '01', text: 'a' },
    { type: 'bridge_agent_message', ts: '02', text: '回' },
  ] as BridgeEvent[]))
  assert.equal(noneAfterReply.length, 0)
})

test('bridge：携史窗口——末 cap 条 + role 归一（you/manager/system）', () => {
  const events: BridgeEvent[] = []
  for (let i = 0; i < 30; i++) {
    events.push(i % 2 === 0
      ? { type: 'bridge_user_message', ts: String(i).padStart(2, '0'), text: `u${i}` }
      : { type: 'bridge_agent_message', ts: String(i).padStart(2, '0'), text: `m${i}` })
  }
  const win = bridgeHistoryWindow(foldBridge(events), 5)
  assert.equal(win.length, 5)
  assert.equal(win[0]!.role, 'manager')
  assert.equal(win[0]!.text, 'm25')
  assert.equal(win[4]!.role, 'manager')
  assert.equal(win[4]!.text, 'm29')
})

// ── D37：token 估算纯函数 + 携史窗口 token 预算双闸 ──

test('D37 estimateTokens 启发式：CJK 1.1 token/字、其他 4 字符/token、空串零', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('你好吗'), 3, '3 CJK → round(3×1.1)=3')
  assert.equal(estimateTokens('abcdefgh'), 2, '8 ASCII → 8/4=2')
  assert.equal(estimateTokens('a你'), 1, '混合 → round(1.1+0.25)=1')
})

test('D37 bridgeHistoryWindow token 预算：从新往旧装、超即停、至少保最新；无预算=纯条数闸', () => {
  const mk = (kind: 'user' | 'agent' | 'system', text: string): BridgeMessage => ({ kind, ts: '2026-10-24T00:00:00Z', text })
  const m1 = mk('user', 'x'.repeat(400)) // ~100 token
  const m2 = mk('agent', 'y'.repeat(400)) // ~100 token
  const m3 = mk('user', '短') // 1 token
  const m4 = mk('agent', '答') // 1 token
  const budget = estimateTokens('短') + estimateTokens('答')
  assert.deepEqual(bridgeHistoryWindow([m1, m2, m3, m4], 24, budget).map(w => w.text), ['短', '答'], '长旧话让位，预算内的最新话保住')
  assert.equal(bridgeHistoryWindow([m1], 24, 1).length, 1, '预算再小也至少保最新一条')
  assert.deepEqual(bridgeHistoryWindow([m1, m2, m3, m4], 3).map(w => w.text), ['y'.repeat(400), '短', '答'], '无预算=旧语义纯条数闸不变')
  assert.deepEqual(bridgeHistoryWindow([m1, m2, m3, m4], 24, 10_000).length, 4, '预算宽裕=全装')
})

test('D37 bridge_agent_message meta 字段：入账→fold 透传（旧消息零迁移）', () => {
  const msgs = foldBridge([
    { type: 'bridge_user_message', ts: '01', text: '问' },
    { type: 'bridge_agent_message', ts: '02', text: '答', agentId: 'proxy-loop', meta: { model: 'glm-5.3', effort: 'deep', elapsedMs: 4200, promptTokens: 1200, completionTokens: 340 } },
  ] as BridgeEvent[])
  assert.equal(msgs[1]!.meta?.model, 'glm-5.3')
  assert.equal(msgs[1]!.meta?.effort, 'deep')
  assert.equal(msgs[1]!.meta?.promptTokens, 1200)
  // 老形态（无 meta）照常 fold——零迁移红线。
  const legacy = foldBridge([{ type: 'bridge_agent_message', ts: '03', text: '老话' }] as BridgeEvent[])
  assert.equal(legacy[0]!.meta, undefined)
})

test('bridge：机械战报五触发——澄清/定时派发/成任务/交证/失败/收官齐报到', () => {
  const dir = tmpStateDir()
  try {
    const now = new Date()
    appendDirectiveEvent(dir, { type: 'directive_created', ts: now.toISOString(), directiveId: 'cmd-a', text: '做个工具', cron: '0 9 * * *' })
    appendDirectiveEvent(dir, { type: 'directive_dispatched', ts: now.toISOString(), directiveId: 'cmd-a' })
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: now.toISOString(), directiveId: 'cmd-b', questions: ['1. 用哪个仓？'], options: [['A x仓', 'B 你帮我定']] })
    appendDirectiveEvent(dir, { type: 'directive_approved', ts: now.toISOString(), directiveId: 'cmd-a', taskId: 't1' })
    appendEvent(dir, { type: 'task_created', ts: now.toISOString(), campaignId: 't1', title: '任务一', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_submitted', ts: now.toISOString(), campaignId: 't1', from: 'exec-1', report: '全部通过' })
    appendEvent(dir, { type: 'task_created', ts: now.toISOString(), campaignId: 't2', title: '任务二', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_failed', ts: now.toISOString(), campaignId: 't2', reason: '第三次尝试失败' })
    appendEvent(dir, { type: 'task_created', ts: now.toISOString(), campaignId: 't3', title: '任务三', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_closed', ts: now.toISOString(), campaignId: 't3', verdict: '验收通过' })
    const kinds = new Set(collectBridgeNoticeEvents(dir, now).map(e => (e as { noticeKind: string }).noticeKind))
    for (const k of ['clarify', 'scheduled', 'terminal', 'reported', 'retry']) assert.ok(kinds.has(k), `触发缺 ${k}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge：syncBridgeNotices 幂等——同源事件指纹永只报一次', () => {
  const dir = tmpStateDir()
  try {
    const now = new Date()
    appendEvent(dir, { type: 'task_created', ts: now.toISOString(), campaignId: 't1', title: '任务一', brief: 'b', acceptance: 'a', priority: 'normal' })
    appendEvent(dir, { type: 'task_submitted', ts: now.toISOString(), campaignId: 't1', from: 'exec-1', report: 'ok' })
    const first = syncBridgeNotices(dir, now)
    assert.equal(first, 1)
    const second = syncBridgeNotices(dir, new Date(now.getTime() + 60_000))
    assert.equal(second, 0, '幂等：同源指纹不重复入账')
    assert.equal(bridgeNoticeKeys(loadBridgeMessages(dir)).size, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge：崩断半行容错——前半行坏 JSON 被跳过，后续事件照常可见', () => {
  const dir = tmpStateDir()
  try {
    appendBridgeEvent(dir, { type: 'bridge_user_message', ts: '01', text: 'a' })
    // 手工写一条无换行的半行 + 下一条正常事件（模拟崩断后重启追加）。
    const file = join(dir, 'bridge.jsonl')
    writeFileSync(file, readFileSync(file, 'utf8') + '{"type":"bridge_user_mes', 'utf8')
    appendBridgeEvent(dir, { type: 'bridge_user_message', ts: '02', text: 'b' })
    const texts = loadBridgeMessages(dir).map(m => m.text)
    assert.deepEqual(texts, ['a', 'b'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bridge：战报文本截断——长文本 120 字封顶带省略号，换行压平', () => {
  const dir = tmpStateDir()
  try {
    const now = new Date()
    appendDirectiveEvent(dir, { type: 'directive_created', ts: now.toISOString(), directiveId: 'cmd-long', text: `长命令${'字'.repeat(200)}` })
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: now.toISOString(), directiveId: 'cmd-long', questions: ['1. 问'], options: [[]] })
    const notices = collectBridgeNoticeEvents(dir, now)
    const text = (notices[0] as { text: string }).text
    assert.ok(text.length < 220, `截断生效：${text.length}`)
    assert.ok(!text.includes('\n'), '换行压平')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
