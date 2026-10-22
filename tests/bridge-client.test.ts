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
let bridgeFail = false // B5 断网回归：拒答 bridge 端点模拟失联
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
  if (url.includes('/warroom/api/bridge/messages')) { if (bridgeFail) throw new Error('offline') ; return jsonResponse(bridgeFixture) }
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
    // 双重编号回归（UI 目检实抓）：问句自带「1. 」前缀，<ol> 再画一层=「1. 1.」
    // ——stem 剥模型侧编号后不该再出现连号。
    assert.ok(!r.text().includes('1. 1.'), '问干无双重编号')
    const opt = r.buttons().find(b => (b.textContent ?? '').trim() === '工具箱仓')
    assert.ok(opt !== undefined, '选项药丸在场')
    opt!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 30))
    // 人话回显（D31 批判 P1）：已选摘要出「1→选项原文」，拼装码不进任何可见输入框。
    const chosen = document.querySelector('[data-bridge-chosen]')
    assert.ok(chosen !== null, '已选摘要在场')
    assert.ok((chosen.textContent ?? '').includes('已选') && (chosen.textContent ?? '').includes('工具箱仓'), `摘要人话：${chosen.textContent}`)
    const tas = [...document.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    assert.ok(tas.every(t => !(t.value ?? '').includes('1A')), `拼装码不泄漏进输入框：${tas.map(t => t.value).join('|')}`)
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

test('D27 降级态：bridge.proxy=false → 输入停用+诚实文案在场（战报/决策卡面不撤）', async () => {
  boardFixture = { ...boardFixture, bridge: { enabled: true, proxy: false, verdictAuthorized: false } }
  try {
    const r = await render({}, '代理舰长未在役')
    try {
      const ta = r.textareaAt('data-bridge-input')!
      assert.equal(ta.disabled, true, 'proxy 旗 OFF：输入停用')
      const send = r.buttons().find(b => b.getAttribute('data-bridge-send') === '1')!
      assert.equal(send.disabled, true, '发送钮停用')
      assert.ok(r.text().includes('代理舰长未在役'), '降级诚实文案在场')
      assert.ok(r.text().includes('等你定夺'), '决策卡坞照常在场')
    } finally { r.unmount() }
  } finally {
    delete (boardFixture as { bridge?: unknown }).bridge
  }
})

test('BridgePane 图景附件：agent 话轮带 artifact → 沙箱 iframe（sandbox=""）+新窗链接', async () => {
  bridgeFixture = {
    ok: true,
    revision: 'r2',
    messages: [
      { kind: 'user', ts: '2026-10-20T10:00:00.000Z', text: '讲讲现在舰队情况' },
      { kind: 'agent', ts: '2026-10-20T10:01:00.000Z', text: '配一页图景给你看。', agentId: 'proxy-x', artifact: { id: 'scene-mock', title: '舰队晨报' } },
    ],
  }
  boardFixture = {
    ...boardFixture,
    commands: [], tasks: [],
  } as never
  const r = await render({}, '舰队晨报')
  try {
    const frame = document.querySelector('iframe.war-bmsg-scene') as HTMLIFrameElement | null
    assert.ok(frame !== null, '图景 iframe 在场')
    assert.equal(frame!.getAttribute('sandbox'), '', 'sandbox 空串=禁一切脚本/同源（第一道保险）')
    assert.equal(frame!.getAttribute('src'), '/warroom/api/artifact/scene-mock', 'src 指 artifact 端点')
    const link = [...document.querySelectorAll('a.war-bref')].find(a => (a.getAttribute('href') ?? '').includes('scene-mock'))
    assert.ok(link !== null, '新窗看全图链接在场')
  } finally { r.unmount() }
})

// ── D29 critique 修复锁：打回理由纪律 / 在途指示 / 草稿跨挂载 ──

test('D29 打回纪律：理由空=打回钮禁用；填了才启用（不再发悬空冒号令）', async () => {
  bridgeFixture = { ok: true, revision: 'r1', messages: [] }
  boardFixture = {
    ...boardFixture,
    commands: [],
    tasks: [{
      taskId: 't-k', title: '打回考题', status: 'reported', priority: 'normal', quality: 'common',
      rounds: 1, attempts: 1, deps: [], lastError: null, workspacePath: null, workspaceKind: null,
      claimedBy: null, executorSeat: null, startedAt: '2026-10-21T09:00:00Z', brief: 'b', acceptance: 'a',
      schedule: null, queueAhead: 0, quotaPaused: false,
      attemptLog: [], troops: [], deliverables: [],
      reports: [{ ts: '2026-10-21T09:30:00Z', from: 'e1', text: '做完了个大概。', evidence: { checks: [{ item: 'x', passed: false }] }, testsTrail: null }],
      comments: [], closedVerdict: null,
    }],
  } as never
  const r = await render({}, '打回考题')
  try {
    const knock = r.buttons().find(b => b.getAttribute('data-bridge-act') === 'knock')!
    assert.equal(knock.disabled, true, '空理由=打回禁用')
    const note = r.textareaAt('data-bridge-knock-note')!
    assert.ok(note !== null, '打回理由输入面在场')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(note, '验收第 2 项没过，测试是假绿')
    note.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 30))
    assert.equal(knock.disabled, false, '填了理由=打回启用')
  } finally { r.unmount() }
})

