/**
 * P1-4 渲染层 harness（2026-09-02 脱离宿主九件之一）：happy-dom + React
 * createRoot，**空 services（独立形态）**下渲染关键组件——
 * 接线轮的病灶类型（services.sessions 缺席→按钮静默无操作）从此有疫苗：
 * 关键钮必须在场、点击必须有可观察后果（fetch 打到哪/onDetail 是否被调）。
 * fetch 全程 stub（路由表），不依赖真 daemon。
 * @module stardeck/tests/client-render
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'

// ── DOM 全域就位（须先于 views 导入——activeCopy/localStorage 等渲染期取用） ──
const win = new Window()
Object.assign(globalThis, {
  window: win,
  document: win.document,
  localStorage: win.localStorage,
  HTMLElement: win.HTMLElement,
  MutationObserver: win.MutationObserver,
  KeyboardEvent: win.KeyboardEvent,
  MouseEvent: win.MouseEvent,
  CustomEvent: win.CustomEvent,
  getComputedStyle: win.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback): number => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (h: number): void => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  IntersectionObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): Array<never> { return [] } },
})
// navigator 在 Node 24 是 getter-only——defineProperty 兜底（client 面不直接用，防御性补齐）。
try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }) } catch { /* 已有可用值 */ }
if (typeof globalThis.EventSource === 'undefined') {
  // data.ts 对 EventSource 缺席有守卫（safety poll 兜底）——不注入即走 poll 面。
}

// ── fetch 路由 stub（记录调用供断言） ──
const calls: Array<{ url: string; body?: unknown }> = []
let boardFixture: Record<string, unknown> = {
  ok: true, active: true, warRoot: '/tmp/w', hqSessionId: null, revision: 'r-test',
  commands: [], tasks: [], threads: [], roster: [], rosterErrors: [],
}
// V19 腿3 测试面：attach/history 桩（默认失败面=既有测试行为；置 fixture 换成功面）。
let historyFixture: Record<string, unknown> = { ok: false, error: '测试桩：无此会话' }
const jsonResponse = (data: unknown, ok = true): Response =>
  ({ ok, status: 200, json: async () => data }) as unknown as Response
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  let body: unknown
  if (init?.body !== undefined) { try { body = JSON.parse(String(init.body)) } catch { body = String(init.body) } }
  calls.push({ url, body })
  if (url.includes('/warroom/api/board')) return jsonResponse(boardFixture)
  if (url.includes('/warroom/api/attach/history')) return jsonResponse(historyFixture)
  if (url.includes('/warroom/api/workspace/file')) return jsonResponse({ ok: true, name: 'report-x.md', binary: false, content: '# 产物标题\n\n- 结论一：A\n- 结论二：B\n' })
  if (url.includes('/warroom/api/workspace/reveal')) return jsonResponse({ ok: true })
  if (url.includes('/warroom/api/attach/entries')) return jsonResponse({ ok: true, entries: {} })
  if (url.includes('/warroom/api/tools/call')) return jsonResponse({ ok: true, output: {} })
  if (url.includes('/warroom/api/commands/talking')) return jsonResponse({ ok: true })
  return jsonResponse({ ok: true })
}) as typeof fetch

// views 在 DOM 全域就位后导入。
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const views = await import('../src/client/views.tsx')

const services = { standaloneChrome: true } as never as Parameters<typeof views.warView>[0]

interface Rendered { root: { unmount(): void }; text: () => string; click: (label: RegExp) => HTMLButtonElement | null; unmount: () => void }

async function render(el: unknown): Promise<Rendered> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(el as never)
  await new Promise(r => setTimeout(r, 50))
  return {
    root,
    text: () => (host.textContent ?? '').replace(/\s+/g, ' '),
    click: (label: RegExp): HTMLButtonElement | null => {
      const btn = [...host.querySelectorAll('button')].find(b => label.test((b.textContent ?? '').trim()))
      if (btn !== undefined) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return btn ?? null
    },
    unmount: () => { root.unmount(); host.remove() },
  }
}


