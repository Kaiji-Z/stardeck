/**
 * stardeck 独立板 UI 入口——**舰队选择门 + 三态壳（D26 v0.3.0）**。
 * 产品形态（2026-10-20 舰长定案·对话范式）：默认脸面=聊天窗（舰桥频道）+
 * 设置入口，心智模型极简；看板可展开——分屏旁观「看板被聊天驱动」，也可
 * 进板亲自下令（composer/命令卡原样保留）。旗 OFF（STARDECK_BRIDGE=0）时
 * /board 不带 bridge 面，壳回落看板先行老形态（字节等价）。
 * 门体在 client/fleet-gate.tsx；到访 lastSeen 离页落。
 * @module stardeck/client-standalone
 */
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ensureWarStyles } from './client/styles.ts'
import { warView, type ClientServicesFace } from './client/views.tsx'
import { fleetGate, type FleetState } from './client/fleet-gate.tsx'
import { BridgePane } from './client/bridge.tsx'
import { useWar, setBridgeProxyVerdict, warBoardStore } from './client/data.ts'
import { activeCopy, langId, setLang, setSkin, skinId, subscribeLang, subscribeSkin, type SkinId } from './client/copy.ts'

ensureWarStyles()

// 开机应用明暗偏好（设置抽屉「深色界面」落 warroom-standalone-theme）——
// 渲染前置属性，避免深色用户首帧白闪。插件形态无此逻辑（明暗随宿主）。
try {
  if (localStorage.getItem('warroom-standalone-theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', 'true')
} catch { /* storage unavailable */ }
// D29 critique：standalone 标记——固定 chrome 让位的 CSS 钩子（板/聊天头让出顶右胶囊簇宽度）。
document.body.setAttribute('data-stardeck-standalone', '1')

// 独立形态没有宿主会话面——sessions 缺席逐点降级；standaloneChrome=true
// 供给宿主才有的铬层控件（设置抽屉的明暗开关）。
const services: ClientServicesFace = { standaloneChrome: true }
const Board = warView(services)

/** 三态视图：聊天全屏（默认）⇄ 分屏旁观 ⇄ 看板全屏。localStorage 持久。 */
type ShellView = 'chat' | 'split' | 'board'
const VIEW_KEY = 'warroom-bridge-view'
function storedView(): ShellView | null {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'chat' || v === 'split' || v === 'board' ? v : null
  } catch { return null }
}

/** 聊天/分屏态的迷你设置弹层（皮肤/语言/明暗/定夺授权——看板全屏有自带设置抽屉）。
 * D27 授权钮：舰长显式授予/收回代理舰长代定夺（运行态不落盘，重启回落 OFF）。 */