test('D29 在途指示：末条是舰长话轮=处理中胶囊在场；回话后消失', async () => {
  bridgeFixture = { ok: true, revision: 'r1', messages: [{ kind: 'user', ts: '2026-10-21T10:00:00.000Z', text: '现在舰队什么情况？' }] }
  boardFixture = { ...boardFixture, commands: [], tasks: [] } as never
  const r = await render({}, '处理中')
  try {
    assert.ok(document.querySelector('[data-bridge-typing]') !== null, '在途指示在场')
    assert.ok(document.querySelector('.war-bridge-msgs')?.getAttribute('aria-live') === 'polite', '消息流 aria-live 在场')
  } finally { r.unmount() }
  bridgeFixture = { ok: true, revision: 'r2', messages: [
    { kind: 'user', ts: '2026-10-21T10:00:00.000Z', text: '现在舰队什么情况？' },
    { kind: 'agent', ts: '2026-10-21T10:01:00.000Z', text: '三条线并进，一条待你验收。', agentId: 'proxy-x' },
  ] }
  const r2 = await render({}, '三条线并进')
  try {
    assert.equal(document.querySelector('[data-bridge-typing]'), null, '回话后指示消失')
  } finally { r2.unmount() }
})

test('D29 草稿跨挂载：输入→卸载→重挂，输入不丢（切视图不再焚稿）', async () => {
  bridgeFixture = { ok: true, revision: 'r1', messages: [] }
  boardFixture = { ...boardFixture, commands: [], tasks: [] } as never
  const r1 = await render({}, '想做什么直接说')
  const ta1 = r1.textareaAt('data-bridge-input')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(ta1, '这道命令要跨视图活下去')
  ta1.dispatchEvent(new win.Event('input', { bubbles: true }))
  await new Promise(res => setTimeout(res, 30))
  r1.unmount()
  const r2 = await render({}, '想做什么直接说')
  try {
    const ta2 = r2.textareaAt('data-bridge-input')!
    assert.equal(ta2.value, '这道命令要跨视图活下去', '重挂后草稿原样回来')
  } finally { r2.unmount() }
})