/** 板投影形状齐备的 fixture 助手（client 代码假设字段完整——缺 schedule/chain 会炸）。 */
function mkCmd(over: Record<string, unknown>): Parameters<typeof views.FocusPage>[0]['cmd'] {
  return {
    commandId: 'cmd-f1', text: 'fixture 命令', name: null,
    createdAt: new Date().toISOString(), status: 'talking', staffSessionId: null, taskId: null,
    cancelledReason: null, grade: null, gradeReason: null, gradeConfidence: null, regrades: 0,
    plan: null, schedule: null, continuation: null, archived: null,
    chain: { generation: 1, rootId: 'cmd-f1', length: 1, hueSlot: 0 },
    ...over,
  } as Parameters<typeof views.FocusPage>[0]['cmd']
}
type TestTask = Parameters<typeof views.FocusPage>[0]['chain'][number]
function mkTask(over: Record<string, unknown>): TestTask {
  return {
    taskId: '20260902-f-task', title: 'fixture 任务', status: 'closed', priority: 'normal',
    quality: 'standard', rounds: 0, attempts: 1, deps: [], lastError: null,
    workspacePath: null, workspaceKind: null, claimedBy: null, startedAt: new Date().toISOString(),
    brief: '做', acceptance: '过', schedule: null, attemptLog: [], troops: [], deliverables: [],
    reports: [], comments: [], closedVerdict: null,
    ...over,
  } as TestTask
}

/** 计判定夺调用收集器（plan-reject UI 断言用）。 */
const decideCalls: Array<{ decision: string; note?: string }> = []
const decideCallsReset = (): void => { decideCalls.length = 0 }

/** talking 命令卡 fixture（独立形态 + 有大副会话号）。 */
const talkingCmd = mkCmd({ commandId: 'cmd-t1', text: '??先看方案：给工作区做个体检', status: 'talking', staffSessionId: 'staff-xyz' })

test('空板 smoke：warView 独立形态渲染不炸，起草入口在场', async () => {
  boardFixture = { ok: true, active: true, warRoot: '/tmp/w', hqSessionId: null, revision: 'r0', commands: [], tasks: [], threads: [], roster: [], rosterErrors: [] }
  const r = await render(createElement(views.warView(services)))
  await new Promise(resolve => setTimeout(resolve, 300)) // store 首 tick 回流
  assert.ok(r.text().length > 0, '空板有内容渲染')
  assert.ok(r.text().includes('＋') || r.text().includes('＋'), '起草入口在场')
  r.unmount()
})

test('CommandCard talking + 独立形态：进入对话钮在场，点击走 onDetail（不落静默无操作）', async () => {
  const detailCalls: string[] = []
  const el = views.CommandCard(
    talkingCmd,
    null,
    services,
    c => { detailCalls.push(c.commandId) },
    [],
    { familyId: null, active: null, onHover: () => {}, onFocus: () => {} },
    () => {},
  )
  const r = await render(el as never)
  const btn = r.click(/进入对话/)
  assert.ok(btn !== null, '进入对话钮在场（独立形态不许因 services.sessions 缺席消失）')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(detailCalls, ['cmd-t1'], '点击进聚焦页（onDetail 被调）')
  r.unmount()
})

/** 展开 ghost 卡（澄清面板/任务书卡的容器），等一个渲染 tick。 */
async function expandGhost(): Promise<void> {
  const ghostCard = document.querySelector('.war-cd-stage[data-stage="task"] .war-tour-ghost') as HTMLElement | null
  ghostCard?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
}

test('D23 第四刀 会议室区 pending：问答免展开常驻同屏（问题+选项药丸+答复框）', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-q1', status: 'talking', staffSessionId: 'staff-x',
    clarification: { questions: ['「工具箱」指哪个项目？', '验收标准是什么？'], round: 1, status: 'pending', answer: null },
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    const text = r.text()
    assert.ok(document.querySelector('.war-cd-stage[data-stage="meeting"]') !== null, '会议室段结构在场（独立 stage）')
    assert.ok(text.includes('会议室') || text.includes('Meeting room'), '会议室场地名在场')
    assert.ok(text.includes('第 1 轮提问') || text.includes('round 1'), '轮数标题在场（等舰长一眼可辨）')
    assert.ok(text.includes('「工具箱」指哪个项目？'), '问题一渲染')
    assert.ok(text.includes('验收标准是什么？'), '问题二渲染')
    assert.ok(document.querySelector('.war-cd-stage[data-stage="meeting"] .war-clarify-q li') !== null, '问题列表结构化（ol>li）')
    assert.ok(document.querySelector('.war-cd-answer') !== null, '答复框贴在同卡（点选即答不离开会场）')
    // 场所铭：目标指向明确的场所正典上墙。
    assert.ok(text.includes('把模糊命令收敛成强目标') || text.includes('a vague order becomes a strong goal'), '场所铭在场')
  } finally { r.unmount() }
})

