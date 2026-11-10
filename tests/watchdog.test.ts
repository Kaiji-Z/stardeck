/**
 * D39-B Watchdog 哨兵测试：判据矩阵（龄期×静默双超窗、已旗不重复、非
 * in_progress 不判、旗关零出）、fold 侧记旗/清旗（活性事件自愈——claim/
 * submit/comment/结算事件）、老账本零迁移（未知事件 no-op）。
 * @module stardeck/tests/watchdog
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { watchdogVerdict } = await import('../src/watchdog.ts')
const { foldCampaign } = await import('../src/events.ts')

const MIN = 60_000
const now = Date.parse('2026-11-10T12:00:00Z')
const cfg = { enabled: true, enforce: false, silenceMin: 20, ageMin: 45 }

function task(over: Record<string, unknown> = {}) {
  return {
    campaignId: 'task-1', status: 'in_progress', startedAt: '2026-11-10T10:00:00Z',
    attemptLog: [{ id: 'a1', n: 1, sessionId: 's1', startedAt: '2026-11-10T11:00:00Z' }],
    ...over,
  }
}
function session(over: Record<string, unknown> = {}) {
  return { taskId: 'task-1', agentId: 'oc-1', logMtimeMs: now - 30 * MIN, startedAtMs: now - 60 * MIN, ...over }
}

test('判据矩阵：双超窗才记旗；单超窗/未领取/他任务/已旗/旗关=零出', () => {
  // 双超窗（龄期 60min>45、静默 30min>20）→ 记旗。
  assert.equal(watchdogVerdict([task()], [session()], now, cfg).length, 1)
  // 静默未超（日志 10 分钟前还热）→ 不判。
  assert.equal(watchdogVerdict([task()], [session({ logMtimeMs: now - 10 * MIN })], now, cfg).length, 0)
  // 龄期未超（attempt 11:30 起=30min<45）→ 不判（即便静默已超）。
  assert.equal(watchdogVerdict([task({ attemptLog: [{ id: 'a1', n: 1, sessionId: 's1', startedAt: '2026-11-10T11:30:00Z' }] })], [session()], now, cfg).length, 0)
  // 非 in_progress（reported）→ 不判。
  assert.equal(watchdogVerdict([task({ status: 'reported' })], [session()], now, cfg).length, 0)
  // 已旗（watchdog 在场）→ 不重复记。
  assert.equal(watchdogVerdict([task({ watchdog: { flaggedAt: '2026-11-10T11:50:00Z', reason: 'r' } })], [session()], now, cfg).length, 0)
  // 总闸关 → 恒零。
  assert.equal(watchdogVerdict([task()], [session()], now, { ...cfg, enabled: false }).length, 0)
  // 会话属别的任务（registry 里挂着但任务列表没有）→ 不判。
  assert.equal(watchdogVerdict([task()], [session({ taskId: 'task-other' })], now, cfg).length, 0)
})

test('记旗 payload：reason 含双窗数字；silenceMs/ageMs 如实', () => {
  const [flag] = watchdogVerdict([task()], [session()], now, cfg)
  assert.equal(flag.taskId, 'task-1')
  assert.equal(flag.agentId, 'oc-1')
  assert.equal(flag.silenceMs, 30 * MIN)
  assert.equal(flag.ageMs, 60 * MIN)
  assert.match(flag.reason, /龄期 60 分钟/)
  assert.match(flag.reason, /静默 30 分钟/)
})

// ── fold 侧：记旗（后写覆盖）+ 活性/结算事件清旗 + 老账本兼容 ──
function folded(extra: unknown[]): ReturnType<typeof foldCampaign> {
  return foldCampaign('task-1', [
    { type: 'task_created', ts: '2026-11-10T10:00:00Z', campaignId: 'task-1', title: 't', brief: 'b', acceptance: 'a', priority: 'normal' },
    ...extra as never[],
  ])
}
const claimed = { type: 'task_claimed', ts: '2026-11-10T11:00:00Z', campaignId: 'task-1', claimedBy: 's1', attemptId: 'a1', attempt: 1 }
const flagged = { type: 'task_watchdog_flagged', ts: '2026-11-10T11:50:00Z', campaignId: 'task-1', reason: '疑似卡住', silenceMs: 30 * MIN, ageMs: 60 * MIN, from: 'oc-1' }

test('fold：task_watchdog_flagged 置旗（后写覆盖保最新）', () => {
  const s = folded([claimed, flagged])
  assert.equal(s.watchdog?.reason, '疑似卡住')
  assert.equal(s.watchdog?.flaggedAt, '2026-11-10T11:50:00Z')
  const s2 = folded([claimed, flagged, { ...flagged, ts: '2026-11-10T11:55:00Z', reason: '仍卡' }])
  assert.equal(s2.watchdog?.flaggedAt, '2026-11-10T11:55:00Z', '后写覆盖')
})

test('fold：活性/结算事件清旗——claim（新 attempt=新生命）/comment/submit/attempt_failed/requeue/failed/close', () => {
  for (const clearEvent of [
    { type: 'task_commented', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', comment: '还在干', from: 'oc-1' },
    { type: 'task_submitted', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', report: '交证', from: 'oc-1' },
    { type: 'task_attempt_failed', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', reason: 'r' },
    { type: 'task_requeued', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', reason: 'r' },
    { type: 'task_failed', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', reason: 'r' },
    { type: 'task_closed', ts: '2026-11-10T11:55:00Z', campaignId: 'task-1', verdict: '通过收官' },
  ]) {
    assert.equal(folded([claimed, flagged, clearEvent]).watchdog, undefined, `${(clearEvent as { type: string }).type} 清旗`)
  }
  // 新 claim=新生命：旗随旧 attempt 作废。
  assert.equal(folded([claimed, flagged, { type: 'task_claimed', ts: '2026-11-10T11:58:00Z', campaignId: 'task-1', claimedBy: 's2', attemptId: 'a2', attempt: 2 }]).watchdog, undefined)
})

test('老账本零迁移：无 watchdog 事件的日志 fold 照旧；未知事件（未来型）no-op 不炸', () => {
  const s = folded([claimed])
  assert.equal(s.watchdog, undefined)
  const s2 = folded([claimed, { type: 'future_event_xyz', ts: 't', campaignId: 'task-1' }])
  assert.equal(s2.watchdog, undefined)
  assert.equal(s2.status, 'in_progress')
})
