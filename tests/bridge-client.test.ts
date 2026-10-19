/**
 * D26 舰桥频道渲染层测试（happy-dom harness，与 client-render.test.ts 同纪律）：
 * BridgePane 空态欢迎/输入面在场、三类决策卡（澄清选项药丸/签发五项/验收证据）
 * 按板数据渲染、发送动作打到 /bridge/messages 通道。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'

// ── DOM 全域就位（须先于组件导入） ──
const win = new Window()
Object.assign(globalThis, {
  window: win,
  document: win.document,
  localStorage: win.localStorage,
  HTMLElement: win.HTMLElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  MutationObserver: win.MutationObserver,
  KeyboardEvent: win.KeyboardKeyboardEvent ?? win.KeyboardEvent,
  MouseEvent: win.MouseEvent,
  CustomEvent: win.CustomEvent,
  getComputedStyle: win.getComputedStyle,
  requestAnimationFrame: (cb: FrameRequestCallback): number => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (h: number): void => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  IntersectionObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): Array<never> { return [] } },
})
try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }) } catch { /* 已有可用值 */ }

// ── fetch 路由 stub ──
const calls: Array<{ url: string; body?: unknown }> = []
let bridgeFixture: Record<string, unknown> = { ok: true, messages: [], revision: 'r1' }
let boardFixture: Record<string, unknown> = {
  ok: true, active: true, warRoot: '/tmp/w', hqSessionId: null, revision: 'r1',
  commands: [], tasks: [], threads: [], roster: [], rosterErrors: [],
}
const jsonResponse = (data: unknown): Response => ({ ok: true, status: 200, json: async () => data }) as unknown as Response
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  let body: unknown
  if (init?.body !== undefined) { try { body = JSON.parse(String(init.body)) } catch { body = String(init.body) } }
  calls.push({ url, body })
  if (url.includes('/warroom/api/bridge/messages')) return jsonResponse(bridgeFixture)
  if (url.includes('/warroom/api/board')) return jsonResponse(boardFixture)
  if (url.includes('/warroom/api/commands/answer')) return jsonResponse({ ok: true, note: 'ok' })
  if (url.includes('/warroom/api/commands/plan')) return jsonResponse({ ok: true })
  if (url.includes('/warroom/api/tools/call')) return jsonResponse({ ok: true })
  if (url.includes('/warroom/api/commands')) return jsonResponse({ ok: true, commandId: 'cmd-new-1' })
  return jsonResponse({ ok: true })
}) as typeof fetch

const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { BridgePane } = await import('../src/client/bridge.tsx')

interface Rendered { text: () => string; buttons: () => HTMLButtonElement[]; textareaAt: (attr: string) => HTMLTextAreaElement | null; unmount: () => void }

async function render(props: { onOpenBoard?: (commandId?: string) => void }, waitFor: string): Promise<Rendered> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(BridgePane, props))
  // 水合等待（全量套件并行负载下固定延时不可靠）：轮询到**水合后才会出现**
  // 的信号文本（空坞安神行/决策卡标题），超时 3s 兜底。
  const textNow = (): string => (host.textContent ?? '').replace(/\s+/g, ' ')
  const end = Date.now() + 3000
  while (!textNow().includes(waitFor) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 25))
  }
  return {
    text: textNow,
    buttons: () => [...host.querySelectorAll('button')],
    textareaAt: (attr: string) => host.querySelector(`textarea[${attr}]`),
    unmount: () => { root.unmount(); host.remove() },
  }
}

test('BridgePane 空态：欢迎语+输入面+发送钮+空坞安神行齐在场', async () => {
  const r = await render({}, '想做什么直接说')
  try {
    assert.ok(r.text().includes('舰桥频道'), '标题在场')
    assert.ok(r.text().includes('想做什么直接说'), '欢迎语在场')
    assert.ok(r.textareaAt('data-bridge-input') !== null, '输入框在场')
    const send = r.buttons().find(b => b.getAttribute('data-bridge-send') === '1')
    assert.ok(send !== undefined, '发送钮在场')
    assert.ok(send!.disabled, '空输入禁发')
    assert.ok(r.text().includes('没有等你定夺的事'), '空坞安神行在场')
  } finally { r.unmount() }
})

