/**
 * 舰队选择门（独立入口专属面，2026-09-01 从 client-standalone 拆出）：
 * 全屏门 + 三席卡（三分状态语义）+ 模型输入 + 开始调度。
 * 根元素挂 .war-root——门渲染在 warView 的 .war-root 之外，自定义属性
 * 不跨兄弟继承，必须自带令牌作用域（P0-2 裸奔修复）。
 * seatStatusOf 是纯函数供 tests/fleet.test.ts 锁三分语义。
 * @module stardeck/client/fleet-gate
 */
import { Fragment, createElement, useState, useSyncExternalStore } from 'react'
import { langId, subscribeLang } from './copy.ts'
import { agentInstallPrompt } from '../agent-prompt.ts'

export interface Seat { id: string; label: string; ok: boolean; bin: string; experimental?: boolean; note: string; noteEn?: string; adapter?: boolean; staffReady?: boolean }
export interface FleetState { active: { executor: string; model: string }; seats: Seat[]; proxyLoop?: boolean }

/** 席位三分语义（纯）：可绑定（大副+外勤双接通且实证在役）/ 受限·实验性（契约
 * 在档但本机有已知阻碍）/ 未检出。V19.13 双席正典：**staffReady=false=不可选**
 * （舰长令 2026-09-06：大副接不通的舰队不算稳定舰队）——与 adapter=false 同落
 * absent 档，说明文案由 note 承载。 */
export type SeatStatus = 'ready' | 'limited' | 'absent'

export function seatStatusOf(seat: { ok: boolean; experimental?: boolean; adapter?: boolean; staffReady?: boolean }): SeatStatus {
  if (seat.adapter === false) return 'absent'
  if (seat.staffReady === false) return 'absent'
  if (!seat.ok) return 'absent'
  return seat.experimental === true ? 'limited' : 'ready'
}

/** 分级排序权重（critique 复检 P1：可绑定前置，缺席席不稀释第一屏）。 */
const STATUS_ORDER: Record<SeatStatus, number> = { ready: 0, limited: 1, absent: 2 }

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
  /** critique 复检 P1：缺席席折叠行（+N 即将支持——未检出不再占半屏）。 */
  absentFold: (n: number) => string
  /** D29 critique：席位注解技术细节折叠标签（第一屏只说人话）。 */
  techDetails: string
  /** D30 开箱面：全席缺席死路治理——安装引导 + 重新探测 + 内置 loop 指引。 */
  installTitle: string
  installVia: (pkg: string) => string
  reprobe: string
  copied: string
  copyFail: string
  loopReady: string
  loopHint: string
  /** D35 形态 A：agent 接入卡（复制一条提示词，让 agent 自己装+连）。 */
  agentCardTitle: string
  agentCardHint: string
  agentCardBtn: string
}

/** 可安装席的正典 npm 包名（2026-10 本机 npm ls 实锚；zcode/dsh 走各自渠道无 npm 包）。 */
const INSTALL_PKGS: Record<string, string> = {
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent',
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli',
  qwen: '@qwen-code/qwen-code',
}