test('D23 第四刀 会议室区 answered：过程态+问答史常驻（成案中可见，不靠展开）', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-q2', status: 'talking', staffSessionId: 'staff-x',
    clarification: { questions: ['验收标准是什么？'], round: 1, status: 'answered', answer: '跑通即可' },
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    const text = r.text()
    assert.ok(document.querySelector('.war-cd-stage[data-stage="meeting"]') !== null, '会议室段在场')
    assert.ok(text.includes('成案中') || text.includes('Finalising'), '③过程态在场（大副正带答复重开）')
    assert.ok(text.includes('跑通即可'), '舰长答复渲染（问答史留场）')
    assert.ok(text.includes('答复已入账') || text.includes('Reply logged'), '定案提示在场')
    // 过程态给辅助技术（读屏）播报。
    assert.ok(document.querySelector('.war-meeting-finalizing[role="status"]') !== null, '过程态 role=status')
  } finally { r.unmount() }
})

test('D23 第四刀 会议室时间轴：多轮问答史全轮可见（第 1 轮已答复+第 2 轮挂起）', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-q3', status: 'talking', staffSessionId: 'staff-x',
    clarification: { questions: ['部署到哪台机器？'], round: 2, status: 'pending', answer: null },
    clarificationRounds: [
      { round: 1, questions: ['验收标准是什么？'], answer: '跑通即可', requestedAt: new Date().toISOString() },
      { round: 2, questions: ['部署到哪台机器？'], options: [['本机', '你的帮我定']], requestedAt: new Date().toISOString() },
    ],
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    const text = r.text()
    const rounds = document.querySelectorAll('.war-cd-stage[data-stage="meeting"] .war-meeting-round')
    assert.ok(rounds.length === 2, `两轮问答同屏（got ${rounds.length}）`)
    assert.ok(text.includes('跑通即可'), '第 1 轮答复史在场')
    assert.ok(text.includes('部署到哪台机器？'), '第 2 轮问题在场')
    // 只有挂起轮给选项药丸；历史轮答复已定不再给钮。
    assert.ok(document.querySelectorAll('.war-clarify-opt').length > 0, '挂起轮选项药丸在场')
  } finally { r.unmount() }
})

test('D23 任务书五项卡：成案后五项结构化可见；无 brief 命令不渲染空卡', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-b1', status: 'talking', staffSessionId: 'staff-x',
    clarification: { questions: ['验收？'], round: 1, status: 'answered', answer: '跑通即可' },
    brief: { goal: '修复窄屏溢出', background: '纯前端', acceptance: '375px 无横向滚动', nonGoals: '不改后端', deliverables: '修复与验收说明' },
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    await expandGhost()
    const text = r.text()
    assert.ok(text.includes('任务书（五项定案）') || text.includes('Task brief'), '任务书卡标题在场')
    for (const item of ['修复窄屏溢出', '375px 无横向滚动', '不改后端', '修复与验收说明']) {
      assert.ok(text.includes(item), `五项内容可见：${item}`)
    }
    assert.ok(document.querySelector('.war-brief-card') !== null, '任务书卡结构在场')
  } finally {
    r.unmount() // 先卸载再渲染对照——同页残留 host 会污染后续 querySelector。
  }
  // 无 brief：同一渲染路径不吐空卡。
  const plain = mkCmd({ commandId: 'cmd-b2', status: 'talking', staffSessionId: 'staff-x' })
  const el2 = createElement(views.FocusPage, {
    cmd: plain, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [plain],
  })
  const r2 = await render(el2)
  try {
    await expandGhost()
    assert.ok(document.querySelector('.war-brief-card') === null, '无 brief 无空卡')
  } finally {
    r2.unmount()
  }
})

