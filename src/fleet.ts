/**
 * stardeck 舰队面（UI 入口绑定，2026-09-01）：「每次打开绑一个 coding CLI」
 * 的产品形态落地——探测本机可绑的三席（opencode/pi/codex）、给出诚实可用性
 * 与实验性标记；daemon 持运行态 activeExecutor（POST /warroom/api/fleet 切换，
 * 只影响后续征召，在役进程不动）。
 * 探测纪律（不装）：绝对路径 existsSync 即真；裸名（unix PATH 形）退
 * `--version` 探针；codex 席在本机带「实验性」标记——Windows 工具桥缺陷
 * 已实证记录（README「执行者适配器」），不隐瞒也不拦人试。
 * @module stardeck/fleet
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { detectCodexBin, detectPiBin, detectOpencodeBin, detectZcodeBin, detectClaudeBin, detectGeminiBin, detectQwenBin, detectDshBin, ADAPTERS } from './executor.ts'

export interface FleetSeatInfo {
  id: string
  /** 展示名。 */
  label: string
  /** 本机可绑（二进制在场）。 */
  ok: boolean
  /** 探测到的入口路径（展示/排查用）。 */
  bin: string
  /** 实验性（可绑但已知风险）。 */
  experimental?: boolean
  /** 一句人话说明（绑定卡展示，中文）。 */
  note: string
  /** i18n：同一句的英译（绑定卡按界面语言挑；缺省回落中文）。 */
  noteEn?: string
  /** spawn 适配器已实装（可真派活）；false=契约席（档案在档、适配器未写，
   * 绑定门挡住——不装样子）。 */
  adapter: boolean
  /** V19.13 双席正典：大副+外勤双接通（可选的充分条件）。false=只能外勤
   * 或两者都未实弹——不可选（舰长令 2026-09-06：大副接不通的舰队不算稳定
   * 舰队）。契约席恒 false。 */
  staffReady: boolean
}

/** 席位正典清单——顺序即绑定门展示序。契约席（2026-09-02 收编轮，证据源=
 * vibe-kanban executors/ 适配器源码挖掘）：copilot=npx @github/copilot（ACP
 * 驱动，MCP ~/.copilot/mcp-config.json）；amp=npx @sourcegraph/amp（ACP，MCP
 * ~/.config/amp/settings.json）；cursor=cursor-agent -p --output-format=
 * stream-json（MCP ~/.cursor/mcp.json）；droid=droid exec --output-format
 * stream-json（MCP ~/.factory/mcp.json）。CCR（claude-code-router）仅在 VK
 * 名单无执行器——路线图注记。 */
const SEATS: ReadonlyArray<{ id: string; label: string; experimental?: boolean; note: string; noteEn: string; detect: (configured: string) => string; adapter?: boolean; staffReady?: boolean }> = [
  { id: 'opencode', label: 'opencode', note: '开源 coding agent，支持多家模型供应商。模型与登录走它自身配置，这里留空即可。', noteEn: 'Open-source coding agent with multi-provider model support. Model and auth come from its own config — leave the model field empty.', detect: detectOpencodeBin, adapter: true, staffReady: true },
  { id: 'pi', label: 'pi', note: '轻量 coding agent。模型形如 zai/glm-5.2（provider/id），API key 走对应环境变量。', noteEn: 'Lightweight coding agent. Model looks like zai/glm-5.2 (provider/id); API key via the matching env var.', detect: detectPiBin, adapter: true, staffReady: true },
  { id: 'codex', label: 'codex', note: 'OpenAI Codex CLI。GLM 经 Responses→chat 垫片直驱（stardeck codex-shim）；工具通道走 HTTP 直连（MCP 工具面待上游 exec 路径）。', noteEn: 'OpenAI Codex CLI. GLM drives it via the Responses→chat shim (stardeck codex-shim); tools go over direct HTTP (MCP tool surface pending upstream exec support).', detect: detectCodexBin, adapter: true, staffReady: true },
  { id: 'zcode', label: 'zcode', note: 'GLM 系 coding agent。登录与模型走 zcode 自身配置——模型不在这里填。', noteEn: 'GLM-family coding agent. Login and model live in zcode\'s own config — no model needed here.', detect: detectZcodeBin, adapter: true, staffReady: true },
  { id: 'claude', label: 'claude', note: 'Anthropic Claude Code。鉴权二选一：原生 /login 订阅，或环境变量 ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN 指向 anthropic 兼容网关。', noteEn: 'Anthropic Claude Code. Auth is either the native /login subscription, or ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN pointing at an anthropic-compatible gateway.', detect: detectClaudeBin, adapter: true, staffReady: true },
  { id: 'gemini', label: 'gemini', experimental: true, note: '暂不可绑：双席未接通（外勤契约在档未实弹——本机无 Google API key；大副通道未建）。配好 key 实弹转正后再开放。', noteEn: 'Not bindable yet: dual-role incomplete (executor contract on file but never live-fired — no Google API key here; staff channel not built). Opens up once a key is set and both roles pass live-fire.', detect: detectGeminiBin, adapter: true, staffReady: false },
  { id: 'qwen', label: 'qwen', experimental: true, note: '暂不可绑：双席未接通（外勤半证——网关模型选择兼容性有限；大副通道未建）。实弹转正后再开放。', noteEn: 'Not bindable yet: dual-role incomplete (executor half-proven — limited gateway model-selection compatibility; staff channel not built). Opens up after both roles pass live-fire.', detect: detectQwenBin, adapter: true, staffReady: false },
  { id: 'dsh', label: 'dsh', note: 'DeepSeek Harness（本仓血统宿主，独立形态里反过来当外勤）。走源码仓克隆入口：无头 headless 档 + stardeck 外挂模型层；网关用环境变量 DEEPSEEK_API_KEY/BASE_URL（缺席时自动映射 Z_AI_*），模型默认 glm-5.2。', noteEn: 'DeepSeek Harness (this project\'s lineage host, now flying as an away-team member). Runs from a source-tree clone: headless profile + a stardeck model overlay; gateway via DEEPSEEK_API_KEY/BASE_URL env (falls back to Z_AI_*), model defaults to glm-5.2.', detect: detectDshBin, adapter: true, staffReady: true },
  { id: 'copilot', label: 'copilot', note: '即将支持：GitHub Copilot CLI（需 Copilot 订阅）。', noteEn: 'Coming soon: GitHub Copilot CLI (requires a Copilot subscription).', detect: (c) => c !== '' ? c : 'copilot' },
  { id: 'amp', label: 'amp', note: '即将支持：Sourcegraph Amp。', noteEn: 'Coming soon: Sourcegraph Amp.', detect: (c) => c !== '' ? c : 'amp' },
  { id: 'cursor', label: 'cursor', note: '即将支持：Cursor CLI（需 Cursor 账号）。', noteEn: 'Coming soon: Cursor CLI (requires a Cursor account).', detect: (c) => c !== '' ? c : 'cursor-agent' },
  { id: 'droid', label: 'droid', note: '即将支持：Factory Droid（需 Factory 账号）。', noteEn: 'Coming soon: Factory Droid (requires a Factory account).', detect: (c) => c !== '' ? c : 'droid' },
]