test('BridgePane 澄清卡：挂起澄清出选择题药丸，点选拼装 1A', async () => {
  boardFixture = {
    ...boardFixture,
    commands: [{
      commandId: 'cmd-c', text: '做个工具', createdAt: '2026-10-20T09:00:00Z', status: 'talking',
      staffSessionId: 's1', taskId: null, cancelledReason: null, grade: null, gradeReason: null, gradeConfidence: null, regrades: 0,
      plan: null, schedule: null, chain: { generation: 1, rootId: 'cmd-c', length: 1, hueSlot: 0 }, continuation: null,
      clarification: { questions: ['1. 用哪个仓？A 工具箱仓 / B 你帮我定'], options: [['工具箱仓', '你帮我定']], round: 1, status: 'pending', answer: null },
      clarificationRounds: null, brief: null, briefSigned: null, awaitingSign: null,
    }],
    tasks: [],
  } as never
  const r = await render({}, '等你答复')
  try {
    assert.ok(r.text().includes('等你答复'), '澄清卡标题在场')
    const opt = r.buttons().find(b => (b.textContent ?? '').trim() === '工具箱仓')
    assert.ok(opt !== undefined, '选项药丸在场')
    opt!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 30))
    // 点选后答复框带 1A（拼装语义）——从 DOM 找澄清卡内的 textarea。
    const tas = [...document.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    const answer = tas.find(t => (t.value ?? '').includes('1A'))
    assert.ok(answer !== undefined, `选项拼装 1A 入答复框：${tas.map(t => t.value).join('|')}`)
  } finally { r.unmount() }
})

test('BridgePane 签发卡：awaitingSign 出五项可编辑+签发/驳回钮', async () => {
  boardFixture = {
    ...boardFixture,
    commands: [{
      commandId: 'cmd-s', text: '大任务', createdAt: '2026-10-20T09:00:00Z', status: 'received',
      staffSessionId: 's1', taskId: null, cancelledReason: null, grade: 'L1', gradeReason: '', gradeConfidence: null, regrades: 0,
      plan: { text: '呈批', status: 'pending', decidedAt: null }, schedule: null,
      chain: { generation: 1, rootId: 'cmd-s', length: 1, hueSlot: 0 }, continuation: null,
      clarification: null, clarificationRounds: null,
      brief: { goal: '目标一', background: '背景一', acceptance: '验收一', nonGoals: '非目标一', deliverables: '交付一' },
      briefSigned: null, awaitingSign: true,
    }],
    tasks: [],
  } as never
  const r = await render({}, '等你签发')
  try {
    assert.ok(r.text().includes('等你签发'), '签发卡标题在场')
    assert.ok(r.text().includes('目标一'), '五项预填（目标）在场')
    for (const label of ['目标', '背景与约束', '验收标准', '非目标', '交付物']) assert.ok(r.text().includes(label), `字段标签 ${label}`)
    assert.ok(r.buttons().some(b => b.getAttribute('data-bridge-act') === 'sign'), '签发钮在场')
    assert.ok(r.buttons().some(b => b.getAttribute('data-bridge-act') === 'redraft'), '驳回重拟钮在场')
  } finally { r.unmount() }
})

test('BridgePane 验收卡：reported 任务出战报节选+核对行+验收/打回钮', async () => {
  boardFixture = {
    ...boardFixture,
    commands: [],
    tasks: [{
      taskId: 't-r', title: '验收任务', status: 'reported', priority: 'normal', quality: 'common',
      rounds: 1, attempts: 1, deps: [], lastError: null, workspacePath: null, workspaceKind: null,
      claimedBy: null, executorSeat: null, startedAt: '2026-10-20T09:00:00Z', brief: 'b', acceptance: 'a',
      schedule: null, queueAhead: 0, quotaPaused: false,
      attemptLog: [], troops: [],
      deliverables: [{ kind: 'file', summary: 'motto.js', detail: null, ts: '2026-10-20T09:30:00Z' }],
      reports: [{ ts: '2026-10-20T09:30:00Z', from: 'e1', text: '任务完成，全部验收项通过。', evidence: { checks: [{ item: '可用', passed: true }, { item: '测试', passed: true }] }, testsTrail: null }],
      comments: [], closedVerdict: null,
    }],
  } as never
  const r = await render({}, '等你验收')
  try {
    assert.ok(r.text().includes('等你验收'), '验收卡标题在场')
    assert.ok(r.text().includes('2/2 项验收核对通过'), '机械核对行在场')
    assert.ok(r.text().includes('任务完成'), '战报节选在场')
    assert.ok(r.buttons().some(b => b.getAttribute('data-bridge-act') === 'accept'), '验收钮在场')
    assert.ok(r.buttons().some(b => b.getAttribute('data-bridge-act') === 'knock'), '打回钮在场')
  } finally { r.unmount() }
})

test('BridgePane 发送：输入后 POST /bridge/messages 通道点名（channel 本体=独立端点）', async () => {
  const r = await render({}, '想做什么直接说')
  try {
    const ta = r.textareaAt('data-bridge-input')!
    // React 受控组件经原生 setter 设值再派发 input 事件（happy-dom 下 onChange 走 input 面）。
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, '给工具箱加个每日格言')
    ta.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 30))
    const send = r.buttons().find(b => b.getAttribute('data-bridge-send') === '1')!
    send.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 80))
    const hit = calls.find(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined)
    assert.ok(hit !== undefined, 'POST 已发出')
    assert.equal((hit!.body as { text: string }).text, '给工具箱加个每日格言')
  } finally { r.unmount() }
})