function BridgeSettings(props: { onClose: () => void }): ReturnType<typeof createElement> {
  const s = activeCopy().settings
  const b = activeCopy().bridge
  useSyncExternalStore(subscribeSkin, skinId)
  useSyncExternalStore(subscribeLang, langId)
  const { data } = useWar()
  const [authBusy, setAuthBusy] = useState(false)
  const [authNote, setAuthNote] = useState<string | null>(null)
  const authorized = data?.bridge?.enabled === true && data.bridge.verdictAuthorized === true
  const proxyAway = data?.bridge?.enabled === true && data.bridge.proxy === false
  const flipAuth = (granted: boolean): void => {
    if (authBusy) return
    setAuthBusy(true)
    setAuthNote(null)
    void setBridgeProxyVerdict(granted).then(out => {
      setAuthBusy(false)
      warBoardStore.refresh()
      if (out.ok) setAuthNote(granted ? b.authOn : b.authOff)
      else setAuthNote(out.error ?? b.authOff)
    })
  }
  // critique6 P2：开关只改 body 属性不 setState——页面立暗、旋钮停旧态到下一轮
  // 轮询才自愈。DOM 仍是事实源，state 只做乐观重渲染引信。
  const [dark, setDark] = useState(() => document.body.getAttribute('data-ds-dark-theme') === 'true')
  const toggleDark = (): void => {
    const next = !dark
    try { localStorage.setItem('warroom-standalone-theme', next ? 'dark' : 'light') } catch { /* 隐私模式 */ }
    if (next) document.body.setAttribute('data-ds-dark-theme', 'true')
    else document.body.removeAttribute('data-ds-dark-theme')
    setDark(next)
  }
  const skinRow = (id: SkinId, label: string): ReturnType<typeof createElement> =>
    createElement('button', { key: id, className: `war-btn${skinId() === id ? ' primary' : ''}`, type: 'button', onClick: () => { setSkin(id) } }, label)
  // D29 critique P1：本弹层曾复用看板抽屉的 .war-settings-backdrop（无居中）
  // 且整树不在 .war-root 令牌作用域——弹层透明钉左上角，聊天文字从底下透出
  // （fleet-gate 同款已知坑的回归）。正名：war-modal-backdrop（居中+遮罩）
  // + war-root 令牌作用域 + Esc 关闭 + 关闭钮 autoFocus。
  // 字号滑杆与看板抽屉同源同存储（warroom-cfg-zoom）——默认脸面也调得了字号。
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [fontScale, setFontScale] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('warroom-cfg-zoom') ?? '1'); return Number.isFinite(v) ? v : 1 } catch { return 1 }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props])
  const applyFont = (v: number): void => {
    setFontScale(v)
    try { localStorage.setItem('warroom-cfg-zoom', String(v)) } catch { /* 隐私模式 */ }
    document.querySelectorAll<HTMLElement>('.war-root').forEach(el => { el.style.setProperty('--war-fs', String(v)) })
  }
  return createElement('div', { className: 'war-root war-modal-backdrop', onClick: props.onClose },
    createElement('div', { className: 'war-modal war-bridge-settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': s.title, onClick: e => { e.stopPropagation() } },
      createElement('div', { className: 'war-session-head' },
        createElement('div', { className: 'war-modal-title' }, s.title),
        createElement('button', { ref: closeRef, autoFocus: true, type: 'button', className: 'war-hq-picker-x', 'aria-label': s.close, onClick: props.onClose }, '✕'),
      ),
      createElement('div', { className: 'war-bridge-settings-body' },
        createElement('div', { className: 'war-settings-section' }, s.skinSection),
        createElement('div', { className: 'war-bridge-settings-row' },
          skinRow('war', s.skinWar), skinRow('plain', s.skinPlain), skinRow('trek', s.skinTrek)),
        createElement('div', { className: 'war-settings-section' }, s.langSection),
        createElement('div', { className: 'war-bridge-settings-row' },
          createElement('button', { className: `war-btn${langId() === 'zh' ? ' primary' : ''}`, type: 'button', onClick: () => { setLang('zh') } }, s.langZh),
          createElement('button', { className: `war-btn${langId() === 'en' ? ' primary' : ''}`, type: 'button', onClick: () => { setLang('en') } }, s.langEn)),
        createElement('div', { className: 'war-settings-section' }, s.themeSection),
        // D29 critique：态/动作混淆治理——深色改开关件（与看板抽屉同款 .war-switch，
        // role=switch+aria-checked），标签说功能、旋钮说状态。
        createElement('div', { className: 'war-set-toggle' },
          createElement('div', { className: 'war-set-toggle-text' },
            createElement('span', { className: 'war-set-toggle-label' }, s.themeDark)),
          createElement('button', { type: 'button', className: `war-switch${dark ? ' on' : ''}`, role: 'switch', 'aria-checked': dark, 'aria-label': s.themeDark, onClick: toggleDark },
            createElement('span', { className: 'war-switch-knob' }))),
        // D29 critique：字号与看板抽屉对齐（默认脸面此前调不了字号——双设置面不一致）。
        createElement('div', { className: 'war-settings-section' }, s.fontSection),
        createElement('div', { className: 'war-font-row' },
          createElement('input', { key: 'font-range', type: 'range', min: 0.85, max: 1.35, step: 0.05, value: fontScale, 'aria-label': s.fontSection,
            onInput: e => { applyFont(parseFloat((e.target as HTMLInputElement).value)) },
            onChange: e => { applyFont(parseFloat((e.target as HTMLInputElement).value)) } }),
          createElement('span', { key: 'font-val', className: 'war-font-val' }, `×${fontScale.toFixed(2)}`),
          createElement('button', { key: 'font-reset', type: 'button', className: 'war-btn', onClick: () => { applyFont(1) } }, s.fontReset)),
        // D27 定夺授权（proxy 在役才有意义；降级态藏钮不误导演长）。
        !proxyAway ? createElement('div', { className: 'war-settings-section', 'data-bridge-auth': '1' }, b.authSection) : null,
        // critique6/critique7：授权对钮不设 primary——实心钮落在任一侧都会被
        // 误读成「当前选中态」（第七轮 P1：实心 CTA 旁挂「未授权」状态句互相
        // 矛盾；第六轮反向同样误读）。等权描边对：禁用侧=当前态，状态句点名。
        !proxyAway ? createElement('div', { className: 'war-bridge-settings-row' },
          createElement('button', { className: 'war-btn', type: 'button', disabled: authBusy || authorized, 'data-bridge-auth-grant': '1', onClick: () => { flipAuth(true) } }, b.authGrant),
          createElement('button', { className: 'war-btn', type: 'button', disabled: authBusy || !authorized, 'data-bridge-auth-revoke': '1', onClick: () => { flipAuth(false) } }, b.authRevoke),
        ) : null,
        // D29 critique：disabled=当前态是推理题——当前态直接说出来。
        !proxyAway ? createElement('p', { className: 'war-bcard-hint', 'data-bridge-auth-state': '1', role: 'status' }, authorized ? b.authOn : b.authOff) : null,
        authNote !== null ? createElement('p', { className: 'war-bcard-hint', role: 'status' }, authNote) : null,
      ),
    ),
  )
}