/** 探针注入位（测试用；缺省真跑 --version）。 */
export type VersionProbe = (bin: string) => boolean

function defaultVersionProbe(bin: string): boolean {
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 15_000, windowsHide: true, shell: process.platform === 'win32' })
    return r.status === 0
  } catch {
    return false
  }
}

/**
 * 探测三席可绑性。executorBinOverride 是全局入口覆盖（config.executorBin，
 * 三席共用——它是「指到某个入口」的运维逃生阀，非按席配置）。
 */
export function probeFleet(executorBinOverride = '', probe: VersionProbe = defaultVersionProbe): FleetSeatInfo[] {
  return SEATS.map(seat => {
    const bin = seat.detect(executorBinOverride)
    const ok = isAbsolute(bin) || bin.includes('\\') || bin.includes('/') ? existsSync(bin) : probe(bin)
    return {
      id: seat.id, label: seat.label, ok, bin,
      ...(seat.experimental === true ? { experimental: true } : {}),
      note: seat.note, noteEn: seat.noteEn,
      adapter: seat.adapter === true || ADAPTERS[seat.id] !== undefined,
      staffReady: seat.staffReady === true,
    }
  })
}

/** 舰队 id 合法性（POST /fleet 校验用）。 */
export function fleetSeatIds(): string[] {
  return SEATS.map(s => s.id)
}

/** 可绑定席位（V19.13 双席正典的硬校验面：适配器已实装 **且** 大副+外勤双
 * 接通——POST /fleet 拒绝双席不全的席；契约席/半证席只登记可看不可选）。 */
export function bindableSeatIds(): string[] {
  return SEATS.filter(s => (s.adapter === true || ADAPTERS[s.id] !== undefined) && s.staffReady === true).map(s => s.id)
}

/** 绑定回执一句（纯，POST /fleet 响应的 note 字段——定案 2026-09-02「回执
 * 给一句」）：模型串按席别语义交代清楚——透传/留空沿用默认/zcode 由其自身
 * config 管理；首发征召若模型不可用，任务卡会如实报错（不静默）。 */
export function bindNoteFor(executor: string, model: string): string {
  if (executor === 'zcode') {
    return model !== ''
      ? 'zcode 的模型由其自身 config 管理（~/.zcode/cli/config.json 的 model.main），板面模型串不透传——请到 zcode 桌面版或其 config 修改；本绑定沿用其当前默认。'
      : '模型留空——沿用 zcode 自身 config 的默认模型（~/.zcode/cli/config.json 的 model.main，zcode 桌面版可改）。'
  }
  const semantics: Record<string, string> = {
    opencode: 'provider/model 全形（其自身配置里的 provider）',
    pi: 'provider/id 形（如 zai/glm-5.2，key 走环境变量）',
    codex: '裸模型 id（供应商另走启动配置 model_provider）',
    claude: '网关/订阅认识的模型 id',
    gemini: 'gemini 自身鉴权可用的模型 id（-m 透传）',
    qwen: 'openai 兼容网关的模型 id',
    dsh: '纯模型 id（默认 glm-5.2；经 DEEPSEEK_API_KEY/BASE_URL 网关，Z_AI_* 自动映射）',
  }
  const hint = semantics[executor] ?? '按该舰队 CLI 的模型语法'
  return model !== ''
    ? `模型串「${model}」已按 ${executor} 语义透传（${hint}）；串是否可用由该舰队自身配置/鉴权决定——首发征召若模型不可用，任务卡会如实报错。`
    : `模型留空——沿用 ${executor} 自身默认模型（在其自己的 UI/配置里设置；${hint}）。`
}

/** 绑定门展示序取席（缺省 opencode）。 */
export function seatLabelOf(id: string): string {
  return SEATS.find(s => s.id === id)?.label ?? 'opencode'
}
