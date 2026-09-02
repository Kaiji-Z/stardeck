/**
 * stardeck 独立板 UI 入口——**舰队选择门 + warView 整页挂载**。
 * 产品形态（2026-09-01 舰长定）：每次打开先选绑定哪个 coding CLI（opencode/
 * pi/codex 三席卡，探测可用性），选好「开始调度」进甲板；板内右下角胶囊可随时
 * 重开绑定门（daemon 侧只影响后续征召，在役执行者不动）。
 * 门体在 client/fleet-gate.tsx（自带 .war-root 令牌作用域）；绑定 POST 失败
 * 在门上显示提示（不静默放行）。宿主服务面全可选；到访 lastSeen 离页落。
 * @module stardeck/client-standalone
 */
import { createElement, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ensureWarStyles } from './client/styles.ts'
import { warView, type ClientServicesFace } from './client/views.tsx'
import { fleetGate, type FleetState } from './client/fleet-gate.tsx'

ensureWarStyles()

// 开机应用明暗偏好（设置抽屉「深色界面」落 warroom-standalone-theme）——
// 渲染前置属性，避免深色用户首帧白闪。插件形态无此逻辑（明暗随宿主）。
try {
  if (localStorage.getItem('warroom-standalone-theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', 'true')
} catch { /* storage unavailable */ }

// 独立形态没有宿主会话面——sessions 缺席逐点降级；standaloneChrome=true
// 供给宿主才有的铬层控件（设置抽屉的明暗开关）。
const services: ClientServicesFace = { standaloneChrome: true }
const Board = warView(services)

function App(): ReturnType<typeof createElement> {
  const [fleet, setFleet] = useState<FleetState | undefined>(undefined)
  const [phase, setPhase] = useState<'entry' | 'board' | 'switch'>('entry')
  const [error, setError] = useState('')
  const [bindNote, setBindNote] = useState('')
  useEffect(() => {
    fetch('/warroom/api/fleet').then(r => r.json()).then((f: { ok?: boolean; active?: FleetState['active']; seats?: FleetState['seats'] }) => {
      if (f.ok === true && f.active !== undefined && f.seats !== undefined) setFleet({ active: f.active, seats: f.seats })
    }).catch(() => { /* daemon 不在——仍放行进甲板（读投影会显示离线态） */ })
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
  if ((phase === 'entry' || phase === 'switch') && fleet !== undefined) {
    return createElement(fleetGate, { fleet, onEnter: enter, dismissible: phase === 'switch', onDismiss: () => { setPhase('board') }, error })
  }
  // 胶囊同样在 warView 的 .war-root 之外——自带令牌作用域。
  const pill = fleet !== undefined
    ? createElement('button', {
      className: 'war-root',
      onClick: () => { setPhase('switch') },
      title: bindNote !== '' ? `切换舰队（只影响后续征召）\n${bindNote}` : '切换舰队（只影响后续征召）',
      style: {
        position: 'fixed', right: 14, bottom: 14, top: 'auto', height: 'fit-content', width: 'fit-content',
        zIndex: 40,
        padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
        background: 'var(--war-card-bg)', border: '1px solid var(--war-border)', boxShadow: 'var(--war-shadow-1)',
        color: 'var(--war-text-2)', fontFamily: 'var(--war-font-code)', fontSize: 13,
      },
    }, `舰队 · ${fleet.active.executor} ⇄`)
    : null
  // 满高挂载：宿主 shell 给 .war-root 一满高容器（height:100% 才有锚），
  // 独立形态在此自供——否则板塌到内容高，星域/三列被压扁。
  return createElement('div', { style: { height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0 } }, createElement(Board), pill)
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