test('B3 回归：Enter 直发（无 Shift）——POST 落 /bridge/messages；Shift+Enter 只换行不发', async () => {
  const before = calls.filter(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined).length
  const r = await render({}, '想做什么直接说')
  try {
    const ta = r.textareaAt('data-bridge-input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, 'Enter 直发回归')
    ta.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 30))
    // Shift+Enter：不发送
    ta.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 50))
    let after = calls.filter(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined).length
    assert.equal(after, before, 'Shift+Enter 不触发 POST')
    // Enter：发送
    ta.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 80))
    after = calls.filter(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined).length
    assert.equal(after, before + 1, 'Enter 触发一次 POST')
  } finally { r.unmount() }
})

test('B5 回归：bridge 端点失联 → 常驻断网 banner（恢复自清）', async () => {
  bridgeFail = true
  const r = await render({}, '舰桥失联')
  try {
    assert.ok(r.text().includes('舰桥失联——正在自动重试'), '断网 banner 常驻在场')
    const banner = document.querySelector('[data-bridge-offline]')
    assert.ok(banner !== null, 'banner 锚点在场')
  } finally {
    r.unmount()
    bridgeFail = false
    await new Promise(res => setTimeout(res, 50))
  }
})

test('B4 回归：空态欢迎语含格言（完整可读，不再截断于头部）', async () => {
  bridgeFixture = { ok: true, messages: [], revision: 'r1' }
  const r = await render({}, '想做什么直接说')
  try {
    assert.ok(r.text().includes('舰队的事他兜着'), '格言降级到欢迎语第二行（完整文本）')
  } finally { r.unmount() }
})


test('段2 回归：toolStepLabelOf 映射（read_board/digest/ledger→舰长语；未知名透传）', async () => {
  const { toolStepLabelOf } = await import('../src/client/bridge.tsx')
  assert.equal(toolStepLabelOf('read_board'), '读板投影')
  assert.equal(toolStepLabelOf('read_digest'), '读待决摘要')
  assert.equal(toolStepLabelOf('read_ledger'), '读账本切片')
  assert.equal(toolStepLabelOf('read_unknown'), 'read_unknown')
})

test('段2 回归：agent 消息带复制钮 + 未读分隔条（lastSeen 锚后首条 agent 消息前插）', async () => {
  try { localStorage.setItem('warroom-last-seen', '2026-10-20T00:00:00.000Z') } catch { /* n/a */ }
  bridgeFixture = { ok: true, messages: [
    { id: 'm1', kind: 'agent', ts: '2026-10-19T08:00:00.000Z', text: '旧话轮' },
    { id: 'm2', kind: 'agent', ts: '2026-10-21T08:00:00.000Z', text: '新话轮：舰队自转中' },
  ], revision: 'r2' }
  const r = await render({}, '新话轮：舰队自转中')
  try {
    assert.ok(r.text().includes('以下为新动静'), '未读分隔条在场（lastSeen 后首条 agent 消息前）')
    const copyBtns = document.querySelectorAll('[data-bridge-copy]')
    assert.ok(copyBtns.length >= 2, `agent 消息各有复制钮（得 ${copyBtns.length}）`)
  } finally {
    r.unmount()
    bridgeFixture = { ok: true, messages: [], revision: 'r1' }
    try { localStorage.removeItem('warroom-last-seen') } catch { /* n/a */ }
  }
})


test('段2 回归：IME 组合态 Enter 不误发（isComposing 守卫）', async () => {
  const before = calls.filter(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined).length
  const r = await render({}, '想做什么直接说')
  try {
    const ta = r.textareaAt('data-bridge-input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, '中文输入法组字中')
    ta.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 30))
    ta.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const ev = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'isComposing', { value: true })
    ta.dispatchEvent(ev)
    await new Promise(res => setTimeout(res, 50))
    const after = calls.filter(c => c.url.includes('/warroom/api/bridge/messages') && c.body !== undefined).length
    assert.equal(after, before + 1, '普通 Enter 恰一发；isComposing Enter 不发（组字期不误触）')
  } finally { r.unmount() }
})

