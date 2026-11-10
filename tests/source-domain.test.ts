/**
 * D39 事件源进水口·纯域测试：准入门矩阵（allow×off/observe/auto）、sources
 * fold（幂等去重/计数归一/游标/回写 3 连败 dropped）、确定性命令号、组卡文、
 * 组稿（机械战报三形+路径消毒）、订阅表（终态退订）、directive fold 的
 * origin/inputs（老账本零迁移）。
 * @module stardeck/tests/source-domain
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  admitTrigger, ingestSourceTrigger, loadSourceFold, foldSources, deterministicDirectiveId,
  composeTriggerText, composeWritebackBody, subscriptionIndex, fanoutTriggerToDirective,
  writebackPending, writebackKeyClosed, WRITEBACK_MAX_ATTEMPTS, sourceKey, appendSourceEvents,
} = await import('../src/sources.ts')
const { foldDirectives, DIRECTIVE_INPUTS_CAP, readDirectiveEvents } = await import('../src/directives.ts')
type DirectiveEvent = import('../src/directives.ts').DirectiveEvent

function tempState(): string { return mkdtempSync(join(tmpdir(), 'sd-src-')) }

// ── 准入门矩阵（零模型——superagent off/observe/auto 阶梯） ──
test('准入门：名单内任何档=显式建卡；名单外 off=拒/observe=记录/auto=建卡', () => {
  const gate = (mode: 'off' | 'observe' | 'auto', allow: string[] = []) => ({ allow, mode })
  assert.deepEqual(admitTrigger(gate('off', ['alice']), { author: 'alice' }), { strength: 'explicit', disposition: 'admitted' })
  assert.equal(admitTrigger(gate('off', ['alice']), { author: 'bob' }).disposition, 'filtered')
  assert.deepEqual(admitTrigger(gate('observe', ['alice']), { author: 'bob' }), { strength: 'inferred', disposition: 'observed', reason: '名单外作者，observe 档只记录不建卡' })
  assert.deepEqual(admitTrigger(gate('auto', ['alice']), { author: 'bob' }), { strength: 'inferred', disposition: 'admitted' })
  // '*' 通配=全员显式（ingest 默认本地信任面）。
  assert.equal(admitTrigger(gate('off', ['*']), { author: 'anyone' }).disposition, 'admitted')
  assert.equal(admitTrigger(gate('off', ['*']), { author: 'anyone' }).strength, 'explicit')
})

// ── 入账收口：幂等 + 确定性 id + 处置留痕 ──
test('ingestSourceTrigger：admitted 建卡（确定性 id+origin+issuedBy）、幂等重放 duplicate', () => {
  const dir = tempState()
  try {
    const trigger = {
      sourceId: 'github:o/r', externalId: 'issue:12', kind: 'issue' as const, threadKey: 'github:o/r#12',
      author: 'alice', text: '修一下登录页的 500', title: '登录 500',
    }
    const r1 = ingestSourceTrigger(dir, { allow: ['alice'], mode: 'off' }, trigger)
    assert.equal(r1.duplicate, false)
    assert.equal(r1.verdict.disposition, 'admitted')
    assert.equal(r1.directiveId, deterministicDirectiveId('github:o/r', 'issue:12'))
    // 卡已建：origin（Mandate-lite）+issuedBy（github:alice）。
    const cards = foldDirectives(readDirectiveEvents(dir))
    assert.equal(cards.length, 1)
    assert.equal(cards[0]!.origin?.source, 'github')
    assert.equal(cards[0]!.origin?.strength, 'explicit')
    assert.equal(cards[0]!.origin?.threadKey, 'github:o/r#12')
    assert.equal(cards[0]!.issuedBy, 'github:alice')
    // 幂等：同 externalId 再来=duplicate，卡数不增。
    const r2 = ingestSourceTrigger(dir, { allow: ['alice'], mode: 'auto' }, trigger)
    assert.equal(r2.duplicate, true)
    assert.equal(readDirectiveEvents(dir).length, 1)
    // 崩溃窗自愈（确定性 id）：重放 directive_created 同 id=fold no-op 不产第二张卡。
    const events = readDirectiveEvents(dir)
    const dup = [...events, events.find(e => e.type === 'directive_created')!] as DirectiveEvent[]
    assert.equal(foldDirectives(dup).length, 1)
    // 处置留痕 + 计数。
    const fold = loadSourceFold(dir)
    assert.equal(fold.counts.admitted, 1)
    assert.equal(fold.seen.get(sourceKey('github:o/r', 'issue:12'))?.directiveId, deterministicDirectiveId('github:o/r', 'issue:12'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('ingestSourceTrigger：observe 档名单外只记录不建卡（半自主中间档）', () => {
  const dir = tempState()
  try {
    const r = ingestSourceTrigger(dir, { allow: [], mode: 'observe' }, {
      sourceId: 'github:o/r', externalId: 'issue:13', kind: 'issue', threadKey: 'github:o/r#13',
      author: 'stranger', text: '路过提个需求', title: '需求',
    })
    assert.equal(r.duplicate, false)
    assert.equal(r.verdict.disposition, 'observed')
    assert.equal(r.directiveId, undefined)
    assert.equal(readDirectiveEvents(dir).length, 0, 'observe 不建卡')
    assert.equal(loadSourceFold(dir).counts.observed, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 组卡文与确定性 id ──
test('composeTriggerText：标题+正文+署名行；超长正文截断留指路', () => {
  const short = composeTriggerText({ sourceId: 'github:o/r', externalId: 'i:1', kind: 'issue', threadKey: 'k', author: 'a', text: '正文', title: '标题' })
  assert.ok(short.startsWith('[github:o/r issue] 标题'))
  assert.ok(short.includes('正文'))
  assert.ok(short.includes('(@a'))
  const long = composeTriggerText({ sourceId: 'github:o/r', externalId: 'i:2', kind: 'issue', threadKey: 'k', author: 'a', text: 'x'.repeat(3000), title: 't' })
  assert.ok(long.length < 2200, '截断生效')
  assert.ok(long.includes('全文见来源链接'), '截断指路')
  assert.notEqual(deterministicDirectiveId('s', 'e1'), deterministicDirectiveId('s', 'e2'), '事件异号异卡')
  assert.match(deterministicDirectiveId('s', 'e1'), /^cmd-src-[0-9a-f]{10}$/, '确定性 id 形')
})

// ── 订阅扇出：context-only + 终态退订 + 环形上限 ──
test('订阅表：非终态卡的 threadKey 在册；approved/cancelled 退订（收上下文≠收授权）', () => {
  const idx = subscriptionIndex([
    { id: 'c1', status: 'draft', origin: { source: 'github', kind: 'issue', threadKey: 'github:o/r#1', strength: 'explicit', observedAt: 't' } },
    { id: 'c2', status: 'talking', origin: { source: 'github', kind: 'issue', threadKey: 'github:o/r#2', strength: 'explicit', observedAt: 't' } },
    { id: 'c3', status: 'approved', origin: { source: 'github', kind: 'issue', threadKey: 'github:o/r#3', strength: 'explicit', observedAt: 't' } },
    { id: 'c4', status: 'draft' },
  ])
  assert.equal(idx.get('github:o/r#1'), 'c1')
  assert.equal(idx.get('github:o/r#2'), 'c2')
  assert.equal(idx.has('github:o/r#3'), false, '终态退订')
  assert.equal(idx.size, 2)
})

test('fanout+fold：directive_input 入卡不改 status；终态守卫；环形上限', () => {
  const dir = tempState()
  try {
    const events: DirectiveEvent[] = [
      { type: 'directive_created', ts: '2026-11-10T00:00:00Z', directiveId: 'cmd-a', text: '目标', issuedBy: 'github:alice', origin: { source: 'github', kind: 'issue', threadKey: 'github:o/r#12', strength: 'explicit', observedAt: '2026-11-10T00:00:00Z' } },
    ]
    for (let i = 0; i < DIRECTIVE_INPUTS_CAP + 5; i++) {
      assert.equal(fanoutTriggerToDirective(dir, { sourceId: 'github:o/r', externalId: `issue:12:comment:${i}`, kind: 'comment', threadKey: 'github:o/r#12', author: 'bob', text: `评论 ${i}` }, 'cmd-a'), true)
    }
    // 幂等：同 externalId 再扇出=false。
    assert.equal(fanoutTriggerToDirective(dir, { sourceId: 'github:o/r', externalId: 'issue:12:comment:0', kind: 'comment', threadKey: 'github:o/r#12', author: 'bob', text: 'x' }, 'cmd-a'), false)
    const cards = foldDirectives([...events, ...readDirectiveEvents(dir).filter(e => e.type === 'directive_input')])
    const card = cards.find(c => c.id === 'cmd-a')!
    assert.equal(card.status, 'draft', 'context-only 不改状态')
    assert.equal(card.inputs?.length, DIRECTIVE_INPUTS_CAP, '环形截尾')
    assert.equal(card.inputs?.[card.inputs.length - 1]?.text, `评论 ${DIRECTIVE_INPUTS_CAP + 4}`, '保最近')
    assert.equal(loadSourceFold(dir).counts.fanned, DIRECTIVE_INPUTS_CAP + 5)
    // 终态守卫：approved 后的 directive_input fold 层不再入（第二道防线）。
    const after: DirectiveEvent[] = [...events, { type: 'directive_approved' as never, ts: 't2', directiveId: 'cmd-a', taskId: 'task-1' } as unknown as DirectiveEvent, { type: 'directive_input', ts: 't3', directiveId: 'cmd-a', text: 'late' }]
    const card2 = foldDirectives(after).find(c => c.id === 'cmd-a')!
    assert.equal(card2.status, 'approved')
    assert.equal(card2.inputs, undefined, '终态卡不吃新件')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 老账本零迁移 ──
test('老账本零迁移：无 origin/inputs 字段的旧事件 fold 照旧（undefined 非报错）', () => {
  const cards = foldDirectives([
    { type: 'directive_created', ts: 't', directiveId: 'cmd-old', text: '旧令' },
    { type: 'directive_triaged', ts: 't2', directiveId: 'cmd-old', grade: 'L0', reason: 'r' },
  ])
  assert.equal(cards[0]!.origin, undefined)
  assert.equal(cards[0]!.inputs, undefined)
  assert.equal(cards[0]!.status, 'draft')
})

// ── 回写：fold 计数 + dropped ──
test('回写 fold：ok 即完成；3 连败 dropped（writebackPending=false）', () => {
  const ts = '2026-11-10T00:00:00Z'
  const key = writebackKeyClosed('task-9')
  const mk = (ok: boolean, i: number): { type: 'source_writeback_posted'; ts: string; sourceId: string; dedupKey: string; directiveId: string; taskId: string; url: string; ok: boolean; error?: string } =>
    ({ type: 'source_writeback_posted', ts, sourceId: 'github:o/r', dedupKey: key, directiveId: 'cmd-x', taskId: 'task-9', url: ok ? 'https://g/1' : '', ok, ...(ok ? {} : { error: `e${i}` }) })
  assert.equal(writebackPending(foldSources([mk(false, 1)]).writebacks.get(key)), true, '首败仍试')
  const two = foldSources([mk(false, 1), mk(false, 2)]).writebacks.get(key)!
  assert.equal(two.attempts, 2)
  assert.equal(writebackPending(two), true, '两败仍试')
  const three = foldSources([mk(false, 1), mk(false, 2), mk(false, 3)]).writebacks.get(key)!
  assert.equal(writebackPending(three), false, `3 连败弃发（MAX=${WRITEBACK_MAX_ATTEMPTS}）`)
  const done = foldSources([mk(false, 1), mk(true, 2)]).writebacks.get(key)!
  assert.equal(done.ok, true)
  assert.equal(writebackPending(done), false, '成功不再发')
  assert.equal(done.url, 'https://g/1')
})

// ── 游标 ──
test('游标随账本走（重启不重放）：source_cursor_advanced 后写覆盖', () => {
  const dir = tempState()
  try {
    appendSourceEvents(dir, [
      { type: 'source_cursor_advanced', ts: 't1', sourceId: 'github:o/r', watermark: '2026-11-10T00:00:00Z' },
      { type: 'source_cursor_advanced', ts: 't2', sourceId: 'github:o/r', watermark: '2026-11-10T01:00:00Z' },
    ])
    assert.equal(loadSourceFold(dir).cursors.get('github:o/r'), '2026-11-10T01:00:00Z')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 组稿（机械战报三形 + 路径消毒） ──
test('composeWritebackBody：closed 形=结论先行+交付物+KillCredit 证据；路径消毒', () => {
  const task = {
    campaignId: 'task-1', title: '修登录 500', status: 'closed' as const, closedVerdict: '通过收官',
    workspacePath: 'C:/secret/warroom/tasks/task-1',
    reports: [{ ts: 't', from: 'oc-1', text: '已修复 C:/secret/warroom/tasks/task-1/login.ts 的空指针', evidence: { checks: [{ item: '修复', passed: true }], tests: { command: 'pnpm test', exitCode: 0, passed: 5, failed: 0 } } }],
    deliverables: [{ kind: 'files' as const, summary: 'src/login.ts', ts: 't' }],
    attemptLog: [], comments: [], messages: [], subtasks: new Map(), units: new Map(), rounds: 0, attempts: 1, intent: '', startedAt: 't',
  }
  const body = composeWritebackBody('closed', { text: '[GitHub issue #12] 修登录 500' }, task)
  assert.ok(body.startsWith('【stardeck 战报】任务收官'), '结论先行')
  assert.ok(body.includes('判定：通过收官'))
  assert.ok(body.includes('- src/login.ts'), '交付物清单')
  assert.ok(body.includes('1/1 通过'), 'KillCredit 判据')
  assert.ok(body.includes('退出码 0'), '测试退出码')
  assert.ok(!body.includes('C:/secret'), '内部路径消毒')
  assert.ok(body.includes('下一步'), '给下一步')
  const failed = composeWritebackBody('failed', { text: 'x' }, { ...task, status: 'failed' as never, lastError: '网络不通' })
  assert.ok(failed.includes('任务失败'))
  assert.ok(failed.includes('网络不通'))
  const cancelled = composeWritebackBody('cancelled', { text: '[GitHub issue #13] 需求' }, undefined)
  assert.ok(cancelled.includes('命令已撤销'))
})
