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
import { staffWorklist, staffOrderFor, staffExecutorFor, inputMaturityOf, clarificationBlocksOf, briefBlocksOf, staffHarvestEventsFromText, CLARIFY_ROUNDS_CAP } from '../src/staff.ts'
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

// ---------- 澄清协议（2026-09-08）：工单判定 + 账本生命周期 ----------

test('staffWorklist：澄清 pending 不出单——工单空即退场罚时条件（length>0）不触发', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-q'),
      { type: 'directive_received', ts: 't1', directiveId: 'cmd-q', staffSessionId: 'staff-x' },
      { type: 'directive_clarification_requested', ts: 't2', directiveId: 'cmd-q', questions: ['验收标准是什么？'] },
    ])
    // staffTick 的罚时分支条件是 staffWorklist(...).length > 0——此处为 0 即罚时豁免。
    assert.equal(staffWorklist(loadDirectives(dir)).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：澄清 answered 未成案 → 答复成案单（问答史/轮次随行）', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-r'),
      { type: 'directive_received', ts: 't1', directiveId: 'cmd-r', staffSessionId: 'staff-x' },
      { type: 'directive_clarification_requested', ts: 't2', directiveId: 'cmd-r', questions: ['格言内容从哪来？', '展示在哪？'] },
      { type: 'directive_clarification_answered', ts: 't3', directiveId: 'cmd-r', text: '内置语料，放弹窗。', channel: 'board' },
    ])
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.kind, 'resolve')
    assert.deepEqual(items[0]!.questions, ['格言内容从哪来？', '展示在哪？'])
    assert.equal(items[0]!.answer, '内置语料，放弹窗。')
    assert.equal(items[0]!.round, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('staffWorklist：澄清 answered 已分诊 → 常规路由接管（成案单消失）', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-t'),
      { type: 'directive_clarification_requested', ts: 't1', directiveId: 'cmd-t', questions: ['验收？'] },
      { type: 'directive_clarification_answered', ts: 't2', directiveId: 'cmd-t', text: '跑通即可。', channel: 'board' },
      { type: 'directive_triaged', ts: 't3', directiveId: 'cmd-t', grade: 'L1', reason: '复杂' },
    ])
    const items = staffWorklist(loadDirectives(dir))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.kind, 'plan') // 成案动作清账——常规计划路由接管
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('fold：澄清协议生命周期——requested 挂起翻 talking / answered 只翻 pending / 二轮累计 / brief 入账', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [base('cmd-life', '给工具箱加格言工具')])
    let d = loadDirectives(dir)[0]!
    assert.equal(d.clarification, undefined)
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: 't1', directiveId: 'cmd-life', questions: ['验收？'] })
    d = loadDirectives(dir)[0]!
    assert.equal(d.status, 'talking') // 挂起即「在大副对话里成形」
    assert.equal(d.clarification!.status, 'pending')
    assert.equal(d.clarification!.round, 1)
    appendDirectiveEvent(dir, { type: 'directive_clarification_answered', ts: 't2', directiveId: 'cmd-life', text: '跑通即可。', channel: 'board' })
    d = loadDirectives(dir)[0]!
    assert.equal(d.clarification!.status, 'answered')
    assert.equal(d.clarification!.answer, '跑通即可。')
    appendDirectiveEvent(dir, { type: 'directive_clarification_requested', ts: 't3', directiveId: 'cmd-life', questions: ['放哪？'] })
    d = loadDirectives(dir)[0]!
    assert.equal(d.clarification!.status, 'pending')
    assert.equal(d.clarification!.round, 2) // 多轮由 fold 累计——重放稳定
    appendDirectiveEvent(dir, { type: 'directive_clarification_answered', ts: 't4', directiveId: 'cmd-life', text: '弹窗。', channel: 'board' })
    appendDirectiveEvent(dir, {
      type: 'directive_brief_ready', ts: 't5', directiveId: 'cmd-life',
      goal: '工具箱可显示每日格言', background: '纯前端改动', acceptance: '格言非空且每日变化',
      nonGoals: '不改其他工具', deliverables: '格言模块 + 渲染',
    })
    d = loadDirectives(dir)[0]!
    assert.equal(d.brief!.goal, '工具箱可显示每日格言')
    assert.equal(d.brief!.nonGoals, '不改其他工具')
    // 成案动作清账：triaged 后澄清态消失（对话化为行动）。
    appendDirectiveEvent(dir, { type: 'directive_triaged', ts: 't6', directiveId: 'cmd-life', grade: 'L0', reason: '明确' })
    d = loadDirectives(dir)[0]!
    assert.equal(d.clarification, undefined)
    assert.equal(d.brief!.goal, '工具箱可显示每日格言') // 任务书保留——一等账面产物
    // 对无挂起命令的澄清答复=重放/撕账——忽略不动。
    appendDirectiveEvent(dir, { type: 'directive_clarification_answered', ts: 't7', directiveId: 'cmd-life', text: '迟到的答复', channel: 'board' })
    d = loadDirectives(dir)[0]!
    assert.equal(d.clarification, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('fold：任务书叠在终态之上——发布（approved）后退场收割的 brief_ready 仍入账（V20.2 实弹回归）', () => {
  const dir = tmpStateDir()
  try {
    seed(dir, [
      base('cmd-post'),
      { type: 'directive_received', ts: 't1', directiveId: 'cmd-post', staffSessionId: 'staff-x' },
      { type: 'directive_approved', ts: 't2', directiveId: 'cmd-post', taskId: '20260908-x' },
    ])
    // 成案轮时序：war_publish（approved）在跑中先落，任务书随退场收割后落——
    // 终态守卫若不吃这条，任务书永远进不了账（live 第二轮抓的正是它）。
    appendDirectiveEvent(dir, {
      type: 'directive_brief_ready', ts: 't3', directiveId: 'cmd-post',
      goal: '窄屏按钮修复', background: '纯前端', acceptance: '375px 无溢出',
      nonGoals: '不动后端', deliverables: '修复与验收说明',
    })
    const d = loadDirectives(dir)[0]!
    assert.equal(d.status, 'approved') // 终态不复活
    assert.equal(d.brief!.goal, '窄屏按钮修复') // 任务书照常入账
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('inputMaturityOf：四判型（vague / 缺验收 / 缺非目标 / 成熟）', () => {
  assert.equal(inputMaturityOf('帮帮我').verdict, 'vague')
  assert.equal(inputMaturityOf('搞一下那个东西').verdict, 'vague')
  assert.equal(inputMaturityOf('给日常工具箱加一个格言小工具').verdict, 'missing-acceptance')
  assert.equal(inputMaturityOf('重构配置加载层，支持多环境').verdict, 'missing-acceptance')
  assert.equal(inputMaturityOf('写一个部署脚本并跑测试通过后交付').verdict, 'missing-nongoals')
  const mature = inputMaturityOf('修复登录页空指针：验收标准为测试全部通过；不要动后端接口')
  assert.equal(mature.verdict, 'mature')
  assert.deepEqual(mature.gaps, [])
})

test('clarificationBlocksOf / briefBlocksOf：块解析与完整性强排', () => {
  const sample = [
    '勘察完毕，有两处缺口需要舰长定夺：',
    '【澄清】（cmd-20260908-aaaa）',
    '1. 格言内容从哪来：内置语料还是接口拉取？',
    '2. - 展示位置：弹窗还是常驻面板？',
    '',
    '另一条命令可以直接成案：',
    '【任务书】（cmd-20260908-bbbb）',
    '目标：工具箱可显示每日格言',
    '背景与约束：纯前端改动，工作区在工具箱仓',
    '验收标准：格言非空且每日变化',
    '非目标：不改其他工具',
    '交付物：格言模块 + 渲染',
  ].join('\n')
  const qs = clarificationBlocksOf(sample)
  assert.equal(qs.length, 1)
  assert.equal(qs[0]!.commandId, 'cmd-20260908-aaaa')
  assert.deepEqual(qs[0]!.questions, ['格言内容从哪来：内置语料还是接口拉取？', '展示位置：弹窗还是常驻面板？'])
  const briefs = briefBlocksOf(sample)
  assert.equal(briefs.length, 1)
  assert.equal(briefs[0]!.commandId, 'cmd-20260908-bbbb')
  assert.equal(briefs[0]!.background, '纯前端改动，工作区在工具箱仓')
  assert.equal(briefs[0]!.deliverables, '格言模块 + 渲染')
  // 五项缺一即弃（半本任务书比没有更危险）——验收标签变体「验收：」可识别。
  const incomplete = [
    '【任务书】（cmd-20260908-cccc）',
    '目标：一句话',
    '验收：可判定',
  ].join('\n')
  assert.equal(briefBlocksOf(incomplete).length, 0)
  const variants = [
    '【任务书】（cmd-20260908-dddd）',
    '目标：一句话',
    '背景：有边界的背景',
    '验收：可判定',
    '非目标：没有',
    '交付：一个文件',
  ].join('\n')
  const parsed = briefBlocksOf(variants)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.acceptance, '可判定')
  assert.equal(parsed[0]!.deliverables, '一个文件')
  // 零问题的澄清块（没按格式来）——弃块不入账。
  assert.equal(clarificationBlocksOf('【澄清】（cmd-20260908-eeee）\n我需要更多信息。').length, 0)
})

test('harvest 机械闸：第 3 轮澄清请求拒收（rejected 报告），未超限轮照收、混合文本成案优先——行为收敛', () => {
  assert.equal(CLARIFY_ROUNDS_CAP, 2)
  const known = new Set(['cmd-x'])
  // 已两轮（round=2）→ 第 3 轮请求撞闸：拒收入账、rejected 如实报告。
  const capped = staffHarvestEventsFromText('【澄清】（cmd-x）\n1. 还想再问一句——组件库用哪个？', known, () => 2)
  assert.equal(capped.events.length, 0, '过限澄清不入账')
  assert.equal(capped.rejectedClarifications.length, 1)
  assert.equal(capped.rejectedClarifications[0]!.round, 3)
  assert.deepEqual(capped.rejectedClarifications[0]!.questions, ['还想再问一句——组件库用哪个？'])
  // 未超限（round=0）→ 照常入账。
  const fresh = staffHarvestEventsFromText('【澄清】（cmd-x）\n1. 验收标准是什么？', known, () => 0)
  assert.equal(fresh.events.length, 1)
  assert.equal(fresh.events[0]!.type, 'directive_clarification_requested')
  assert.equal(fresh.rejectedClarifications.length, 0)
  // 恰在闸上（round=1 → 第 2 轮）→ 放行（2 轮封顶，第 2 轮是合法末轮）。
  const edge = staffHarvestEventsFromText('【澄清】（cmd-x）\n1. 放哪？', known, () => 1)
  assert.equal(edge.events.length, 1)
  assert.equal(edge.rejectedClarifications.length, 0)
  // 混合文本（任务书+澄清同卡）：成案优先——任务书入账，澄清静默弃（都成案了
  // 就不该再问，无需告警）。
  const mixed = staffHarvestEventsFromText(
    ['【任务书】（cmd-x）', '目标：g', '背景与约束：b', '验收标准：a', '非目标：n', '交付物：d', '【澄清】（cmd-x）', '1. 还想问'].join('\n'),
    known, () => 2,
  )
  assert.equal(mixed.events.length, 1)
  assert.equal(mixed.events[0]!.type, 'directive_brief_ready')
  assert.equal(mixed.rejectedClarifications.length, 0)
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

test('staffExecutorFor：大副随舰队——双席正典（V19.13）：pi/zcode/claude/codex/dsh 直跑，双席不全的回退 opencode', () => {
  assert.equal(staffExecutorFor('zcode'), 'zcode')
  assert.equal(staffExecutorFor('pi'), 'pi')
  assert.equal(staffExecutorFor('claude'), 'claude')
  assert.equal(staffExecutorFor('codex'), 'codex') // V19.13 垫片 + http 面——双席接通
  assert.equal(staffExecutorFor('dsh'), 'dsh') // http 面大副通道（dispatch 在档）
  assert.equal(staffExecutorFor('opencode'), 'opencode')
  assert.equal(staffExecutorFor('gemini'), 'opencode') // 双席不全（外勤未实弹+无大副通道）——舰队门已不可选，此处兜底
  assert.equal(staffExecutorFor('qwen'), 'opencode') // 同上
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
  ['staff-order-resolve.txt', staffOrderFor([
    {
      commandId: 'cmd-20260908-1234-abcd', kind: 'resolve' as const,
      text: '给日常工具箱加一个每日格言小工具',
      questions: ['格言内容从哪来：内置语料还是接口拉取？', '展示位置：工具箱弹窗还是常驻面板？'],
      answer: '内置语料即可，放工具箱弹窗。',
      round: 1,
    },
  ], { 'staff-triage': true, 'staff-plan': true })],
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
