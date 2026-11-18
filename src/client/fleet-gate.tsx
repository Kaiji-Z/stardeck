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

export interface Seat { id: string; label: string; ok: boolean; bin: string; version?: string; experimental?: boolean; note: string; noteEn?: string; adapter?: boolean; staffReady?: boolean }
export interface FleetState { active: { executor: string; model: string }; seats: Seat[]; proxyLoop?: boolean; fleetInject?: boolean; loopKeySource?: 'none' | 'config' | 'env' }

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
  /** 2026-11-17 安装/更新入口：缺席席=安装命令、已装席=更新命令+版本 chip，
   *  官方仓库链接恒在场（用户据此知道「要装这些 CLI 才能用」）。 */
  updateVia: (pkg: string) => string
  updateBtn: string
  /** 批判 P2：复制钮自称做什么（裸席位名读作导航/SR 读无名钮）+ 命令级 aria。 */
  copyBtn: string
  copyAria: (cmd: string) => string
  versionPrefix: string
  repoLink: string
  /** 零舰队逃生口：无任何可绑席时门可跳过（先上甲板聊天/看板，稍后再装）。 */
  skipInstall: string
  /** 共享凭证提示行（key 在位时门脚交代注入状态）。 */
  credReady: string
  credOff: string
}

/** 席位安装/更新入口正典（2026-11-17 建，2026-11-18 dsh 开源更新；包名=npm
 *  元数据实锚，仓库=npm repository/官方源实锚）：opencode 仓已迁 anomalyco
 *  （sst/ 旧链重定向）、pi 已改名 earendil-works（README 旧链 badlogic/pi-mono
 *  过时）；zcode 开源仓 zai-org/ZCode 无 npm 包（走桌面版/源码构建）；dsh 已
 *  开源——@deepseek-ai/dsh（bin=lib/bin.js）+ deepseek-ai/deepseek-harness。 */
