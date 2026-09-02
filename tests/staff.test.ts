/**
 * 大副外聘（HANDOFF①）的确定性回归：staffWorklist 工单判定（终态/未到点/
 * 待批不出单、中断重试、L0 直发、L1/L2 计划态路由）+ staffOrderFor 征召令
 * 快照门（措辞改动必须显式更新 fixtures——同 prompts-snapshot 纪律：
 * `WARROOM_UPDATE_SNAPSHOTS=1 node --import tsx --test tests/staff.test.ts`）。
 * 大副边界红线一并点名断言：征召令不得教 war_claim/war_submit（那是外勤
 * 的出口协议，大副替外勤交证=伪造账本）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendDirectiveEvent, loadDirectives } from '../src/directives.ts'
import { staffWorklist, staffOrderFor, staffExecutorFor } from '../src/staff.ts'
import { piStaffExtensionSource } from '../src/executor.ts'
import { staffPersonaText } from '../src/prompts.ts'

function tmpStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'stardeck-staff-'))
}

function seed(dir: string, events: Parameters<typeof appendDirectiveEvent>[1][]): ReturnType<typeof loadDirectives> {
  for (const e of events) appendDirectiveEvent(dir, e)
  return loadDirectives(dir)
}

const base = (id: string, text = '给日常工具箱加一个格言小工具') => ({
  type: 'directive_created' as const, ts: '2026-09-01T00:00:00.000Z', directiveId: id, text,
})

test('staffWorklist：draft 无定时 → 接令单', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [base('cmd-a')])
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.kind, 'intake')
    assert.equal(items[0]!.commandId, 'cmd-a')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：未到点定时令不出单，到点（dispatched）出接令单', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      { type: 'directive_created', ts: '2026-09-01T00:00:00.000Z', directiveId: 'cmd-sched', text: '每天九点巡仓', cron: '0 9 * * *' },
      base('cmd-live'),
    ])
    assert.equal(staffWorklist(loadDirectives(dir)).length, 1) // 只有 cmd-live
    appendDirectiveEvent(dir, { type: 'directive_dispatched', ts: '2026-09-01T09:00:00.000Z', directiveId: 'cmd-sched' })
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 2)
    assert.ok(items.some(i => i.commandId === 'cmd-sched' && i.kind === 'intake'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：received/talking 未分诊（接令中断）→ 重试接令单', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-b'),
      { type: 'directive_received', ts: 't1', directiveId: 'cmd-b', staffSessionId: 'staff-x' },
    ])
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.kind, 'intake')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：L0 已分诊未发布 → 发布单', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-l0'),
      { type: 'directive_triaged', ts: 't1', directiveId: 'cmd-l0', grade: 'L0', reason: '简单' },
    ])
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.kind, 'publish')
    assert.equal(items[0]!.grade, 'L0')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：L1 计划态路由——无稿/被驳=呈改，pending=不出单（等舰长），已批=发布', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-none'), base('cmd-rej'), base('cmd-pend'), base('cmd-ok'),
      { type: 'directive_triaged', ts: 't1', directiveId: 'cmd-none', grade: 'L1', reason: '复杂' },
      { type: 'directive_triaged', ts: 't1', directiveId: 'cmd-rej', grade: 'L1', reason: '复杂' },
      { type: 'directive_plan_opened', ts: 't2', directiveId: 'cmd-rej', plan: '初稿计划' },
      { type: 'directive_plan_rejected', ts: 't3', directiveId: 'cmd-rej', reason: '步子太大' },
      { type: 'directive_triaged', ts: 't1', directiveId: 'cmd-pend', grade: 'L2', reason: '不明确' },
      { type: 'directive_plan_opened', ts: 't2', directiveId: 'cmd-pend', plan: '待批计划' },
      { type: 'directive_triaged', ts: 't1', directiveId: 'cmd-ok', grade: 'L1', reason: '复杂' },
      { type: 'directive_plan_opened', ts: 't2', directiveId: 'cmd-ok', plan: '已批计划全文' },
      { type: 'directive_plan_approved', ts: 't3', directiveId: 'cmd-ok' },
    ])
    const items = staffWorklist(loadDirectives(dir))
    const byId = new Map(items.map(i => [i.commandId, i]))
    assert.equal(byId.get('cmd-none')!.kind, 'plan')
    assert.equal(byId.get('cmd-rej')!.kind, 'plan')
    assert.equal(byId.get('cmd-rej')!.planStatus, 'rejected')
    assert.equal(byId.get('cmd-rej')!.planText, '初稿计划')
    assert.equal(byId.get('cmd-pend'), undefined) // 等舰长定夺——不出单
    assert.equal(byId.get('cmd-ok')!.kind, 'publish')
    assert.equal(byId.get('cmd-ok')!.planText, '已批计划全文')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：终态（approved/cancelled）永不出单', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-done'), base('cmd-drop'),
      { type: 'directive_approved', ts: 't1', directiveId: 'cmd-done', taskId: '20260901-x' },
      { type: 'directive_cancelled', ts: 't1', directiveId: 'cmd-drop', reason: '放弃' },
    ])
    assert.equal(staffWorklist(loadDirectives(dir)).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffOrderFor：大副边界红线——人设正典 + MCP 接入面 + 不教外勤出口', () => {
  const text = staffOrderFor([{ commandId: 'cmd-a', kind: 'intake', text: '做个小工具' }])
  assert.ok(text.startsWith(staffPersonaText(0)))
  assert.ok(text.includes('【stardeck MCP 接入面】'))
  assert.ok(text.includes('war_triage'))
  assert.ok(text.includes('war_plan'))
  assert.ok(text.includes('war_publish'))
  assert.ok(text.includes('没有 war_claim/war_submit')) // 大副不得替外勤交证
  assert.ok(text.includes('【办结纪律】'))
  assert.ok(!text.includes('war_submit({task_id')) // 出口协议教学只属执行者征召令
})

test('staffExecutorFor：大副随舰队——zcode/pi/claude 直跑，gemini/codex/未知诚实回退 opencode', () => {
  assert.equal(staffExecutorFor('zcode'), 'zcode')
  assert.equal(staffExecutorFor('pi'), 'pi')
  assert.equal(staffExecutorFor('claude'), 'claude')
  assert.equal(staffExecutorFor('opencode'), 'opencode')
  assert.equal(staffExecutorFor('codex'), 'opencode') // Windows 实弹受阻（README 在档）——回退不静默
  assert.equal(staffExecutorFor('gemini'), 'opencode') // 本机无 GEMINI_API_KEY——回退不静默
  assert.equal(staffExecutorFor(''), 'opencode')
})

test('staffOrderFor pi 面：扩展接入面措辞 + 边界红线不松', () => {
  const text = staffOrderFor([{ commandId: 'cmd-a', kind: 'intake', text: '做个小工具' }], {}, 'pi-extension')
  assert.ok(text.startsWith(staffPersonaText(0)))
  assert.ok(text.includes('【stardeck 工具接入面】'))
  assert.ok(text.includes('经 HTTP 回连舰桥，与 MCP 同名同义'))
  assert.ok(text.includes('没有 war_claim/war_submit'))
  assert.ok(!text.includes('【stardeck MCP 接入面】')) // pi 无 MCP——接入面不撒谎
  assert.ok(!text.includes('war_submit({task_id'))
})

test('piStaffExtensionSource：只注册大副侧动词——出口协议三件点名缺席（红线）', () => {
  const src = piStaffExtensionSource({ http: 'http://127.0.0.1:3970', agentId: 'staff-x' })
  for (const tool of ['war_board', 'war_triage', 'war_plan', 'war_publish', 'war_abandon_command']) {
    assert.ok(src.includes(`name: "${tool}"`), `${tool} 应注册`)
  }
  for (const banned of ['war_claim', 'war_submit', 'war_fail']) {
    assert.ok(!src.includes(`"${banned}"`), `${banned} 禁出现在大副扩展（出口协议只属执行者）`)
  }
  assert.ok(src.includes('http://127.0.0.1:3970'))
  assert.ok(src.includes('staff-x'))
})

// ---------- 征召令快照门（措辞=高风险变更，改动须显式更新 fixtures） ----------

const FIXTURE_DIR = join(import.meta.dirname, 'staff-snapshots')
const UPDATE = process.env.WARROOM_UPDATE_SNAPSHOTS === '1'

const mixedItems = [
  { commandId: 'cmd-20260901-0001', kind: 'intake' as const, text: '给日常工具箱加一个每日格言小工具' },
  { commandId: 'cmd-20260901-0002', kind: 'plan' as const, text: '重构配置加载并支持多环境', grade: 'L1' as const, planStatus: 'rejected' as const, planText: '第一稿：全量重写配置层。' },
  { commandId: 'cmd-20260901-0003', kind: 'publish' as const, text: '给看板加导出按钮', grade: 'L1' as const, planStatus: 'approved' as const, planText: '目标：看板可导出 PNG。步骤：①加按钮 ②接截图 ③验收。' },
  { commandId: 'cmd-20260901-0004', kind: 'publish' as const, text: '修 README 里的错别字', grade: 'L0' as const },
]

const cases: ReadonlyArray<readonly [name: string, text: string]> = [
  ['staff-order-mixed.txt', staffOrderFor(mixedItems, { 'staff-triage': true, 'staff-plan': true, 'staff-decompose': true })],
  ['staff-order-plain.txt', staffOrderFor([mixedItems[0]!])],
  ['staff-order-pi.txt', staffOrderFor(mixedItems, { 'staff-triage': true, 'staff-plan': true }, 'pi-extension')],
  ['pi-staff-extension.ts', piStaffExtensionSource({ http: 'http://127.0.0.1:3970', agentId: 'staff-20260902' })],
]

for (const [name, text] of cases) {
  test(`征召令快照：${name}`, () => {
    const file = join(FIXTURE_DIR, name)
    if (UPDATE) {
      mkdirSync(FIXTURE_DIR, { recursive: true })
      writeFileSync(file, text, 'utf8')
      return
    }
    let expected = ''
    try {
      expected = readFileSync(file, 'utf8')
    } catch {
      assert.fail(`缺快照 fixture：${name}——先跑 WARROOM_UPDATE_SNAPSHOTS=1 node --import tsx --test tests/staff.test.ts 生成`)
    }
    assert.equal(text, expected)
  })
}
