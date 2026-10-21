/**
 * stardeck 独立板 UI 入口——**看板基座 + 可拖拽舰桥悬浮球（2026-10-21 舰长定案）**。
 * 三态壳退役：不再分栏。看板（warView）恒为基座；代理舰长聊天=悬浮球点开的
 * Telegram 式浮窗——**球可拖动**（点按=开关窗、拖动=移位、位置持久化），窗口
 * 贴着球择向弹出（球在右下→向左上开），拖动时窗口实时跟随。消息排版对齐
 * lookatstudy 中栏 UI 配置：AI 消息扁平全宽 prose、舰长消息右对齐小气泡。
 * **设置唯一入口=看板设置抽屉**（views.tsx SettingsDrawer）。旗 OFF 无球无窗。
 * 门体在 client/fleet-gate.tsx；到访 lastSeen 离页落。
 * @module stardeck/client-standalone
 */
import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ensureWarStyles } from './client/styles.ts'
import { warView, type ClientServicesFace } from './client/views.tsx'
import { fleetGate, type FleetState } from './client/fleet-gate.tsx'
import { BridgePane } from './client/bridge.tsx'
import { collectInbox } from './client/inbox.ts'
import { useWar } from './client/data.ts'
import { activeCopy } from './client/copy.ts'

ensureWarStyles()

// 开机应用明暗偏好（设置抽屉「深色界面」落 warroom-standalone-theme）——
// 渲染前置属性，避免深色用户首帧白闪。插件形态无此逻辑（明暗随宿主）。
try {
  if (localStorage.getItem('warroom-standalone-theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', 'true')
} catch { /* storage unavailable */ }
// standalone 标记——固定 chrome 让位的 CSS 钩子（板头让出顶右簇宽度）。
document.body.setAttribute('data-stardeck-standalone', '1')

// 独立形态没有宿主会话面——sessions 缺席逐点降级；standaloneChrome=true
// 供给宿主才有的铬层控件（设置抽屉的明暗开关+定夺授权段）。
const services: ClientServicesFace = { standaloneChrome: true }
const Board = warView(services)

/** 罗经星（悬浮球球面）：与桌面安装器图标同源的五角星形。 */
const BALL_STAR = 'M12 2.2l2.83 6.44 6.97.62-5.27 4.63 1.56 6.83L12 17.1l-6.09 3.62 1.56-6.83-5.27-4.63 6.97-.62z'
const BALL_SIZE = 54
const BALL_KEY = 'warroom-tg-ball-pos'
const PANEL_W = 420
const PANEL_H = 620
const GAP = 12

/** 球位=右/下边距（resize 相对锚，比绝对 x/y 抗窗口变化）。 */
type BallPos = { right: number; bottom: number }
function storedBallPos(): BallPos {
  try {
    const v = JSON.parse(localStorage.getItem(BALL_KEY) ?? '') as BallPos
    if (typeof v?.right === 'number' && typeof v?.bottom === 'number' && v.right >= 0 && v.bottom >= 0) return v
  } catch { /* 缺省/坏值 → 默认位 */ }
  return { right: 18, bottom: 18 }
}
const clampPos = (p: BallPos): BallPos => ({
  right: Math.min(Math.max(p.right, 8), Math.max(8, window.innerWidth - BALL_SIZE - 8)),
  bottom: Math.min(Math.max(p.bottom, 8), Math.max(8, window.innerHeight - BALL_SIZE - 8)),
})

/** 聊天浮窗贴球择位：球在右半→窗开球左侧；球在下半→窗开球上方；钳在视口内。
 *  拖动时 style 由同一 state 推导——窗口实时跟着球走。 */
function panelStyle(pos: BallPos): CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(PANEL_W, vw - 16)
  const h = Math.min(PANEL_H, vh - 16)
  const ballLeft = vw - pos.right - BALL_SIZE
  const ballTop = vh - pos.bottom - BALL_SIZE
  const openLeft = ballLeft + BALL_SIZE / 2 > vw / 2
  const openUp = ballTop + BALL_SIZE / 2 > vh / 2
  const style: CSSProperties = { width: w, height: h }
  if (openLeft) style.right = Math.min(vw - w - 8, pos.right + BALL_SIZE + GAP)
  else style.left = Math.min(vw - w - 8, ballLeft + BALL_SIZE + GAP)
  if (openUp) style.bottom = Math.min(vh - h - 8, pos.bottom + BALL_SIZE + GAP)
  else style.top = Math.min(vh - h - 8, ballTop + BALL_SIZE + GAP)
  return style
}