test('FocusPage reported 链 + 独立形态：任务会话/执行会话/通过收官三钮在场，收官点击打到 war_close_task', async () => {
  const task = mkTask({
    taskId: '20260902-rep1', title: '格言 CLI', status: 'reported',
    attemptLog: [{ id: 'oc-1', sessionId: 'pg-field-1', startedAt: new Date().toISOString(), outcome: 'reported' }],
    reports: [{ ts: new Date().toISOString(), text: '完成：双子命令。', evidence: null, deliverables: null }],
  })
  const cmd = mkCmd({ commandId: 'cmd-r1', text: '做格言 CLI', status: 'approved', taskId: '20260902-rep1' })
  const el = createElement(views.FocusPage, {
    cmd, chain: [task], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  assert.ok(r.text().includes('任务会话') || r.text().includes('Task session'), '任务会话钮在场')
  assert.ok(r.text().includes('执行会话') || r.text().includes('Mission session'), '执行会话钮在场')
  assert.ok(r.text().includes('格言 CLI'), '任务链渲染')
  // 展开战报（SessionCard 点击）→ 通过收官钮显形 → 点击打到 war_close_task。
  const card = [...document.querySelectorAll('.war-cd-stage[data-stage="report"] .war-card-top')].pop() as HTMLElement | undefined
  card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  calls.length = 0
  const accept = r.click(/通过收官|Accept & close/)
  assert.ok(accept !== null, '通过收官钮在场（reported 链 + 独立形态）')
  await new Promise(resolve => setTimeout(resolve, 80))
  const closeCall = calls.find(c => c.url.includes('/tools/call') && (c.body as { name?: string })?.name === 'war_close_task')
  assert.ok(closeCall !== undefined, '收官点击 → war_close_task（captain-board 通道）')
  r.unmount()
})

test('FocusPage talking：撤令钮在场，两步确认后 onAbandon 被调（warView 层接 abandonCommand）', async () => {
  const abandons: string[] = []
  const el = createElement(views.FocusPage, {
    cmd: talkingCmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [talkingCmd],
    onAbandon: () => { abandons.push(talkingCmd.commandId) },
  })
  const r = await render(el)
  const w = r.click(/撤令/)
  assert.ok(w !== null, '撤令钮在场（talking 命令）')
  await new Promise(resolve => setTimeout(resolve, 50))
  calls.length = 0
  // P0-1 答复 composer（独立形态）：先展开任务段 ghost 卡，输入面 + 送达钮才显形。
  const ghostCard = document.querySelector('.war-cd-stage[data-stage="task"] .war-tour-ghost') as HTMLElement | null
  ghostCard?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  const area = document.querySelector('textarea')
  assert.ok(area !== null, '答复输入面在场（talking ghost）')
  assert.ok(r.text().includes('答复大副') || r.text().includes('Answer the Staff Officer'), '答复标签在场')
  calls.length = 0
  // 直接设值+派发（happy-dom 的 React onChange 模拟经原生 setter）
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(area, '用最轻方案直接做')
  area.dispatchEvent(new win.Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  const send = r.click(/送达答复|Deliver answer/)
  assert.ok(send !== null, '送达答复钮在场')
  await new Promise(resolve => setTimeout(resolve, 80))
  const answerCall = calls.find(c => c.url.includes('/commands/answer'))
  assert.ok(answerCall !== undefined, '送达 → /commands/answer：' + JSON.stringify(answerCall?.body))
  assert.equal((answerCall?.body as { text?: string })?.text, '用最轻方案直接做')
  const ok = r.click(/确认撤令/)
  assert.ok(ok !== null, '二次确认钮显形')
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.deepEqual(abandons, ['cmd-t1'], '确认撤令 → onAbandon（warView 层接 war_abandon_command）')
  r.unmount()
})

test('FocusPage 任务会话（独立形态）：点击开会话历史弹窗（不依赖宿主会话面）', async () => {
  const task = mkTask({
    taskId: '20260902-h1', title: 'x', status: 'closed',
    attemptLog: [{ id: 'oc-1', sessionId: 'sess_a', startedAt: new Date().toISOString(), outcome: 'succeeded' }],
  })
  const cmd = mkCmd({ commandId: 'cmd-h1', text: '做 x', status: 'approved', staffSessionId: 'staff-h1', taskId: '20260902-h1' })
  const el = createElement(views.FocusPage, {
    cmd, chain: [task as never], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  const btn = r.click(/任务会话|Task session/)
  assert.ok(btn !== null, '任务会话钮在场')
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.ok(r.text().includes('会话历史') || r.text().includes('session history'), '历史弹窗已开：' + r.text().slice(0, 80))
  const histCall = calls.find(c => c.url.includes('/attach/history'))
  assert.ok(histCall !== undefined, '数据源=attach/history（零 token 读档）')
  r.unmount()
})

test('ExternalThreadCard 独立形态：点击不静默——onStandaloneMiss 出声', async () => {
  const misses: number[] = []
  const thread = { sessionId: 'sess-ext-1', note: null, attachedAt: new Date().toISOString(), workspacePath: '/tmp/w' } as never as Parameters<typeof views.ExternalThreadCard>[0]
  const el = views.ExternalThreadCard(
    thread,
    services,
    () => {},
    { familyId: null, active: null, onHover: () => {}, onFocus: () => {} },
    () => { misses.push(1) },
  )
  const r = await render(el as never)
  const card = document.querySelector('.war-external-card') as HTMLElement | null
  assert.ok(card !== null, '外部卡渲染')
  card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(misses.length, 1, '独立形态点击 → onStandaloneMiss（降级提示，非静默）')
  r.unmount()
})

test('计划待批：定夺批注输入在场，驳回带意见打到 /commands/plan {note}', async () => {
  decideCallsReset()
  const cmd = mkCmd({
    commandId: 'cmd-plan1', text: '??先看方案：做个体检', status: 'received', staffSessionId: 'staff-p',
    grade: 'L2', plan: { text: '五步计划：先盘结构……', status: 'pending', decidedAt: null },
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {},
    onDecidePlan: (decision, note) => { decideCalls.push({ decision, note }) },
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  // 意见框随置顶决策带常驻（不依赖展开计划段）
  const area = document.querySelector('.war-cd-band textarea') as HTMLTextAreaElement | null
  assert.ok(area !== null, '定夺批注输入在场（决策带常驻）')
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(area, '砍到三步以内')
  area.dispatchEvent(new win.Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  const rej = r.click(/驳回/)
  assert.ok(rej !== null, '驳回钮在场')
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.deepEqual(decideCalls, [{ decision: 'reject', note: '砍到三步以内' }], '驳回带意见上抛（warView 层接 decidePlan(id,decision,note)）')
  r.unmount()
})

test('舰队门：模型输入随席位卡内展开 + 底部钮在滚动容器外', async () => {
  const { fleetGate } = await import('../src/client/fleet-gate.tsx')
  const enters: Array<{ executor: string; model: string }> = []
  const seats = ['opencode', 'pi', 'codex', 'zcode', 'claude', 'gemini', 'qwen', 'copilot', 'amp', 'cursor', 'droid'].map(id => ({
    id, label: id, ok: true, bin: `bin-${id}`,
    note: '测试席位说明文案。', noteEn: 'Test seat note.',
    ...(id === 'codex' || id === 'gemini' || id === 'qwen' ? { experimental: true } : {}),
    adapter: !['copilot', 'amp', 'cursor', 'droid'].includes(id),
  }))
  const el = createElement(fleetGate, {
    fleet: { active: { executor: 'opencode', model: '' }, seats: seats as never },
    onEnter: (executor: string, model: string) => { enters.push({ executor, model }) },
    dismissible: false,
  })
  const r = await render(el)
  // 滚动容器与底部钮分离
  const scroll = document.querySelector('.war-gate-scroll')
  const actions = document.querySelector('.war-gate-actions')
  assert.ok(scroll !== null, '席列滚动容器在场')
  assert.ok(actions !== null && !scroll.contains(actions), '底部操作钮在滚动容器外（不随席列滚动）')
  // critique 复检 P1：缺席席折叠——默认只渲染 ready/limited 席 + 折叠行钮
  // （fixture：7 席可显示；4 未检出收进折叠行，不再占第一屏）。
  const foldBtn = [...scroll.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('+4'))
  assert.ok(foldBtn !== undefined, '缺席席折叠行在场（+4 即将支持）')
  assert.ok(foldBtn!.getAttribute('aria-expanded') === 'false', '折叠行默认收起')
  assert.equal(scroll.querySelectorAll('[role="button"]').length, 7, '默认只渲染可绑定/受限席（缺席席折叠）')
  foldBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(scroll.querySelectorAll('[role="button"]').length, 11, '展开后 11 席全在场')
  assert.ok(foldBtn!.getAttribute('aria-expanded') === 'true', '展开态 aria-expanded')
  // 选中 pi 席 → 模型输入在【pi 卡内】展开
  const piCard = [...scroll.querySelectorAll('[role="button"]')].find(c => (c.textContent ?? '').includes('pi')) as HTMLElement
  piCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  const piInput = piCard.querySelector('input')
  assert.ok(piInput !== null, '模型输入在所选席位卡内展开')
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set
  setter?.call(piInput, 'zai/glm-5.2')
  piInput.dispatchEvent(new win.Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  // zcode 席：锁死说明、无输入
  const zcCard = [...scroll.querySelectorAll('[role="button"]')].find(c => (c.textContent ?? '').includes('zcode')) as HTMLElement
  zcCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.ok(zcCard.querySelector('input') === null, 'zcode 卡内无模型输入（锁死）')
  assert.ok((zcCard.textContent ?? '').includes('model.main') || (zcCard.textContent ?? '').includes('桌面版'), '锁死说明在卡内')
  // 切回 pi（选中态保持 model 值）→ 开始调度 → onEnter(pi, 模型串)
  piCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  const go = r.click(/开始调度|Start dispatching/)
  assert.ok(go !== null, '开始调度钮在场（容器外）')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(enters, [{ executor: 'pi', model: 'zai/glm-5.2' }], 'onEnter 收到所选席+卡内输入的模型串')
  r.unmount()
})

test('V19 腿2 reported：战报 md 渲染 + files chip 可点 → 板内预览弹窗（workspace/file + md 渲染）', async () => {
  const task = mkTask({
    taskId: '20260904-pv1', title: '盘点 x', status: 'reported',
    workspacePath: '/tmp/w/tasks/pv1',
    attemptLog: [{ id: 'oc-1', sessionId: 'pg-pv-1', startedAt: new Date().toISOString(), outcome: 'reported' }],
    reports: [{ ts: new Date().toISOString(), text: '## 结论\n\n盘点完成：3 个顶层目录。\n\n- 产物已落盘 `report-x.md`\n', evidence: null, deliverables: null }],
    deliverables: [{ kind: 'files', summary: '1 个文件改动', detail: 'report-x.md', ts: new Date().toISOString() }],
  })
  const cmd = mkCmd({ commandId: 'cmd-pv1', text: '盘点 x', status: 'approved', taskId: '20260904-pv1' })
  const el = createElement(views.FocusPage, {
    cmd, chain: [task], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  // 展开战报卡（任务回报段末卡点击）
  const card = [...document.querySelectorAll('.war-cd-stage[data-stage="report"] .war-card-top')].pop() as HTMLElement | undefined
  card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  // md-lite 渲染：标题成块、正文在
  assert.ok(document.querySelector('.war-md .war-md-h') !== null, '战报标题块渲染（md-lite）')
  assert.ok(r.text().includes('盘点完成'), '战报结论段在')
  // files chip=可点 button（data 面）
  const chip = document.querySelector('button.war-loot-file') as HTMLButtonElement | null
  assert.ok(chip !== null, 'files 交付物 chip 是可点按钮')
  assert.equal(chip?.textContent, 'report-x.md')
  calls.length = 0
  chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 120))
  const fileCall = calls.find(c => c.url.includes('/warroom/api/workspace/file'))
  assert.ok(fileCall !== undefined, '点击打到 workspace/file 只读端点')
  assert.ok(String(fileCall?.url).includes(encodeURIComponent('/tmp/w/tasks/pv1')), '携带任务工作区参数')
  const modal = document.querySelector('[data-war-preview]')
  assert.ok(modal !== null, '板内预览弹窗在场')
  assert.ok(r.text().includes('产物预览') || r.text().includes('Artifact preview'), '预览标题在场')
  assert.ok(modal?.textContent?.includes('产物标题') === true, '产物正文已渲染（md 标题）')
  r.unmount()
})

test('V19 腿3 会话历史：末条 assistant 正文钉「最终汇报」，过程流折叠在下', async () => {
  historyFixture = {
    ok: true, executor: 'opencode', sessionId: 'sess-hf',
    messages: [
      { role: 'user', ts: 1, parts: [{ kind: 'text', text: 'Mission: 盘点' }] },
      { role: 'tool', ts: 2, parts: [{ kind: 'tool', text: 'ls', tool: 'bash' }] },
      { role: 'assistant', ts: 3, parts: [{ kind: 'text', text: '过程中间汇报一句' }] },
      { role: 'assistant', ts: 4, parts: [{ kind: 'text', text: '盘点完成：3 个顶层目录，产物 report-x.md。' }] },
    ],
  }
  try {
    const task = mkTask({
      taskId: '20260904-hf1', title: 'x', status: 'closed',
      attemptLog: [{ id: 'oc-1', sessionId: 'sess_hf', startedAt: new Date().toISOString(), outcome: 'succeeded' }],
    })
    const cmd = mkCmd({ commandId: 'cmd-hf1', text: '做 x', status: 'approved', staffSessionId: 'staff-hf1', taskId: '20260904-hf1' })
    const el = createElement(views.FocusPage, {
      cmd, chain: [task as never], statuses: new Map(), hqSessionId: null, services,
      focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
      onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
    })
    const r = await render(el)
    const btn = r.click(/任务会话|Task session/)
    assert.ok(btn !== null, '任务会话钮在场')
    await new Promise(resolve => setTimeout(resolve, 120))
    const wrap = document.querySelector('.war-session-finalwrap')
    assert.ok(wrap !== null, '最终汇报置顶块在场')
    assert.ok(wrap?.textContent?.includes('盘点完成：3 个顶层目录') === true, '钉的是末条 assistant 汇报')
    const proc = document.querySelector('.war-session-process') as HTMLDetailsElement | null
    assert.ok(proc !== null, '过程流折叠容器在场')
    assert.ok(proc?.open !== true, '过程流默认折叠')
    assert.ok(proc?.textContent?.includes('过程记录') === true || proc?.textContent?.includes('Process log') === true, '折叠摘要标签在场')
    assert.ok(proc?.textContent?.includes('Mission: 盘点') === true, '过程消息全量保留在折叠内')
    r.unmount()
  } finally {
    historyFixture = { ok: false, error: '测试桩：无此会话' }
  }
})

test('V19 铺面：链上任务卡计划/任务书走 md-lite——编号步骤成列表、产物可点、版本号不误链', async () => {
  const task = mkTask({
    taskId: '20260904-pl1', title: 'CHANGELOG 方案', status: 'closed',
    workspacePath: '/tmp/w/tasks/pl1',
    brief: '建 CHANGELOG.md 骨架，版本段从 1.0.0 起。',
  })
  const cmd = mkCmd({
    commandId: 'cmd-pl1', text: '做 CHANGELOG 方案', status: 'approved', taskId: '20260904-pl1',
    plan: { status: 'approved', text: '目标：建极简 CHANGELOG 维护方案（骨架含 1.0.0 版本段）。\n\n1. 在工作区根建 CHANGELOG.md；\n2. 约定条目格式。' },
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [task], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  // 展开任务段任务卡 → taskPanel（计划+任务书）
  const card = document.querySelector('.war-cd-stage[data-stage="task"] .war-card-top') as HTMLElement | undefined
  card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  const ol = document.querySelector('.war-cd-stage[data-stage="task"] .war-md-ol')
  assert.ok(ol !== null, '计划编号步骤渲染成有序列表')
  // 计划与任务书里的产物文件=可点（任务工作区在场）；版本号 1.0.0 不成按钮
  const pathBtns = [...document.querySelectorAll('.war-cd-stage[data-stage="task"] button.war-md-path')] as HTMLButtonElement[]
  const labels = pathBtns.map(b => b.textContent)
  assert.ok(labels.includes('CHANGELOG.md'), `产物可点（got ${labels.join(',')}）`)
  assert.ok(!labels.includes('1.0.0'), '版本号不误链')
  calls.length = 0
  pathBtns[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.ok(calls.some(c => c.url.includes('/warroom/api/workspace/file') && String(c.url).includes(encodeURIComponent('/tmp/w/tasks/pl1'))), '计划产物点击打到 workspace/file（任务工作区锚点）')
  assert.ok(document.querySelector('[data-war-preview]') !== null, '预览弹窗在场')
  r.unmount()
})

test('V19 字体缩放：设置抽屉滑杆在场，调值 → .war-root zoom 内联生效 + localStorage 持久', async () => {
  boardFixture = { ok: true, active: true, warRoot: '/tmp/w', hqSessionId: null, revision: 'r0', commands: [], tasks: [], threads: [], roster: [], rosterErrors: [] }
  const r = await render(createElement(views.warView(services)))
  await new Promise(resolve => setTimeout(resolve, 300))
  localStorage.removeItem('warroom-cfg-zoom')
  const gear = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').includes('设置') || (b.getAttribute('aria-label') ?? '').toLowerCase().includes('settings'))
  assert.ok(gear !== undefined, '⚙ 设置钮在场')
  gear!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  const range = document.querySelector('input[type=range]') as HTMLInputElement | null
  assert.ok(range !== null, '字体滑杆在场')
  assert.equal(range!.min, '0.85')
  assert.equal(range!.max, '1.35')
  // React 受控 input：走原生 setter + input 事件
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set
  setter?.call(range, '1.2')
  range!.dispatchEvent(new win.Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  const rootEl = document.querySelector('.war-root') as HTMLElement | null
  assert.ok(rootEl !== null)
  const rootStyle = rootEl!.getAttribute('style') ?? ''
  assert.ok(rootStyle.includes('--war-fs') && rootStyle.replace(/\s/g, '').includes('1.2'), `根元素字号系数生效（style=${rootStyle}）`)
  assert.equal(localStorage.getItem('warroom-cfg-zoom'), '1.2', '持久化落 localStorage')
  // 重置钮回 1
  const reset = [...document.querySelectorAll('.war-font-row button')].find(b => /重置|Reset/.test(b.textContent ?? ''))
  assert.ok(reset !== undefined, '重置钮在场')
  reset!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(localStorage.getItem('warroom-cfg-zoom'), '1', '重置回 1')
  r.unmount()
})

// ─── D24 两档制：L1 待签面板（find-my-goal 定稿语义）─────────────────────────

test('D24 L1 待签：可编辑五项卡在场，编辑后签发打到 /commands/plan 携定稿文本', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-l1s', status: 'talking', staffSessionId: 'staff-x', grade: 'L1',
    brief: { goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' },
    plan: { text: '五项文本', status: 'pending' },
    awaitingSign: true,
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    const text = r.text()
    assert.ok(document.querySelector('.war-sign-card') !== null, '待签卡结构在场')
    assert.ok(text.includes('任务书待你签') || text.includes('awaiting your signature'), '段头结论=待你签')
    assert.equal(document.querySelectorAll('.war-sign-field').length, 5, '五项可编辑文本域在场')
    // 编辑非目标字段 → 点签发 → 通道携定稿文本（/commands/plan + brief）。
    const area = document.querySelectorAll('.war-sign-field')[3] as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(area, '舰长定稿非目标')
    area.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 80))
    calls.length = 0
    const btn = r.click(/签发/)
    assert.ok(btn !== null, '签发钮在场')
    await new Promise(resolve => setTimeout(resolve, 120))
    const sign = calls.find(c => String(c.url).includes('/commands/plan'))
    assert.ok(sign !== undefined, '签发打到 /commands/plan')
    const body = sign!.body as { decision?: string; brief?: { nonGoals?: string } }
    assert.equal(body.decision, 'approve')
    assert.equal(body.brief?.nonGoals, '舰长定稿非目标', '定稿文本随通道上行')
  } finally { r.unmount() }
})

test('D24 L1 待签：驳回需意见（空意见钮禁用）；已签发展示定稿文本+结论翻转', async () => {
  const cmd = mkCmd({
    commandId: 'cmd-l1r', status: 'talking', staffSessionId: 'staff-x', grade: 'L1',
    brief: { goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' },
    plan: { text: '五项文本', status: 'pending' },
    awaitingSign: true,
  })
  const el = createElement(views.FocusPage, {
    cmd, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  try {
    const rejectBtn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('驳回重拟')) as HTMLButtonElement | undefined
    assert.ok(rejectBtn !== undefined, '驳回钮在场')
    assert.equal(rejectBtn!.disabled, true, '空意见驳回禁用')
    // 决策带不让位：待签不渲染旧计划批准面（brief 在场=新流程归会议室）。
    assert.ok(!r.text().includes('计划已获'), '旧计划批准面不在场')
  } finally { r.unmount() }

  const signed = mkCmd({
    commandId: 'cmd-l1d', status: 'talking', staffSessionId: 'staff-x', grade: 'L1',
    brief: { goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' },
    briefSigned: { goal: '定稿目标', background: '原背景', acceptance: '原验收', nonGoals: '定稿非目标', deliverables: '原交付物' },
    plan: { text: '五项文本', status: 'approved' },
  })
  const el2 = createElement(views.FocusPage, {
    cmd: signed, chain: [], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [signed],
  })
  const r2 = await render(el2)
  try {
    const text = r2.text()
    assert.ok(text.includes('已签发——大副发布中') || text.includes('Signed'), '结论翻转为已签发')
    assert.ok(text.includes('定稿非目标'), '定稿文本展示')
    assert.ok(!text.includes('任务书待你签'), '待签结论退场')
  } finally { r2.unmount() }
})

test('V24.1 席别徽标：task_conscripted 上账的席别在聚焦页执行会话行可见', async () => {
  const task = mkTask({
    taskId: '20260908-seat1', title: '席别徽标 x', status: 'reported',
    workspacePath: '/tmp/w/tasks/seat1', executorSeat: 'pi',
    attemptLog: [{ id: 'pi-1', sessionId: 'pi-seat-1', startedAt: new Date().toISOString(), outcome: 'reported' }],
    reports: [{ ts: new Date().toISOString(), text: '完成', evidence: null, deliverables: null }],
  })
  const cmd = mkCmd({ commandId: 'cmd-seat1', text: '席别徽标', status: 'approved', taskId: '20260908-seat1' })
  const el = createElement(views.FocusPage, {
    cmd, chain: [task], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  const r = await render(el)
  const chip = document.querySelector('.war-seat-chip')
  assert.ok(chip !== null, '席别徽标在场')
  assert.equal(chip?.textContent, 'pi')
  // 老任务（无上账）不渲染徽标——投影可选字段缺席=安静无物。
  const oldTask = mkTask({ taskId: '20260908-seat0', title: '老任务', status: 'reported', attemptLog: [{ id: 'a', sessionId: 's0', startedAt: new Date().toISOString(), outcome: 'reported' }] })
  const el2 = createElement(views.FocusPage, {
    cmd: mkCmd({ commandId: 'cmd-seat0', text: '老任务', status: 'approved', taskId: '20260908-seat0' }), chain: [oldTask], statuses: new Map(), hqSessionId: null, services,
    focusSegment: null, onClose: () => {}, onRegrade: () => {}, onDecidePlan: () => {},
    onReportSeen: () => {}, onJumpMiss: () => {}, chainMembers: [cmd],
  })
  r.unmount()
  const r2 = await render(el2)
  assert.equal(document.querySelector('.war-seat-chip'), null, '无上账=无徽标')
  r2.unmount()
})