const SEAT_LINKS: Record<string, { pkg?: string; repo?: string }> = {
  opencode: { pkg: 'opencode-ai', repo: 'https://github.com/anomalyco/opencode' },
  pi: { pkg: '@earendil-works/pi-coding-agent', repo: 'https://github.com/earendil-works/pi' },
  codex: { pkg: '@openai/codex', repo: 'https://github.com/openai/codex' },
  zcode: { repo: 'https://github.com/zai-org/ZCode' },
  claude: { pkg: '@anthropic-ai/claude-code', repo: 'https://github.com/anthropics/claude-code' },
  gemini: { pkg: '@google/gemini-cli', repo: 'https://github.com/google-gemini/gemini-cli' },
  qwen: { pkg: '@qwen-code/qwen-code', repo: 'https://github.com/QwenLM/qwen-code' },
  dsh: { pkg: '@deepseek-ai/dsh', repo: 'https://github.com/deepseek-ai/deepseek-harness' },
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
    updateVia: pkg => `npm i -g ${pkg}@latest`,
    updateBtn: '更新',
    copyBtn: '复制',
    copyAria: cmd => `复制命令：${cmd}`,
    versionPrefix: '已装',
    repoLink: '仓库',
    skipInstall: '先上甲板，稍后再装',
    credReady: '已配共享凭证：pi / claude / dsh / opencode（标准 env 面）征召时自动取用；codex 走垫片侧 key、zcode 由其自身管理——可在 设置→对话模型 调整。',
    credOff: '已配对话模型 key，但未开启「注入舰队」——设置→对话模型 里可开启，让舰队 CLI 免各自配 key。',
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
    updateVia: pkg => `npm i -g ${pkg}@latest`,
    updateBtn: 'Update',
    copyBtn: 'Copy',
    copyAria: cmd => `Copy command: ${cmd}`,
    versionPrefix: 'installed',
    repoLink: 'repo',
    skipInstall: 'Board first, install later',
    credReady: 'Shared credential configured: pi / claude / dsh / opencode (standard env vars) pick it up automatically on conscription; codex takes its key on the shim side and zcode manages its own — adjust under Settings → Chat model.',
    credOff: 'Chat-model key is set but "Inject into fleet CLIs" is off — enable it under Settings → Chat model so fleet CLIs share this key without per-CLI setup.',
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
  // 2026-11-17：命令显式传入（install/update 同一通路；席位卡与引导卡共用）。
  const [copiedId, setCopiedId] = useState('')
  const copyCmd = (id: string, cmd: string): void => {
    const done = (): void => { setCopiedId(id); setTimeout(() => { setCopiedId(c => (c === id ? '' : c)) }, 2000) }
    try {
      void navigator.clipboard?.writeText(cmd).then(done).catch(() => console.warn(t.copyFail))
    } catch { console.warn(t.copyFail) }
  }
  const copyInstall = (id: string): void => {
    const pkg = SEAT_LINKS[id]?.pkg
    if (pkg === undefined) return
    copyCmd(id, t.installVia(pkg))
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
      // 2026-11-17 安装/更新入口行：缺席席=安装命令复制；已装席=版本 chip+更新
      // 命令复制；官方仓库链接恒在场（zcode 无 npm 包只链接）。让「要装这些
      // CLI 才能用」在门上自解释。
      (() => {
        const link = SEAT_LINKS[seat.id] ?? {}
        const absent = status === 'absent'
        const cmd = link.pkg !== undefined ? (absent ? t.installVia(link.pkg) : t.updateVia(link.pkg)) : ''
        if (cmd === '' && link.repo === undefined) return null
        return createElement('div', { 'data-war-seat-ops': seat.id, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
          !absent && seat.version !== undefined && seat.version !== ''
            ? createElement('span', {
                'data-war-seat-version': seat.id,
                // 批判 P2：text-3 白α.50 叠选中卡底实测 4.4:1（11px 小字需 4.5:1）
                // ——升 text-2 并对齐折叠钮的 12px。
                style: { flex: '0 0 auto', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-2)', fontFamily: 'var(--war-font-code)', border: '1px solid var(--war-border-soft)', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40%' },
              }, `${t.versionPrefix} ${seat.version}`)
            : null,
          cmd !== ''
            ? createElement('code', {
                style: { flex: '1 1 auto', minWidth: 0, fontFamily: 'var(--war-font-code)', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-1)', background: 'var(--war-card-bg)', border: '1px solid var(--war-border-soft)', borderRadius: 6, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, cmd)
            : null,
          cmd !== ''
            ? createElement('button', {
                type: 'button', 'aria-label': t.copyAria(cmd),
                onClick: () => { copyCmd(seat.id, cmd) },
                style: { flex: '0 0 auto', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--war-border)', background: 'transparent', color: copiedId === seat.id ? 'var(--war-done)' : 'var(--war-text-2)', cursor: 'pointer', fontSize: 'calc(12px*var(--war-fs))' },
              }, copiedId === seat.id ? t.copied : absent ? t.copyBtn : t.updateBtn)
            : null,
          link.repo !== undefined
            ? createElement('a', {
                'data-war-seat-repo': seat.id, href: link.repo, target: '_blank', rel: 'noreferrer',
                style: { flex: '0 0 auto', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-2)', textDecoration: 'none', border: '1px solid var(--war-border-soft)', borderRadius: 6, padding: '4px 8px', whiteSpace: 'nowrap' },
              }, `${t.repoLink} ↗`)
            : null)
      })(),
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
      // 在容器外常驻，不随席列滚动）。2026-11-17 批判 P1：无 template 的 grid
      // 隐式 auto 列被 nowrap 命令的 max-content 撑爆——操作行溢出卡边全宽度
      // 复现（1440/375 双实证）；minmax(0,1fr) 让列可缩、code 的 ellipsis 接管。
      createElement('div', { className: 'war-gate-scroll', style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, alignContent: 'start', paddingBottom: 4 } },
        visibleSeats.map(card),
        // D30 开箱面：全席缺席不再是哑谜死路——安装引导卡（正典包名一键复制）
        // + 重新探测；内置 loop 指引（env 已开=就绪卡，未开=零 CLI 指路）。
        visibleSeats.length === 0
          ? createElement('div', {
              key: 'install-guide', 'data-war-install-guide': '1',
              style: { padding: '12px 14px', borderRadius: 'var(--war-r-md, 10px)', background: 'var(--war-well-bg)', border: '1px solid var(--war-border-soft)' },
            },
              createElement('div', { style: { fontSize: 'calc(13px*var(--war-fs))', color: 'var(--war-text-2)', lineHeight: 1.6 } }, t.installTitle),
              ...absentSeats.filter(s => SEAT_LINKS[s.id]?.pkg !== undefined).map(seat =>
                createElement('div', { key: `ins-${seat.id}`, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
                  createElement('code', {
                    style: { flex: '1 1 auto', minWidth: 0, fontFamily: 'var(--war-font-code)', fontSize: 'calc(12px*var(--war-fs))', color: 'var(--war-text-1)', background: 'var(--war-card-bg)', border: '1px solid var(--war-border-soft)', borderRadius: 6, padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, t.installVia(SEAT_LINKS[seat.id]!.pkg!)),
                  createElement('button', {
                    type: 'button', 'aria-label': t.copyAria(t.installVia(SEAT_LINKS[seat.id]!.pkg!)),
                    onClick: () => { copyInstall(seat.id) },
                    style: { flex: '0 0 auto', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--war-border)', background: 'transparent', color: copiedId === seat.id ? 'var(--war-done)' : 'var(--war-text-2)', cursor: 'pointer', fontSize: 'calc(12px*var(--war-fs))' },
                  }, copiedId === seat.id ? t.copied : t.copyBtn),
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
      // 2026-11-17 共享凭证提示行：key 在位才出现——注入开=覆盖面交代、关=指路开。
      props.fleet.loopKeySource !== undefined && props.fleet.loopKeySource !== 'none'
        ? createElement('div', {
            key: 'cred-line', 'data-war-cred-line': '1',
            style: { flex: '0 0 auto', marginTop: 10, fontSize: 'calc(12px*var(--war-fs))', color: props.fleet.fleetInject === false ? 'var(--war-text-3)' : 'var(--war-done)', lineHeight: 1.5 },
          }, props.fleet.fleetInject === false ? t.credOff : t.credReady)
        : null,
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
          ? createElement('button', {
              'data-war-gate-skip': '1', onClick: props.onDismiss,
              style: { padding: '9px 14px', borderRadius: 8, border: '1px solid var(--war-border)', background: 'transparent', color: 'var(--war-text-2)', cursor: 'pointer', fontSize: 'calc(13px*var(--war-fs))' },
            }, props.fleet.seats.some(s => seatStatusOf(s) === 'ready') ? t.back : t.skipInstall)
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