function App(): ReturnType<typeof createElement> {
  const [fleet, setFleet] = useState<FleetState | undefined>(undefined)
  const [phase, setPhase] = useState<'entry' | 'board' | 'switch'>('entry')
  const [error, setError] = useState('')
  const [bindNote, setBindNote] = useState('')
  // UI 目检实抓的入场门伏击竞态：舰队探测（spawn 12 席 --version）常慢于
  // /board 首灌——旧逻辑里聊天先上屏、探测返回后 `fleet !== undefined` 才成立，
  // 入场门迟到弹回、把已在用聊天的舰长拽回选舰队。修=门只在探测 settled 后
  // 决定（fleetSettled）：要么先门后板，要么探测失败（daemon 不在）直接放行
  // ——门永不回头弹。
  const [fleetSettled, setFleetSettled] = useState(false)
  // critique P2-5：语言轴订阅——胶囊文案入双语层（head.fleetPill），切 EN 即换。
  useSyncExternalStore(subscribeLang, langId)
  useSyncExternalStore(subscribeSkin, skinId)
  // D26 三态：首帧 null（等 /board 带回 bridge 面再定默认）——旗 ON 默认聊天，
  // 旗 OFF 直落看板（老形态）；用户切过（localStorage 有值）永远尊重偏好。
  const { data } = useWar()
  const bridgeOn = data?.bridge?.enabled === true
  const [view, setView] = useState<ShellView | null>(storedView)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (view === null && data !== null) setView(bridgeOn ? 'chat' : 'board')
  }, [view, data, bridgeOn])
  const switchView = useCallback((v: ShellView): void => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* 隐私模式 */ }
  }, [])
  // D29 critique（Riley 红旗）：存了 chat 视图后 daemon 重启旗 OFF——chrome 不渲染
  // 但 body 仍出聊天面=锁死页无出口。桥关即强制回看板（0.2.x 老形态语义）。
  useEffect(() => {
    if (data !== null && !bridgeOn && view === 'chat') setView('board')
  }, [data, bridgeOn, view])
  // D29 critique（Alex 红旗）：Alt+1/2/3 切视图——键盘加速器（桥开才生效）。
  useEffect(() => {
    if (!bridgeOn) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey) return
      const map: Record<string, ShellView> = { '1': 'chat', '2': 'split', '3': 'board' }
      const target = map[e.key]
      if (target !== undefined) { e.preventDefault(); switchView(target) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [bridgeOn, switchView])
  const openBoard = useCallback((commandId?: string): void => {
    if (commandId !== undefined && commandId !== '') {
      try { location.hash = `#war-cmd-${commandId}` } catch { /* 隐私模式 */ }
    }
    switchView('split')
  }, [switchView])
  useEffect(() => {
    fetch('/warroom/api/fleet').then(r => r.json()).then((f: { ok?: boolean; active?: FleetState['active']; seats?: FleetState['seats'] }) => {
      if (f.ok === true && f.active !== undefined && f.seats !== undefined) setFleet({ active: f.active, seats: f.seats })
    }).catch(() => { /* daemon 不在——仍放行进甲板（读投影会显示离线态） */ })
      .finally(() => { setFleetSettled(true) })
  }, [])
  const enter = useCallback((executor: string, model: string) => {
    setError('')
    setBindNote('')
    fetch('/warroom/api/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ executor, model }) })
      .then(async r => {
        const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) as { ok?: boolean; error?: string; note?: string }
        if (out.ok !== true) setError(`舰队绑定失败：${out.error ?? `HTTP ${r.status}`}——可返回甲板继续用当前舰队，或重试。`)
        else if (typeof out.note === 'string' && out.note !== '') setBindNote(out.note) // 回执一句：常驻舰队胶囊 tooltip
      })
      .catch(() => { setError('舰队绑定失败：舰桥失联（daemon 不在？）——可返回甲板，或起服后重试。') })
      .finally(() => { setPhase('board') }
      )
  }, [])
  // 入场门确定性首幕：舰队探测未决 → loading 占位（不放壳——放了门就会在
  // 探测返回时回头弹，把已在用聊天的舰长拽回选舰队，UI 目检实抓）。探测
  // settled：有 fleet → 门；无 fleet（daemon 不在）→ 无门直入离线态。phase
  // 进 board 后门不再自动回弹（switch 重开=舰队胶囊显式点击）。
  if (phase === 'entry' && !fleetSettled) {
    return createElement('div', { style: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'sans-serif' } }, activeCopy().loading.connecting)
  }
  if ((phase === 'entry' || phase === 'switch') && fleet !== undefined) {
    return createElement(fleetGate, { fleet, onEnter: enter, dismissible: phase === 'switch', onDismiss: () => { setPhase('board') }, error })
  }
  const bc = activeCopy().bridge
  // 三态切换药丸 + 设置钮 + 舰队胶囊（舰桥模式全收进同一条顶右控制簇——浮动
  // 元素不落底部：聊天输入面/决策坞占底区，浮动胶囊压上面会在布局水合移位时
  // 吞掉交互点击，UI 目检实抓）。
  const fleetPillBtn = fleet !== undefined
    ? createElement('button', {
        className: 'war-btn', type: 'button', 'data-bridge-fleet': '1',
        title: bindNote !== '' ? `切换舰队（只影响后续征召）\n${bindNote}` : '切换舰队（只影响后续征召）',
        onClick: () => { setPhase('switch') },
      }, activeCopy().head.fleetPill(fleet.active.executor).replace(' ⇄', ''))
    : null
  const chrome = bridgeOn
    ? createElement('div', { className: 'war-root war-bridge-switch', 'data-bridge-switch': view ?? '' },
        settingsOpen ? createElement(BridgeSettings, { onClose: () => { setSettingsOpen(false) } }) : null,
        fleetPillBtn,
        createElement('button', { className: `war-btn${view === 'chat' ? ' primary' : ''}`, type: 'button', 'data-bridge-view': 'chat', onClick: () => { switchView('chat') } }, bc.viewChat),
        createElement('button', { className: `war-btn${view === 'split' ? ' primary' : ''}`, type: 'button', 'data-bridge-view': 'split', onClick: () => { switchView('split') } }, bc.viewSplit),
        createElement('button', { className: `war-btn${view === 'board' ? ' primary' : ''}`, type: 'button', 'data-bridge-view': 'board', onClick: () => { switchView('board') } }, bc.viewBoard),
        view !== 'board'
          ? createElement('button', { className: 'war-btn', type: 'button', 'data-bridge-settings': '1', title: bc.settings, onClick: () => { setSettingsOpen(true) } }, '⚙')
          : null,
      )
    : null
  // 旗 OFF 老形态：舰队胶囊保持原右下角浮动位（0.2.x 视觉零漂移）。
  const pill = !bridgeOn && fleet !== undefined
    ? createElement('button', {
        className: 'war-root',
        onClick: () => { setPhase('switch') },
        title: bindNote !== '' ? `切换舰队（只影响后续征召）\n${bindNote}` : '切换舰队（只影响后续征召）',
        style: {
          position: 'fixed', right: 14, bottom: 14, top: 'auto', left: 'auto', height: 'fit-content', width: 'fit-content',
          zIndex: 40,
          padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
          background: 'var(--war-card-bg)', border: '1px solid var(--war-border)', boxShadow: 'var(--war-shadow-1)',
          color: 'var(--war-text-2)', fontFamily: 'var(--war-font-code)', fontSize: 13,
        },
      }, activeCopy().head.fleetPill(fleet.active.executor))
    : null
  // 未定默认视图（首帧 /board 未回）：极简连接中。
  if (view === null) {
    return createElement('div', { style: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontFamily: 'sans-serif' } }, activeCopy().loading.connecting)
  }
  // 三态布局：聊天=聊天面全屏；分屏=聊天 38% + 看板 62%（SSE 驱动旁观）；
  // 看板=原 warView 整页（老形态原样）。
  const body = view === 'chat'
    ? // D29 批五：让位补偿只陪聊天全屏态（分屏 38% 列被 280px 压成竖排单字——P0 回归即修）。
      createElement('div', { className: 'war-standalone-chat', style: { flex: 1, display: 'flex', minHeight: 0 } }, createElement(BridgePane, { onOpenBoard: openBoard }))
    : view === 'split'
      ? createElement('div', { style: { flex: 1, display: 'flex', minHeight: 0, flexDirection: 'row' } },
          createElement('div', { className: 'war-standalone-split-chat', style: { flexBasis: '38%', flexShrink: 0, minWidth: 320, display: 'flex', minHeight: 0, borderRight: '1px solid var(--war-border, #ddd)' } }, createElement(BridgePane, { onOpenBoard: openBoard })),
          // D29 critique：固定 chrome（顶右胶囊簇）压内容治理——板列让出其宽度。
          createElement('div', { className: 'war-standalone-split-board', style: { flex: 1, display: 'flex', minHeight: 0, overflow: 'auto' } }, createElement(Board)),
        )
      : createElement('div', { className: 'war-standalone-board', style: { flex: 1, display: 'flex', minHeight: 0, overflow: 'auto' } }, createElement(Board))
  // 满高挂载：宿主 shell 给 .war-root 一满高容器（height:100% 才有锚），
  // 独立形态在此自供——否则板塌到内容高，星域/三列被压扁。
  return createElement('div', { style: { height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0 } }, body, chrome, pill)
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
