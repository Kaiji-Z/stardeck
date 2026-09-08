/**
 * D24 两档制 · L1 签任务书（2026-09-08）：签发流四层断言——
 * fold（签发文本入账+原稿保留+老账本兼容）/ 工单（待签不出单、签发发布单携
 * 签发文本、重拟单携原稿与驳回意见）/ 呈批渲染（renderBriefForSign）/
 * 标记改档（??先看方案 → L1）。路由层签发受理在 dashboard-routes；渲染在
 * client-render；实弹 L1 相位在 live-check。
 * @module stardeck/tests/brief-sign
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldDirectives, overrideMarkerOf } from '../src/directives.ts'
import { renderBriefForSign, staffOrderFor, staffWorklist } from '../src/staff.ts'

const now = '2026-09-08T12:00:00.000Z'
const FIVE = { goal: '格言弹窗可用', background: '纯前端', acceptance: '375px 无横向滚动', nonGoals: '不改后端', deliverables: '修复与说明' }

/** L1 待签态命令（seed：任务书已入账 + daemon 代开呈批件）。 */
function awaitingSignDir(id: string): Parameters<typeof staffWorklist>[0][number] {
  return {
    id, text: `命令 ${id}`, createdAt: now, status: 'talking', staffSessionId: `staff-${id}`,
    grade: 'L1', gradeReason: '不可逆删除',
    brief: { ...FIVE, ts: now },
    plan: { text: renderBriefForSign(FIVE), status: 'pending', decidedAt: undefined },
  } as Parameters<typeof staffWorklist>[0][number]
}

test('D24 fold：签发文本入账且 brief 原稿保留不覆盖（谈/签两笔审计链）', () => {
  const dirs = foldDirectives([
    { type: 'directive_created', ts: now, directiveId: 'cmd-s1', text: '清理实验脚本' },
    { type: 'directive_received', ts: now, directiveId: 'cmd-s1', staffSessionId: 'staff-x' },
    { type: 'directive_triaged', ts: now, directiveId: 'cmd-s1', grade: 'L1', reason: '不可逆' },
    { type: 'directive_brief_ready', ts: now, directiveId: 'cmd-s1', goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' },
    { type: 'directive_plan_opened', ts: now, directiveId: 'cmd-s1', plan: renderBriefForSign({ goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' }) },
    { type: 'directive_brief_signed', ts: now, directiveId: 'cmd-s1', goal: '改后目标', background: '原背景', acceptance: '原验收', nonGoals: '舰长改过的非目标', deliverables: '原交付物', note: '非目标按我的来' },
  ])
  const d = dirs.find(x => x.id === 'cmd-s1')!
  assert.equal(d.brief?.goal, '原目标', 'brief 原稿保留不覆盖')
  assert.equal(d.briefSigned?.goal, '改后目标', '签发文本入账')
  assert.equal(d.briefSigned?.nonGoals, '舰长改过的非目标')
  assert.equal(d.briefSigned?.note, '非目标按我的来')
  assert.equal(d.plan?.status, 'pending')
})

test('D24 fold：老账本零迁移——旧 plan 流程（无 brief_signed）fold 照旧', () => {
  const dirs = foldDirectives([
    { type: 'directive_created', ts: now, directiveId: 'cmd-old', text: 'x' },
    { type: 'directive_triaged', ts: now, directiveId: 'cmd-old', grade: 'L1', reason: 'r' },
    { type: 'directive_plan_opened', ts: now, directiveId: 'cmd-old', plan: '旧计划稿' },
    { type: 'directive_plan_approved', ts: now, directiveId: 'cmd-old' },
    { type: 'directive_approved', ts: now, directiveId: 'cmd-old', taskId: 't-1' },
  ])
  const d = dirs.find(x => x.id === 'cmd-old')!
  assert.equal(d.status, 'approved')
  assert.equal(d.briefSigned, undefined, '未签发无 briefSigned')
  assert.equal(d.plan?.status, 'approved')
})

test('D24 工单：待签不出单（plan pending + brief——罚时豁免同源）', () => {
  const items = staffWorklist([awaitingSignDir('cmd-w1') as never])
  assert.deepEqual(items, [], '待签=等舰长，工单空')
})

test('D24 工单：签发后出发布单且携带签发文本（逐字照抄的依据）', () => {
  const d = awaitingSignDir('cmd-w2') as never as Record<string, unknown>
  d.plan = { text: renderBriefForSign(FIVE), status: 'approved', decidedAt: now }
  d.briefSigned = { ...FIVE, ts: now, note: '按我的改' }
  const items = staffWorklist([d as never])
  assert.equal(items.length, 1)
  assert.equal(items[0]!.kind, 'publish')
  assert.deepEqual(items[0]!.briefSigned, FIVE, '发布单携带签发五项')
  const order = staffOrderFor(items)
  assert.ok(order.includes('发布（签发件）'), '签发发布单标题')
  assert.ok(order.includes('舰长改过的非目标') || order.includes(FIVE.nonGoals), '签发文本内嵌征召令')
  assert.ok(order.includes('不要改写'), '逐字照抄纪律')
})

test('D24 工单：驳回后出重拟单（携带驳回意见+原稿五项；不要 war_plan/war_publish）', () => {
  const d = awaitingSignDir('cmd-w3') as never as Record<string, unknown>
  d.plan = { text: renderBriefForSign(FIVE), status: 'rejected', decidedAt: now, reason: '非目标没写全' }
  const items = staffWorklist([d as never])
  assert.equal(items.length, 1)
  assert.equal(items[0]!.kind, 'plan')
  assert.deepEqual(items[0]!.briefDraft, FIVE, '重拟单携带原稿五项')
  assert.equal(items[0]!.planRejectedReason, '非目标没写全')
  const order = staffOrderFor(items)
  assert.ok(order.includes('重拟任务书'), '重拟单标题')
  assert.ok(order.includes('非目标没写全'), '驳回意见内嵌')
  assert.ok(order.includes('不要 war_plan、不要 war_publish'), '重拟纪律')
})

test('D24 renderBriefForSign：五项逐行可读文本（呈批件=任务书本身）', () => {
  const text = renderBriefForSign(FIVE)
  for (const line of ['目标：格言弹窗可用', '背景与约束：纯前端', '验收标准：375px 无横向滚动', '非目标：不改后端', '交付物：修复与说明']) {
    assert.ok(text.includes(line), `呈批件含行：${line}`)
  }
})

test('D24 标记改档：??先看方案 强制 L1（签发档），!!直接做 仍强制 L0', () => {
  assert.equal(overrideMarkerOf('??先看方案 删掉旧脚本')?.grade, 'L1')
  assert.equal(overrideMarkerOf('!!直接做 修个错别字')?.grade, 'L0')
  assert.equal(overrideMarkerOf('普通命令'), undefined)
})