test('段2 回归：lastSeen 缺席/为空 → 不出未读分隔', async () => {
  try { localStorage.removeItem('warroom-last-seen') } catch { /* n/a */ }
  bridgeFixture = { ok: true, messages: [{ id: 'm1', kind: 'agent', ts: '2026-10-21T08:00:00.000Z', text: '无锚话轮' }], revision: 'r3' }
  const r = await render({}, '无锚话轮')
  try {
    assert.ok(!r.text().includes('以下为新动静'), '无 lastSeen 锚=不插分隔')
  } finally {
    r.unmount()
    bridgeFixture = { ok: true, messages: [], revision: 'r1' }
  }
})

test('段2 回归：复制钮点击回执「已复制」（clipboard 缺席亦不炸）', async () => {
  bridgeFixture = { ok: true, messages: [{ id: 'm1', kind: 'agent', ts: '2026-10-21T08:00:00.000Z', text: '复制回执话轮' }], revision: 'r4' }
  const r = await render({}, '复制回执话轮')
  try {
    const btn = document.querySelector('[data-bridge-copy]') as HTMLButtonElement | null
    assert.ok(btn !== null, '复制钮在场')
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 50))
    assert.ok((btn.textContent ?? '').includes('已复制'), '点击后回执已复制')
  } finally {
    r.unmount()
    bridgeFixture = { ok: true, messages: [], revision: 'r1' }
  }
})

test('段2 回归：系统战报不出复制钮（只有 agent 话轮可复制）', async () => {
  bridgeFixture = { ok: true, messages: [{ id: 'm1', kind: 'system', ts: '2026-10-21T08:00:00.000Z', text: '机械战报', noticeKind: 'reported' }], revision: 'r5' }
  const r = await render({}, '机械战报')
  try {
    assert.equal(document.querySelectorAll('[data-bridge-copy]').length, 0, '系统消息无复制钮')
  } finally {
    r.unmount()
    bridgeFixture = { ok: true, messages: [], revision: 'r1' }
  }
})

test('段2 回归：toolStepLabelOf 未知名透传（不炸不空）', async () => {
  const { toolStepLabelOf } = await import('../src/client/bridge.tsx')
  assert.equal(toolStepLabelOf(''), '')
  assert.equal(toolStepLabelOf('read_anything_else'), 'read_anything_else')
})


test('B3 同律回归：澄清补充框 Enter 发答复（Shift 不发）', async () => {
  const answerCallsBefore = calls.filter(c => c.url.includes('/commands/answer')).length
  boardFixture = {
    ...boardFixture,
    commands: [{
      commandId: 'cmd-e', text: '做工具', createdAt: '2026-10-20T09:00:00Z', status: 'talking',
      staffSessionId: 's1', taskId: null, cancelledReason: null, grade: null, gradeReason: null, gradeConfidence: null, regrades: 0,
      plan: null, schedule: null, chain: { generation: 1, rootId: 'cmd-e', length: 1, hueSlot: 0 }, continuation: null,
      clarification: { questions: ['1. 用哪个仓？A 仓甲 / B 你帮我定'], options: [['仓甲', '你帮我定']], round: 1, status: 'pending', answer: null },
      clarificationRounds: null, brief: null, briefSigned: null, awaitingSign: null,
    }],
    tasks: [],
  } as never
  const r = await render({}, '等你答复')
  try {
    const tas = [...document.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    const note = tas.find(t => (t.placeholder ?? '').includes('补充'))
    assert.ok(note !== undefined, '补充说明框在场')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(note!, '补充一句')
    note!.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise(res => setTimeout(res, 30))
    note!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 50))
    assert.equal(calls.filter(c => c.url.includes('/commands/answer')).length, answerCallsBefore, 'Shift+Enter 不发')
    note!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await new Promise(res => setTimeout(res, 80))
    assert.equal(calls.filter(c => c.url.includes('/commands/answer')).length, answerCallsBefore + 1, 'Enter 发答复')
  } finally {
    r.unmount()
  }
})