const GATE: Record<'zh' | 'en', GateCopy> = {
  zh: {
    statusLabel: { ready: '可绑定', limited: '受限 · 实验性', absent: '未检出' },
    probePrefix: '（探测：',
    brand: 'STARDECK · 星舰甲板',
    title: '选择舰队',
    lead: 'stardeck：你下一句大白话命令，AI 大副把它变成任务书，AI 外勤在隔离工作区执行并交证据，你只管验收。',
    sub: '选定本次出勤的舰队——之后新任务都交它执行（在役任务不受影响，右下胶囊可随时换）。',
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
    absentFold: n => `+${n} 即将支持`,
    techDetails: '技术细节',
    installTitle: '本机没有检出任何舰队——挑一个装上（复制命令到终端跑），装好点「重新探测」：',
    installVia: pkg => `npm i -g ${pkg}`,
    reprobe: '装好了，重新探测',
    copied: '已复制',
    copyFail: '复制失败——请手动选中命令复制',
    loopReady: '内置代理舰长已就绪（Z_AI_* 环境变量已配）——聊天窗由内置 loop 担任，打字机流式回话；舰队外勤仍需上方任一席。',
    loopHint: '一个 CLI 都不想装也可以先聊：进板后在 设置→对话模型 里配好（或设环境变量 Z_AI_BASE_URL / Z_AI_API_KEY），聊天窗的代理舰长由内置 loop 担任（流式回话）。',
    agentCardTitle: '把控制权交给你的 agent（形态 A · 纯面板）',
    agentCardHint: '不装 CLI 也能用：把下面这段话粘给你的 agent（zcode/Claude Code/opencode 等），它会自己安装 stardeck、接入代理舰长席并打开看板——之后你在 agent 对话里自然语言操控舰队。',
    agentCardBtn: '复制接入提示词',
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
    absentFold: n => `+${n} coming soon`,
    techDetails: 'Technical details',
    installTitle: 'No fleet CLI detected — install one (copy the command into a terminal), then re-scan:',
    installVia: pkg => `npm i -g ${pkg}`,
    reprobe: 'Installed — re-scan',
    copied: 'Copied',
    copyFail: 'Copy failed — please select and copy the command manually',
    loopReady: 'Built-in proxy captain is ready (Z_AI_* env configured) — the chat window runs on the built-in loop with streaming replies; field missions still need a seat above.',
    loopHint: 'No CLI at all? You can still chat: configure it under Settings → Chat model after entering the board (or set Z_AI_BASE_URL / Z_AI_API_KEY env vars) — the chat captain runs on the built-in loop with streaming.',
    agentCardTitle: 'Hand control to your own agent (Form A · pure panel)',
    agentCardHint: 'No CLI needed: paste the prompt below into your agent (zcode / Claude Code / opencode …). It will install stardeck, take the acting-captain seat and open the board — you then steer the fleet in plain language inside your agent chat.',
    agentCardBtn: 'Copy install prompt',
  },
}