function App(): ReturnType<typeof createElement> {
  const [fleet, setFleet] = useState<FleetState | undefined>(undefined)
  const [phase, setPhase] = useState<'entry' | 'board' | 'switch'>('entry')
  const [error, setError] = useState('')
  const [bindNote, setBindNote] = useState('')
  // UI 目检实抓的入场门伏击竞态：门只在探测 settled 后决定（fleetSettled）。
  const [fleetSettled, setFleetSettled] = useState(false)
  const { data } = useWar()
  const bridgeOn = data?.bridge?.enabled === true
  const [chatOpen, setChatOpen] = useState(false)
  const [ballPos, setBallPos] = useState<BallPos>(storedBallPos)
  // 窗口 resize 时重钳球位+刷新窗位（浮窗 style 由视口尺寸推导）。
  useEffect(() => {
    const onResize = (): void => { setBallPos(p => clampPos(p)) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])
  // 球拖拽：pointer capture 三段（down 记起点 / move 超 6px 判拖 / up 分流
  // 点击=开关窗、拖动=落位持久化）。窗位由 ballPos 推导——拖动实时跟随。
  const dragRef = useRef<{ sx: number; sy: number; or: number; ob: number; moved: boolean; last: BallPos } | null>(null)
  const onBallDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { sx: e.clientX, sy: e.clientY, or: ballPos.right, ob: ballPos.bottom, moved: false, last: ballPos }
  }
  const onBallMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current
    if (d === null) return
    const dx = d.sx - e.clientX
    const dy = d.sy - e.clientY
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return
    d.moved = true
    d.last = clampPos({ right: d.or + dx, bottom: d.ob + dy })
    setBallPos(d.last)
  }
  const onBallUp = (): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d === null) return
    if (d.moved) {
      setBallPos(clampPos(d.last))
      try { localStorage.setItem(BALL_KEY, JSON.stringify(clampPos(d.last))) } catch { /* 隐私模式 */ }
    } else setChatOpen(v => !v)
  }
  // 决策待决数（球面角标）：有请示压着时舰长不用开窗也知道。
  const pending = bridgeOn && data !== null ? collectInbox(data.commands, data.tasks).length : 0
  // 点穿聚焦页：窗收起 + 板面 hash 深链（warView 自带 hashchange 监听）。
  const openBoard = useCallback((commandId?: string): void => {
    setChatOpen(false)
    if (commandId !== undefined && commandId !== '') {
      try { location.hash = `#war-cmd-${commandId}` } catch { /* 隐私模式 */ }
    }
  }, [])
  const loadFleet = useCallback((): void => {
    fetch('/warroom/api/fleet').then(r => r.json()).then((f: { ok?: boolean; active?: FleetState['active']; seats?: FleetState['seats']; proxyLoop?: boolean }) => {
      if (f.ok === true && f.active !== undefined && f.seats !== undefined) setFleet({ active: f.active, seats: f.seats, proxyLoop: f.proxyLoop })
    }).catch(() => { /* daemon 不在——仍放行进甲板（读投影会显示离线态） */ })
      .finally(() => { setFleetSettled(true) })
  }, [])
  useEffect(() => { loadFleet() }, [loadFleet])
  const enter = useCallback((executor: string, model: string) => {
    setError('')
    setBindNote('')
    fetch('/warroom/api/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ executor, model }) })
      .then(async r => {
        const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) as { ok?: boolean; error?: string; note?: string }
        if (out.ok !== true) setError(`舰队绑定失败：${out.error ?? `HTTP ${r.status}`}——可返回甲板继续用当前舰队，或重试。`)
        else if (typeof out.note === 'string' && out.note !== '') setBindNote(out.note) // 回执一句：舰队胶囊 tooltip
      })
      .catch(() => { setError('舰队绑定失败：舰桥失联（daemon 不在？）——可返回甲板，或起服后重试。') })
      .finally(() => { setPhase('board') }
      )
  }, [])
  // 入场门确定性首幕：探测未决 → loading 占位；settled：有 fleet → 门，无 fleet
  // → 无门直入离线态。phase 进 board 后门不再自动回弹（胶囊显式点击重开）。
  if (phase === 'entry' && !fleetSettled) {
    return createElement('div', { style: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'sans-serif' } }, activeCopy().loading.connecting)
  }
  if ((phase === 'entry' || phase === 'switch') && fleet !== undefined) {
    return createElement(fleetGate, { fleet, onEnter: enter, dismissible: phase === 'switch', onDismiss: () => { setPhase('board') }, error, onReprobe: loadFleet })
  }
  const bc = activeCopy().bridge
  // 舰队胶囊：常驻（球上方一档；旗 OFF 无球时落底角）——切舰队只影响后续征召。
  const pill = fleet !== undefined
    ? createElement('button', {
        className: `war-root war-tg-pill${bridgeOn ? '' : ' war-tg-pill-solo'}`, type: 'button', 'data-bridge-fleet': '1',
        title: bindNote !== '' ? `切换舰队（只影响后续征召）\n${bindNote}` : '切换舰队（只影响后续征召）',
        onClick: () => { setPhase('switch') },
      }, activeCopy().head.fleetPill(fleet.active.executor).replace(' ⇄', ''))
    : null
  // 可拖拽悬浮球（bridge ON 才在）：点按=开关聊天窗，拖动=移位（位置持久化）。
  const ball = bridgeOn
    ? createElement('button', {
        className: 'war-root war-tg-ball', type: 'button', 'data-bridge-ball': '1',
        'aria-label': bc.title, title: bc.title,
        style: { right: ballPos.right, bottom: ballPos.bottom },
        onPointerDown: onBallDown, onPointerMove: onBallMove, onPointerUp: onBallUp,
      },
        createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          createElement('path', { d: BALL_STAR, fill: 'var(--war-run-strong, #3b82f6)' })),
        pending > 0 ? createElement('span', { className: 'war-tg-ball-badge', 'data-bridge-badge': String(pending) }, pending > 9 ? '9+' : String(pending)) : null,
      )
    : null
  // Telegram 式聊天浮窗：贴球择向弹出（style 见 panelStyle），头（标题+格言+关闭）
  // + 聊天面本体；拖球时随 state 重渲染实时跟随。
  const panel = bridgeOn && chatOpen
    ? createElement('div', { className: 'war-root war-tg-panel', 'data-bridge-panel': '1', role: 'dialog', 'aria-label': bc.title, style: panelStyle(ballPos) },
        createElement('div', { className: 'war-tg-head' },
          createElement('div', { className: 'war-tg-head-text' },
            createElement('span', { className: 'war-tg-title' }, bc.title),
            createElement('span', { className: 'war-tg-motto' }, bc.motto)),
          createElement('button', { className: 'war-btn war-tg-close', type: 'button', 'aria-label': activeCopy().settings.close, 'data-bridge-panel-close': '1', onClick: () => { setChatOpen(false) } }, '✕')),
        createElement('div', { className: 'war-tg-body' }, createElement(BridgePane, { onOpenBoard: openBoard })),
      )
    : null
  // 满高挂载：板恒为基座；球/胶囊/浮窗浮于其上。
  return createElement('div', { style: { height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0 } },
    createElement('div', { className: 'war-standalone-board', style: { flex: 1, display: 'flex', minHeight: 0, overflow: 'auto' } }, createElement(Board)),
    pill,
    ball,
    panel,
  )
}

const root = document.getElementById('stardeck-root')
if (root !== null) {
  createRoot(root).render(createElement(App))
  // 到访快照：离页落 lastSeen（visit.ts 的到访摘要 delta 以此为锚）。
  const writeLastSeen = (): void => {
    try { localStorage.setItem('warroom-last-seen', new Date().toISOString()) } catch { /* storage unavailable */ }
  }
  window.addEventListener('pagehide', writeLastSeen)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeLastSeen() })
} else {
  console.error('stardeck: #stardeck-root 挂载点缺席——检查 index.html')
}
