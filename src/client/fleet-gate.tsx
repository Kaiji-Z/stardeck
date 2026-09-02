/**
 * 舰队选择门（独立入口专属面，2026-09-01 从 client-standalone 拆出）：
 * 全屏门 + 三席卡（三分状态语义）+ 模型输入 + 开始调度。
 * 根元素挂 .war-root——门渲染在 warView 的 .war-root 之外，自定义属性
 * 不跨兄弟继承，必须自带令牌作用域（P0-2 裸奔修复）。
 * seatStatusOf 是纯函数供 tests/fleet.test.ts 锁三分语义。
 * @module stardeck/client/fleet-gate
 */
import { createElement, useState, useSyncExternalStore } from 'react'
import { langId, subscribeLang } from './copy.ts'

export interface Seat { id: string; label: string; ok: boolean; bin: string; experimental?: boolean; note: string; noteEn?: string; adapter?: boolean }
export interface FleetState { active: { executor: string; model: string }; seats: Seat[] }

/** 席位三分语义（纯）：可绑定（实证在役）/ 受限·实验性（契约在档但本机有已知阻碍）/ 未检出。
 * 修复「codex 标可绑定实为本机起不了」的诚实证——不再裸标可绑定。
 * 契约席（adapter=false）：适配器未实装——比 absent 更进一步的「档案在档」，
 * 卡可看不可选（v1 不加第四档徽标，按不可绑处理）。 */
export type SeatStatus = 'ready' | 'limited' | 'absent'

export function seatStatusOf(seat: { ok: boolean; experimental?: boolean; adapter?: boolean }): SeatStatus {
  if (seat.adapter === false) return 'absent'
  if (!seat.ok) return 'absent'
  return seat.experimental === true ? 'limited' : 'ready'
}

/** i18n：门面文案双语（绑定门出现在词典皮肤之外，自带两套）。 */
interface GateCopy {
  statusLabel: Record<SeatStatus, string>
  probePrefix: string
  brand: string
  title: string
  lead: string
  sub: string
  modelLabel: string
  modelDefault: string
  modelPh: Record<string, string>
  modelLockedNote: string
  back: string
  enter: string
  absentTitle: string
}

const GATE: Record<'zh' | 'en', GateCopy> = {
  zh: {
    statusLabel: { ready: '可绑定', limited: '受限 · 实验性', absent: '未检出' },
    probePrefix: '（探测：',
    brand: 'STARDECK · 星舰甲板',
    title: '选择舰队',
    lead: 'stardeck：你下一句大白话命令，AI 大副把它变成任务书，AI 外勤在隔离工作区执行并交证据，你只管验收。',
    sub: '选定本次出勤的舰队——之后新任务都交它执行（在役任务不受影响，右下角可随时换）。',
    modelLabel: '模型（可选，按舰队语义）',
    modelDefault: '留空 = 沿用该舰队自身默认模型',
    modelPh: {
      opencode: '留空 = 沿用 opencode 自身默认模型（在其 UI/配置里设）；或 provider/model 全形',
      pi: '留空 = 沿用 pi 自身默认（~/.pi 配置里设）；或 zai/glm-5.2（provider/id，key 走环境变量）',
      codex: '留空 = 沿用 codex 自身默认；或裸模型 id（供应商另走启动配置 model_provider）',
      zcode: '模型由 zcode 自身管理——此处不收模型串',
      claude: '留空 = 沿用网关/订阅默认；或网关认识的模型 id（如 glm-5.2）',
      gemini: '留空 = 沿用 gemini 自身默认（其 config/鉴权里设）；或 -m 模型 id',
      qwen: '留空 = 沿用 qwen 自身默认；或 openai 兼容网关的模型 id',
    },
    modelLockedNote: 'zcode 的模型在它自己那里配：桌面版设置，或 ~/.zcode/cli/config.json 的 model.main。留空绑定即沿用其当前默认。',
    back: '返回甲板',
    enter: '开始调度',
    absentTitle: '该舰队本机未检出——先安装或检查入口路径',
  },
  en: {
    statusLabel: { ready: 'Bindable', limited: 'Limited · experimental', absent: 'Not found' },
    probePrefix: ' (probe: ',
    brand: 'STARDECK · Starship Deck',
    title: 'Choose a fleet',
    lead: 'stardeck: your next plain-language command becomes a task brief via the AI first mate; AI field agents execute in isolated workspaces and return with evidence — you just review.',
    sub: 'Pick the fleet on duty — new tasks go to it (in-flight tasks unaffected; switch anytime bottom-right).',
    modelLabel: 'Model (optional, per-fleet semantics)',
    modelDefault: 'Empty = the fleet\'s own default model',
    modelPh: {
      opencode: 'Empty = opencode\'s own default (set in its UI/config); or provider/model full form',
      pi: 'Empty = pi\'s own default (set in ~/.pi); or zai/glm-5.2 (provider/id, key via env var)',
      codex: 'Empty = codex\'s own default; or a bare model id (provider via startup model_provider)',
      zcode: 'Model managed by zcode itself — no model string here',
      claude: 'Empty = gateway/subscription default; or a model id the gateway knows (e.g. glm-5.2)',
      gemini: 'Empty = gemini\'s own default (set in its config/auth); or a -m model id',
      qwen: 'Empty = qwen\'s own default; or an openai-compatible gateway model id',
    },
    modelLockedNote: 'zcode\'s model lives on its side: desktop settings, or model.main in ~/.zcode/cli/config.json — stardeck does not manage it (the engine ignores argv model params, verified). Binding empty just inherits its current default.',
    back: 'Back to deck',
    enter: 'Start dispatching',
    absentTitle: 'Fleet not found on this machine — install it or check the entry path',
  },
}