export function fleetGate(props: {
  fleet: FleetState
  onEnter: (executor: string, model: string) => void
  dismissible: boolean
  onDismiss?: () => void
  /** 绑定失败提示（POST /fleet 失败不再静默放行——R3 次要项）。 */
  error?: string
  /** D30 开箱面：全席缺席时引导卡上的「重新探测」（App 重拉 GET /fleet）。 */
  onReprobe?: () => void
}): ReturnType<typeof createElement> {
  useSyncExternalStore(subscribeLang, langId)
  const t = GATE[langId()]
  const noteOf = (seat: Seat): string => (langId() === 'en' && seat.noteEn !== undefined ? seat.noteEn : seat.note)
  // critique 复检 P1：分级排序（可绑定→受限→未检出，组内保序）+ 缺缺席折叠
  // ——第一屏只议事可绑定的席位，未检出不再稀释半屏。
  const sorted = [...props.fleet.seats].sort((a, b) => STATUS_ORDER[seatStatusOf(a)] - STATUS_ORDER[seatStatusOf(b)])
  const absentSeats = sorted.filter(s => seatStatusOf(s) === 'absent')
  const visibleSeats = sorted.filter(s => seatStatusOf(s) !== 'absent')
  const selected = props.fleet.seats.find(s => s.id === props.fleet.active.executor) ?? props.fleet.seats[0]
  const [pick, setPick] = useState(selected !== undefined ? selected.id : 'opencode')
  const picked = props.fleet.seats.find(s => s.id === pick) ?? selected
  const [model, setModel] = useState(props.fleet.active.model)
  const [showAbsent, setShowAbsent] = useState(false)
  // D30 开箱面：全席缺席死路治理——复制反馈态（哪个包名的命令刚被复制）。
  const [copiedId, setCopiedId] = useState('')
  const copyInstall = (id: string): void => {
    const pkg = INSTALL_PKGS[id]
    if (pkg === undefined) return
    const cmd = t.installVia(pkg)
    const done = (): void => { setCopiedId(id); setTimeout(() => { setCopiedId(c => (c === id ? '' : c)) }, 2000) }
    try {
      void navigator.clipboard?.writeText(cmd).then(done).catch(() => console.warn(t.copyFail))
    } catch { console.warn(t.copyFail) }
  }
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
        createElement('strong', { style: { color: 'var(--war-text-1)', fontFamily: 'var(--war-font-code)', fontSize: 'calc(15px*var(--war-fs))' } }, seat.label),
        createElement('span', {
          style: {
            fontSize: 'calc(11px*var(--war-fs))', borderRadius: 6, padding: '1px 8px',
            color: status === 'ready' ? 'var(--war-done)' : status === 'limited' ? 'var(--war-wait)' : 'var(--war-text-3)',
            border: `1px solid ${status === 'ready' ? 'var(--war-done-border)' : status === 'limited' ? 'var(--war-wait-border)' : 'var(--war-border-soft)'}`,
          },
        }, t.statusLabel[status]),
      ),
      // D29 critique：注解两层制——第一句人话常驻，其余收进「技术细节」折叠
      //（「垫片/上游 exec 路径」是 release note 语言，不该在第一屏筛选用户）。
      createElement('div', { style: { marginTop: 6, fontSize: 'calc(13px*var(--war-fs))', color: 'var(--war-text-2)', lineHeight: 1.5 } },
        (() => {
          const full = `${noteOf(seat)}${status === 'absent' && seat.adapter !== false ? `${t.probePrefix}${seat.bin}）` : ''}`
          const cut = full.search(/[。；]/)
          if (cut < 0 || cut >= full.length - 1) return full
          return createElement(Fragment, null,
            full.slice(0, cut + 1),
            createElement('details', { style: { marginTop: 2 } },
              createElement('summary', { style: { cursor: 'pointer', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-3)' } }, t.techDetails),
              createElement('span', null, full.slice(cut + 1).trim())),
          )
        })()),
      // 模型输入跟随所选席位——选中即在卡内展开（2026-09-03 定案：输入控件
      // 贴着选择走，不再独立成行；zcode 给锁死说明不给输入）。
      isPick && status !== 'absent'
        ? createElement('div', { style: { marginTop: 10 }, onClick: e => { e.stopPropagation() } },
            seat.id === 'zcode'
              ? createElement('div', { style: { fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-3)', lineHeight: 1.6 } }, t.modelLockedNote)
              : createElement('div', null,
                  createElement('label', { style: { display: 'block', marginBottom: 4, fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-3)' } }, t.modelLabel),
                  createElement('input', {
                    value: model,
                    onChange: (e: { target: { value: string } }) => { setModel(e.target.value) },
                    // D29 critique：占位符不当说明书（长句被裁成「provider/mc…」且
                    // 聚焦即失）——恒用一句短话，provider/model 语义看席位注解的
                    // 「技术细节」折叠。
                    placeholder: t.modelDefault,
                    style: {
                      width: 'calc(100% - 20px)', padding: '8px 10px', borderRadius: 8,
                      background: 'var(--war-card-bg)', border: '1px solid var(--war-border-soft)',
                      color: 'var(--war-text-1)', fontFamily: 'var(--war-font-code)', fontSize: 'calc(13px*var(--war-fs))',
                    },
                  }),
                ),
          )
        : null,
    )
  }
  return createElement('div', {
    className: 'war-root', // 令牌作用域：门在 warView 的 .war-root 之外，必须自带
    // critique 复检 P1：门底铺星图纸面（既有 --war-chart-bg 令牌，零新资产）——
    // 第一屏从此有星舰语言，不再是悬浮在灰幕上的通用 SaaS 弹窗。
    style: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--war-chart-bg, rgba(15,23,42,.34))', fontFamily: 'var(--war-font)' },
  },
    createElement('div', {
      style: {
        width: 'min(560px, 92vw)', maxHeight: '92vh', padding: 24, borderRadius: 14,
        background: 'var(--war-pop-bg)', border: '1px solid var(--war-border)', boxShadow: 'var(--war-shadow-2)',
        display: 'flex', flexDirection: 'column',
      },
    },
      createElement('div', { style: { fontSize: 'calc(13px*var(--war-fs))', letterSpacing: 1, color: 'var(--war-text-3)' } }, t.brand),
      createElement('h1', { style: { margin: '6px 0 4px', color: 'var(--war-text-1)', fontSize: 'calc(22px*var(--war-fs))' } }, t.title),
      createElement('p', { style: { margin: '0 0 6px', color: 'var(--war-text-2)', fontSize: 'calc(13px*var(--war-fs))' } }, t.lead),
      // critique 复检 P1（B 实证 3.7:1）：副标题从 text-3 升 text-2——第一屏
      // 说明文字不再贴着对比度下限。
      createElement('p', { style: { margin: '0 0 14px', color: 'var(--war-text-2)', fontSize: 'calc(13px*var(--war-fs))' } }, t.sub),
      // 席位清单独立滚动容器（2026-09-03 定案：十一席不撑爆门面；底部操作钮
      // 在容器外常驻，不随席列滚动）。
      createElement('div', { className: 'war-gate-scroll', style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'grid', gap: 8, alignContent: 'start', paddingBottom: 4 } },
        visibleSeats.map(card),
        // D30 开箱面：全席缺席不再是哑谜死路——安装引导卡（正典包名一键复制）
        // + 重新探测；内置 loop 指引（env 已开=就绪卡，未开=零 CLI 指路）。
        visibleSeats.length === 0
          ? createElement('div', {
              key: 'install-guide', 'data-war-install-guide': '1',
              style: { padding: '12px 14px', borderRadius: 'var(--war-r-md, 10px)', background: 'var(--war-well-bg)', border: '1px solid var(--war-border-soft)' },
            },
              createElement('div', { style: { fontSize: 'calc(13px*var(--war-fs))', color: 'var(--war-text-2)', lineHeight: 1.6 } }, t.installTitle),
              ...absentSeats.filter(s => INSTALL_PKGS[s.id] !== undefined).map(seat =>
                createElement('div', { key: `ins-${seat.id}`, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
                  createElement('code', {
                    style: { flex: '1 1 auto', fontFamily: 'var(--war-font-code)', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-1)', background: 'var(--war-card-bg)', border: '1px solid var(--war-border-soft)', borderRadius: 6, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, t.installVia(INSTALL_PKGS[seat.id]!)),
                  createElement('button', {
                    type: 'button',
                    onClick: () => { copyInstall(seat.id) },
                    style: { flex: '0 0 auto', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--war-border)', background: 'transparent', color: copiedId === seat.id ? 'var(--war-done)' : 'var(--war-text-2)', cursor: 'pointer', fontSize: 'calc(12px*var(--war-fs))' },
                  }, copiedId === seat.id ? t.copied : seat.label),
                )),
              createElement('button', {
                type: 'button', 'data-war-reprobe': '1',
                onClick: () => { props.onReprobe?.() },
                style: { marginTop: 10, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--war-border-hover)', background: 'var(--war-card-bg)', color: 'var(--war-text-1)', cursor: 'pointer', fontSize: 'calc(13px*var(--war-fs))' },
              }, t.reprobe),
              props.fleet.proxyLoop === true
                ? createElement('div', { style: { marginTop: 10, fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-done)', lineHeight: 1.6 } }, t.loopReady)
                : createElement('div', { style: { marginTop: 10, fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-3)', lineHeight: 1.6 } }, t.loopHint),
            )
          : null,
        absentSeats.length > 0
          ? createElement('button', {
              key: 'absent-fold', type: 'button',
              onClick: () => { setShowAbsent(!showAbsent) },
              'aria-expanded': showAbsent,
              style: {
                textAlign: 'left', cursor: 'pointer', padding: '8px 12px', borderRadius: 'var(--war-r-md, 10px)',
                background: 'transparent', border: '1px dashed var(--war-border-soft)',
                color: 'var(--war-text-3)', fontSize: 'calc(12px*var(--war-fs))',
              },
            }, `${showAbsent ? '▾ ' : '▸ '}${t.absentFold(absentSeats.length)}`)
          : null,
        showAbsent ? absentSeats.map(card) : null),
      // D35 形态 A：agent 接入卡（恒在场——与绑定哪支舰队无关）。复制一条提示词，
      // 用户的 agent 自己装 stardeck+接入代理舰长席+开板。
      createElement('div', {
        key: 'agent-card', 'data-war-agent-card': '1',
        style: { flex: '0 0 auto', marginTop: 12, padding: '10px 14px', borderRadius: 'var(--war-r-md, 10px)', background: 'var(--war-well-bg)', border: '1px solid var(--war-border-soft)', display: 'flex', alignItems: 'center', gap: 12 },
      },
        createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          createElement('div', { style: { fontSize: 'calc(13px*var(--war-fs))', color: 'var(--war-text-1)', fontWeight: 600 } }, t.agentCardTitle),
          createElement('div', { style: { marginTop: 2, fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-2)', lineHeight: 1.5 } }, t.agentCardHint)),
        createElement('button', {
          type: 'button', 'data-war-agent-prompt-copy': '1',
          onClick: () => {
            const p = navigator.clipboard?.writeText(agentInstallPrompt(langId() === 'en' ? 'en' : 'zh'))
            if (p === undefined) return
            void p.then(() => { setCopiedId('agent-prompt'); setTimeout(() => { setCopiedId('') }, 1600) }, () => { /* 剪贴板被拒 */ })
          },
          style: { flex: '0 0 auto', padding: '7px 14px', borderRadius: 8, border: '1px solid var(--war-border-hover)', background: 'var(--war-card-bg)', color: copiedId === 'agent-prompt' ? 'var(--war-done)' : 'var(--war-text-1)', cursor: 'pointer', fontSize: 'calc(12px*var(--war-fs))', whiteSpace: 'nowrap' },
        }, copiedId === 'agent-prompt' ? t.copied : t.agentCardBtn)),
      props.error !== undefined && props.error !== ''
        ? createElement('div', { role: 'alert', style: { marginTop: 10, fontSize: 'calc(13px*var(--war-fs))', color: 'var(--war-fail)', background: 'var(--war-fail-tint)', border: '1px solid var(--war-fail-border)', borderRadius: 8, padding: '8px 10px', flex: '0 0 auto' } }, props.error)
        : null,
      createElement('div', { className: 'war-gate-actions', style: { display: 'flex', gap: 8, marginTop: 18, flex: '0 0 auto' } },
        props.dismissible
          ? createElement('button', { onClick: props.onDismiss, style: { padding: '9px 14px', borderRadius: 8, border: '1px solid var(--war-border)', background: 'transparent', color: 'var(--war-text-2)', cursor: 'pointer', fontSize: 'calc(13px*var(--war-fs))' } }, t.back)
          : null,
        createElement('button', {
          disabled: picked !== undefined && seatStatusOf(picked) === 'absent',
          title: picked !== undefined && seatStatusOf(picked) === 'absent' ? t.absentTitle : '',
          onClick: () => { props.onEnter(pick, model) },
          style: {
            marginLeft: 'auto', padding: '9px 22px', borderRadius: 8,
            cursor: picked !== undefined && seatStatusOf(picked) === 'absent' ? 'not-allowed' : 'pointer',
            background: 'var(--war-action-bg)', color: 'var(--war-action-fg)',
            border: '1px solid var(--war-border-hover)', fontWeight: 600, fontSize: 'calc(13px*var(--war-fs))',
          },
        }, t.enter),
      ),
    ))
}
