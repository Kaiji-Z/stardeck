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
const jsonResponse = (data: unknown, ok = true): Response =>
  ({ ok, status: 200, json: async () => data }) as unknown as Response
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  let body: unknown
  if (init?.body !== undefined) { try { body = JSON.parse(String(init.body)) } catch { body = String(init.body) } }
  calls.push({ url, body })
  if (url.includes('/warroom/api/board')) return jsonResponse(boardFixture)
  if (url.includes('/warroom/api/attach/history')) return jsonResponse({ ok: false, error: '测试桩：无此会话' })
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