export function fleetGate(props: {
  fleet: FleetState
  onEnter: (executor: string, model: string) => void
  dismissible: boolean
  onDismiss?: () => void
  /** 绑定失败提示（POST /fleet 失败不再静默放行——R3 次要项）。 */
  error?: string
}): ReturnType<typeof createElement> {
  useSyncExternalStore(subscribeLang, langId)
  const t = GATE[langId()]
  const noteOf = (seat: Seat): string => (langId() === 'en' && seat.noteEn !== undefined ? seat.noteEn : seat.note)
  const selected = props.fleet.seats.find(s => s.id === props.fleet.active.executor) ?? props.fleet.seats[0]
  const [pick, setPick] = useState(selected !== undefined ? selected.id : 'opencode')
  const picked = props.fleet.seats.find(s => s.id === pick) ?? selected
  const [model, setModel] = useState(props.fleet.active.model)
  const card = (seat: Seat): ReturnType<typeof createElement> => {
    const status = seatStatusOf(seat)
    const isPick = seat.id === pick
    return createElement('div', {
      key: seat.id,
      role: 'button', tabIndex: status === 'absent' ? -1 : 0, 'aria-pressed': isPick,
      onClick: () => { if (status !== 'absent') setPick(seat.id) },
      onKeyDown: e => { if ((e.key === 'Enter' || e.key === ' ') && status !== 'absent') { e.preventDefault(); setPick(seat.id) } },
      style: {
        textAlign: 'left', cursor: status === 'absent' ? 'not-allowed' : 'pointer',
        padding: '14px 16px', borderRadius: 'var(--war-r-md, 10px)',
        background: isPick ? 'var(--war-select-tint, var(--war-card-bg))' : 'var(--war-well-bg)',
        border: isPick ? '1px solid var(--war-border-hover)' : '1px solid var(--war-border-soft)',
        opacity: status === 'absent' ? 0.55 : 1,
      },
    },
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        createElement('strong', { style: { color: 'var(--war-text-1)', fontFamily: 'var(--war-font-code)', fontSize: 15 } }, seat.label),
        createElement('span', {
          style: {
            fontSize: 11, borderRadius: 6, padding: '1px 8px',
            color: status === 'ready' ? 'var(--war-done)' : status === 'limited' ? 'var(--war-wait)' : 'var(--war-text-3)',
            border: `1px solid ${status === 'ready' ? 'var(--war-done-border)' : status === 'limited' ? 'var(--war-wait-border)' : 'var(--war-border-soft)'}`,
          },
        }, t.statusLabel[status]),
      ),
      createElement('div', { style: { marginTop: 6, fontSize: 13, color: 'var(--war-text-2)', lineHeight: 1.5 } },
        `${noteOf(seat)}${status === 'absent' && seat.adapter !== false ? `${t.probePrefix}${seat.bin}）` : ''}`),
      // 模型输入跟随所选席位——选中即在卡内展开（2026-09-03 定案：输入控件
      // 贴着选择走，不再独立成行；zcode 给锁死说明不给输入）。
      isPick && status !== 'absent'
        ? createElement('div', { style: { marginTop: 10 }, onClick: e => { e.stopPropagation() } },
            seat.id === 'zcode'
              ? createElement('div', { style: { fontSize: 12, color: 'var(--war-text-3)', lineHeight: 1.6 } }, t.modelLockedNote)
              : createElement('div', null,
                  createElement('label', { style: { display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--war-text-3)' } }, t.modelLabel),
                  createElement('input', {
                    value: model,
                    onChange: (e: { target: { value: string } }) => { setModel(e.target.value) },
                    placeholder: t.modelPh[seat.id] ?? t.modelDefault,
                    style: {
                      width: 'calc(100% - 20px)', padding: '8px 10px', borderRadius: 8,
                      background: 'var(--war-card-bg)', border: '1px solid var(--war-border-soft)',
                      color: 'var(--war-text-1)', fontFamily: 'var(--war-font-code)', fontSize: 13,
                    },
                  }),
                ),
          )
        : null,
    )
  }
  return createElement('div', {
    className: 'war-root', // 令牌作用域：门在 warView 的 .war-root 之外，必须自带
    style: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--war-backdrop, rgba(15,23,42,.34))', fontFamily: 'var(--war-font)' },
  },
    createElement('div', {
      style: {
        width: 'min(560px, 92vw)', maxHeight: '92vh', padding: 24, borderRadius: 14,
        background: 'var(--war-pop-bg)', border: '1px solid var(--war-border)', boxShadow: 'var(--war-shadow-2)',
        display: 'flex', flexDirection: 'column',
      },
    },
      createElement('div', { style: { fontSize: 13, letterSpacing: 2, color: 'var(--war-text-3)' } }, t.brand),
      createElement('h1', { style: { margin: '6px 0 4px', color: 'var(--war-text-1)', fontSize: 22 } }, t.title),
      createElement('p', { style: { margin: '0 0 6px', color: 'var(--war-text-2)', fontSize: 13 } }, t.lead),
      createElement('p', { style: { margin: '0 0 14px', color: 'var(--war-text-3)', fontSize: 13 } }, t.sub),
      // 席位清单独立滚动容器（2026-09-03 定案：十一席不撑爆门面；底部操作钮
      // 在容器外常驻，不随席列滚动）。
      createElement('div', { className: 'war-gate-scroll', style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'grid', gap: 8, alignContent: 'start', paddingBottom: 4 } },
        props.fleet.seats.map(card)),
      props.error !== undefined && props.error !== ''
        ? createElement('div', { role: 'alert', style: { marginTop: 10, fontSize: 13, color: 'var(--war-fail)', background: 'var(--war-fail-tint)', border: '1px solid var(--war-fail-border)', borderRadius: 8, padding: '8px 10px', flex: '0 0 auto' } }, props.error)
        : null,
      createElement('div', { className: 'war-gate-actions', style: { display: 'flex', gap: 8, marginTop: 18, flex: '0 0 auto' } },
        props.dismissible
          ? createElement('button', { onClick: props.onDismiss, style: { padding: '9px 14px', borderRadius: 8, border: '1px solid var(--war-border)', background: 'transparent', color: 'var(--war-text-2)', cursor: 'pointer', fontSize: 13 } }, t.back)
          : null,
        createElement('button', {
          disabled: picked !== undefined && seatStatusOf(picked) === 'absent',
          title: picked !== undefined && seatStatusOf(picked) === 'absent' ? t.absentTitle : '',
          onClick: () => { props.onEnter(pick, model) },
          style: {
            marginLeft: 'auto', padding: '9px 22px', borderRadius: 8,
            cursor: picked !== undefined && seatStatusOf(picked) === 'absent' ? 'not-allowed' : 'pointer',
            background: 'var(--war-action-bg)', color: 'var(--war-action-fg)',
            border: '1px solid var(--war-border-hover)', fontWeight: 600, fontSize: 13,
          },
        }, t.enter),
      ),
    ))
}
