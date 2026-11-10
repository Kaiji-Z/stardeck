/**
 * stardeck 配置（独立形态）：环境变量 STARDECK_* + 可选 JSON 配置文件
 * （~/.stardeck/config.json，可被 STARDECK_CONFIG 指到别处）。无宿主
 * 配置框架——一个纯加载器，启动即定（不热更）。
 * @module stardeck/config
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StardeckConfig {
  /** HTTP 监听端口（默认 3970——stardeck 常驻口）。 */
  port: number
  /** 状态目录（账本 JSONL/日志/units；默认 ~/.stardeck）。 */
  stateDir: string
  /** 任务工作区根（默认 <stateDir>/tasks）。 */
  warRoot: string
  /** 执行者适配器 id（v1：'opencode'）。 */
  executor: string
  /** 模型路由（executor 语义——opencode 是 provider/model 全形；空=执行者默认）。 */
  model: string
  /** 模型供应商直通（codex 语义：spawn 时 `-c model_provider=<it>`；空=codex 自身默认。pi 走 model 的 provider/id 形）。 */
  modelProvider: string
  /** codex 垫片基址（如 http://127.0.0.1:3975/v1）：非空=codex 模型面走 Responses→chat 垫片（V19.13）。 */
  codexShimBase: string
  /** 执行者二进制路径（默认按平台常见安装位探测）。 */
  executorBin: string
  /** 每任务重试上限（war_fail 语义）。 */
  maxAttempts: number
  /** 同时在役执行者上限（巡检征召的并发帽）。 */
  maxExecutors: number
  /** 深编制上限（v1 固定 0——单外勤模式）。 */
  maxUnits: number
  /** 特性旗补丁（war 旗体系的 extra 通道，如 'staff-auto-close'）。 */
  extraFeatures: string
  /** 大副外聘（HANDOFF①，默认开）：定时令到点自动派发 + draft 命令自动分诊/呈计划/发布。STARDECK_STAFF=0/false/off 关。 */
  staff: boolean
  /** 大副单役时长上限（分钟）——超龄熔断重开（防挂死堵塞接令管道）。 */
  staffTimeoutMin: number
  /** 舰桥频道（D26 对话范式，默认开）：聊天窗为默认脸面 + 机械战报 + 决策卡。
   *  STARDECK_BRIDGE=0/false/off 关（回退看板先行老形态——旗 OFF 面字节等价）。 */
  bridge: boolean
  /** 代理舰长席（D27，默认开）：聊天窗对话者=代理舰长（拟令【命令】块→命令卡）。
   *  STARDECK_PROXY=0/false/off 关（聊天窗降级态：战报+决策卡在场、输入停用）。 */
  proxy: boolean
  /** 定夺授权（D27，默认关）：舰长显式授权代理舰长代行验收定夺（【定夺】块，
   *  B3 门 flag-gated 通路）。运行态开关（POST /bridge/settings）不改本配置——
   *  重启回落默认 OFF。STARDECK_PROXY_VERDICT=1/on 开。 */
  proxyVerdict: boolean
  /** 事件源进水口总闸（D39，默认开——门开着不等于有活：github 源还需
   *  config.sources.github.enabled+token）。STARDECK_SOURCES=0/false/off 关
   *  （ingest 端点 404、sourceTick 不转——矩阵 off 面）。 */
  sources: boolean
  /** D39-B Watchdog 记旗总闸（默认开——纯观察零破坏：账本记旗+板徽标+舰桥
   *  战报）。STARDECK_WATCHDOG=0 关。 */
  watchdog: boolean
  /** D39-B enforce 升级档（默认关）：静默超窗记旗后 kill 执行者——走既有失联
   *  回收路径（记败+重派）。STARDECK_WATCHDOG_ENFORCE=1 开。 */
  watchdogEnforce: boolean
  /** 日志静默窗（分钟，默认 20）——执行者 CLI 流式输出期间日志恒热，静默即疑卡。 */
  watchdogSilenceMin: number
  /** attempt 龄期窗（分钟，默认 45，claim 起算）。 */
  watchdogAgeMin: number
}

export function stardeckHome(): string {
  return process.env.STARDECK_HOME ?? join(homedir(), '.stardeck')
}

interface ConfigFilePart {
  port?: unknown
  stateDir?: unknown
  warRoot?: unknown
  executor?: unknown
  model?: unknown
  modelProvider?: unknown
  codexShimBase?: unknown
  executorBin?: unknown
  maxAttempts?: unknown
  maxExecutors?: unknown
  extraFeatures?: unknown
  staff?: unknown
  staffTimeoutMin?: unknown
  bridge?: unknown
  proxy?: unknown
  proxyVerdict?: unknown
  sources?: unknown
  watchdog?: unknown
  watchdogEnforce?: unknown
  watchdogSilenceMin?: unknown
  watchdogAgeMin?: unknown
}

/** 纯合并：默认值 ← 配置文件 ← 环境变量 ← 调用方显式覆盖。 */
export function loadConfig(overrides: Partial<StardeckConfig> = {}): StardeckConfig {
  const file: ConfigFilePart = {}
  const file_path = process.env.STARDECK_CONFIG ?? join(stardeckHome(), 'config.json')
  if (existsSync(file_path)) {
    try {
      Object.assign(file, JSON.parse(readFileSync(file_path, 'utf8')) as ConfigFilePart)
    } catch { /* 坏配置文件=按无文件处理，启动日志见 loadConfigWarnings */ }
  }
  const env = process.env
  const pick = (f: unknown, e: string | undefined, d: string): string => (typeof e === 'string' && e !== '' ? e : (typeof f === 'string' && f !== '' ? f : d))
  const stateDir = pick(file.stateDir, env.STARDECK_STATE_DIR, stardeckHome())
  const cfg: StardeckConfig = {
    port: Number(env.STARDECK_PORT ?? file.port ?? 3970),
    stateDir,
    warRoot: pick(file.warRoot, env.STARDECK_WAR_ROOT, join(stateDir, 'tasks')),
    executor: pick(file.executor, env.STARDECK_EXECUTOR, 'opencode'),
    model: pick(file.model, env.STARDECK_MODEL, ''),
    modelProvider: pick(file.modelProvider, env.STARDECK_MODEL_PROVIDER, ''),
    // V19.13 codex 垫片基址（如 http://127.0.0.1:3975/v1）：非空=codex 舰的
    // 模型面改走 Responses→chat 垫片（codex 0.152+ 只认 Responses、GLM 只有
    // chat——垫片 `stardeck codex-shim` 先起，key 只活在垫片进程）。
    codexShimBase: pick(file.codexShimBase, env.STARDECK_CODEX_SHIM_BASE, ''),    executorBin: pick(file.executorBin, env.STARDECK_EXECUTOR_BIN, ''),
    maxAttempts: Number(env.STARDECK_MAX_ATTEMPTS ?? file.maxAttempts ?? 3),
    maxExecutors: Number(env.STARDECK_MAX_EXECUTORS ?? file.maxExecutors ?? 3),
    maxUnits: 0,
    extraFeatures: pick(file.extraFeatures, env.WARROOM_FEATURES, ''),
    staff: boolPick(file.staff, env.STARDECK_STAFF, true),
    staffTimeoutMin: Number(env.STARDECK_STAFF_TIMEOUT_MIN ?? file.staffTimeoutMin ?? 30),
    bridge: boolPick(file.bridge, env.STARDECK_BRIDGE, true),
    proxy: boolPick(file.proxy, env.STARDECK_PROXY, true),
    proxyVerdict: boolPick(file.proxyVerdict, env.STARDECK_PROXY_VERDICT, false),
    sources: boolPick(file.sources, env.STARDECK_SOURCES, true),
    watchdog: boolPick(file.watchdog, env.STARDECK_WATCHDOG, true),
    watchdogEnforce: boolPick(file.watchdogEnforce, env.STARDECK_WATCHDOG_ENFORCE, false),
    watchdogSilenceMin: Number(env.STARDECK_WATCHDOG_SILENCE_MIN ?? file.watchdogSilenceMin ?? 20),
    watchdogAgeMin: Number(env.STARDECK_WATCHDOG_AGE_MIN ?? file.watchdogAgeMin ?? 45),
  }
  return { ...cfg, ...overrides }
}

/** 布尔配置合并：env 显式串（0/false/off/no=关，其余非空=开）> 配置文件布尔 > 默认。 */
function boolPick(f: unknown, e: string | undefined, d: boolean): boolean {
  if (typeof e === 'string' && e !== '') return !['0', 'false', 'off', 'no'].includes(e.trim().toLowerCase())
  if (typeof f === 'boolean') return f
  return d
}

/** 确保目录在（启动与测试共用）。 */
export function ensureDirs(cfg: StardeckConfig): void {
  mkdirSync(cfg.stateDir, { recursive: true })
  mkdirSync(cfg.warRoot, { recursive: true })
  mkdirSync(join(cfg.stateDir, 'logs'), { recursive: true })
}

/** 配置文件路径（加载与落盘同一真相源：STARDECK_CONFIG 可指到别处）。 */
export function configFilePath(): string {
  return process.env.STARDECK_CONFIG ?? join(stardeckHome(), 'config.json')
}

/** 舰队绑定落盘（P0-2，2026-09-02）：POST /fleet 成功后把 executor+model 写回
 *  配置文件——daemon 重启不再回落启动默认。优先级语义不变（env 显式键重启后
 *  仍压过文件）。既有键原样保留；坏 JSON 拒绝覆盖（同 bound 工作区注入家法），
 *  返回 ok:false 由调用方在回执里警示——内存绑定已生效，仅持久化失败。
 *  写入走 tmp+rename 原子换名。 */
export function persistFleetBinding(executor: string, model: string): { ok: true } | { ok: false; error: string } {
  const path = configFilePath()
  let base: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `配置文件不是 JSON 对象（${path}）——拒绝覆盖，请手工修复后再绑` }
      }
      base = { ...(parsed as Record<string, unknown>) }
    } catch {
      return { ok: false, error: `配置文件损坏（${path}，JSON 解析失败）——拒绝覆盖，请手工修复后再绑` }
    }
  }
  // 落盘=best-effort（绑定运行态先行，持久化失败不炸路由）：Windows 下并行
  // daemon 同写一份 config 时 rename 可抛 EPERM/EBUSY——吞成 ok:false，POST /fleet
  // 照常 200 + persisted:false（全量测试并行实测咬过一次 500）。
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now().toString(36)}`
    writeFileSync(tmp, `${JSON.stringify({ ...base, executor, model }, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    return { ok: false, error: `配置落盘失败（${path}：${err instanceof Error ? err.message : String(err)}）——本次绑定仅运行态生效，重启回落` }
  }
  return { ok: true }
}

/** 通用配置补丁（D35 形态 A：connect --panel 写 bridge:false）。与
 *  {@link persistFleetBinding} 同纪律：既有键原样保留/坏 JSON 拒绝覆盖/
 *  tmp+rename 原子。浅合并——patch 里的键覆盖文件值，其余不动。 */
export function persistConfigPatch(patch: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  const path = configFilePath()
  let base: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `配置文件不是 JSON 对象（${path}）——拒绝覆盖，请手工修复` }
      }
      base = { ...(parsed as Record<string, unknown>) }
    } catch {
      return { ok: false, error: `配置文件损坏（${path}，JSON 解析失败）——拒绝覆盖，请手工修复` }
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now().toString(36)}`
    writeFileSync(tmp, `${JSON.stringify({ ...base, ...patch }, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    return { ok: false, error: `配置落盘失败（${path}：${err instanceof Error ? err.message : String(err)}）` }
  }
  return { ok: true }
}


/** D33 段3：内置 loop 供给段（config.json 顶层 `loop` 键）。key 落盘范围仅此一处
 *  （舰长 2026-10-22 拍板放宽：key 只存本机 config——永不入仓/不进日志/不出 daemon）。 */
export interface LoopConfig {
  model: string
  baseUrl: string
  apiKey: string
  /** D37 思考强度（照搬 lookatstudy 三档）：''=自动不干预 / 'fast'=thinking disabled /
   *  'deep'=thinking enabled——仅 GLM 家族端点生效（bodyPatch 方言，见 proxy-loop）。 */
  effort: '' | 'fast' | 'deep'
}

const EMPTY_LOOP: LoopConfig = { model: '', baseUrl: '', apiKey: '', effort: '' }

export function readLoopConfig(): LoopConfig {
  const path = configFilePath()
  if (!existsSync(path)) return { ...EMPTY_LOOP }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { loop?: Partial<LoopConfig> }
    const l = parsed.loop ?? {}
    return {
      model: typeof l.model === 'string' ? l.model : '',
      baseUrl: typeof l.baseUrl === 'string' ? l.baseUrl : '',
      apiKey: typeof l.apiKey === 'string' ? l.apiKey : '',
      effort: l.effort === 'fast' || l.effort === 'deep' ? l.effort : '',
    }
  } catch {
    return { ...EMPTY_LOOP }
  }
}

/** loop 段写入（patch 浅合并；空串 apiKey=清除）。同 persistFleetBinding 家法：
 *  坏 JSON 拒绝覆盖 + tmp+rename 原子 + best-effort。 */
export function writeLoopConfig(patch: Partial<LoopConfig>): { ok: true; loop: LoopConfig } | { ok: false; error: string } {
  const path = configFilePath()
  let base: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `配置文件不是 JSON 对象（${path}）——拒绝覆盖` }
      }
      base = { ...(parsed as Record<string, unknown>) }
    } catch {
      return { ok: false, error: `配置文件损坏（${path}）——拒绝覆盖` }
    }
  }
  const prev = readLoopConfig()
  const next: LoopConfig = {
    model: patch.model !== undefined ? patch.model : prev.model,
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : prev.baseUrl,
    apiKey: patch.apiKey !== undefined ? patch.apiKey : prev.apiKey,
    effort: patch.effort !== undefined ? patch.effort : prev.effort,
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now().toString(36)}`
    writeFileSync(tmp, `${JSON.stringify({ ...base, loop: next }, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    return { ok: false, error: `loop 配置落盘失败（${err instanceof Error ? err.message : String(err)}）——运行态已生效，重启回落` }
  }
  return { ok: true, loop: next }
}

/** D39 事件源进水口（config.json 顶层 `sources` 键，照 loop 段家法）。github
 *  源：PAT 轮询（apiBase 可指 GHES/本地 mock——测试确定性）；ingest 源：通用
 *  注入端点的准入门（默认 '*'=本地信任全显式，与 /commands 同纪律）。 */
export type SourceAdmissionMode = 'off' | 'observe' | 'auto'

export interface GithubSourceConfig {
  enabled: boolean
  /** owner/name（监听范围=该仓 issues/PR/评论）。 */
  repo: string
  /** PAT（只读轮询=repo/public_repo 读；writeback 开启还需 issues:write）。 */
  token: string
  /** REST 基址（默认 https://api.github.com；GHES/本地 mock 可覆写）。 */
  apiBase: string
  /** 允许名单（GitHub login；名单内=显式请求任何档都建卡）。 */
  allow: string[]
  /** 名单外推断候选档位：off=拒 / observe=只记录 / auto=建卡。 */
  admission: SourceAdmissionMode
  /** 收官回写（D39-D，默认关）：开启即视为舰长授权该仓自动回帖。 */
  writeback: boolean
  /** 轮询间隔（秒）。 */
  pollSec: number
}

export interface IngestSourceConfig {
  /** 允许名单（author 标签；默认 '*'=本地信任全显式——POST /sources/ingest
   *  与 /commands 同为本地通道）。收窄后按 admission 档位走。 */
  allow: string[]
  admission: SourceAdmissionMode
}

export interface SourcesConfig {
  github: GithubSourceConfig
  ingest: IngestSourceConfig
}

const EMPTY_SOURCES: SourcesConfig = {
  github: { enabled: false, repo: '', token: '', apiBase: 'https://api.github.com', allow: [], admission: 'observe', writeback: false, pollSec: 120 },
  ingest: { allow: ['*'], admission: 'observe' },
}

function admissionOf(v: unknown, d: SourceAdmissionMode): SourceAdmissionMode {
  return v === 'off' || v === 'observe' || v === 'auto' ? v : d
}

function stringArrayOf(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  // 坏元素丢弃，好元素保留（宽容读——配置面不做全有全无）。
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

export function readSourcesConfig(): SourcesConfig {
  const path = configFilePath()
  if (!existsSync(path)) return { github: { ...EMPTY_SOURCES.github }, ingest: { ...EMPTY_SOURCES.ingest } }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sources?: { github?: Partial<GithubSourceConfig>; ingest?: Partial<IngestSourceConfig> } }
    const g = parsed.sources?.github ?? {}
    const i = parsed.sources?.ingest ?? {}
    return {
      github: {
        enabled: g.enabled === true,
        repo: typeof g.repo === 'string' ? g.repo.trim() : '',
        token: typeof g.token === 'string' ? g.token : '',
        apiBase: typeof g.apiBase === 'string' && g.apiBase.trim() !== '' ? g.apiBase.trim().replace(/\/+$/, '') : EMPTY_SOURCES.github.apiBase,
        allow: stringArrayOf(g.allow) ?? [],
        admission: admissionOf(g.admission, 'observe'),
        writeback: g.writeback === true,
        pollSec: typeof g.pollSec === 'number' && Number.isFinite(g.pollSec) && g.pollSec >= 15 ? Math.floor(g.pollSec) : 120,
      },
      ingest: {
        allow: stringArrayOf(i.allow) ?? ['*'],
        admission: admissionOf(i.admission, 'observe'),
      },
    }
  } catch {
    return { github: { ...EMPTY_SOURCES.github }, ingest: { ...EMPTY_SOURCES.ingest } }
  }
}

/** sources 段写入（patch 浅合并；空串 token=清除）。同 writeLoopConfig 家法：
 * 坏 JSON 拒绝覆盖 + tmp+rename 原子 + best-effort。 */
export function writeSourcesConfig(patch: { github?: Partial<GithubSourceConfig>; ingest?: Partial<IngestSourceConfig> }): { ok: true; sources: SourcesConfig } | { ok: false; error: string } {
  const path = configFilePath()
  let base: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `配置文件不是 JSON 对象（${path}）——拒绝覆盖` }
      }
      base = { ...(parsed as Record<string, unknown>) }
    } catch {
      return { ok: false, error: `配置文件损坏（${path}，JSON 解析失败）——拒绝覆盖` }
    }
  }
  const prev = readSourcesConfig()
  const next: SourcesConfig = {
    github: {
      enabled: patch.github?.enabled !== undefined ? patch.github.enabled : prev.github.enabled,
      repo: patch.github?.repo !== undefined ? patch.github.repo : prev.github.repo,
      token: patch.github?.token !== undefined ? patch.github.token : prev.github.token,
      apiBase: patch.github?.apiBase !== undefined ? patch.github.apiBase : prev.github.apiBase,
      allow: patch.github?.allow !== undefined ? patch.github.allow : prev.github.allow,
      admission: patch.github?.admission !== undefined ? patch.github.admission : prev.github.admission,
      writeback: patch.github?.writeback !== undefined ? patch.github.writeback : prev.github.writeback,
      pollSec: patch.github?.pollSec !== undefined ? patch.github.pollSec : prev.github.pollSec,
    },
    ingest: {
      allow: patch.ingest?.allow !== undefined ? patch.ingest.allow : prev.ingest.allow,
      admission: patch.ingest?.admission !== undefined ? patch.ingest.admission : prev.ingest.admission,
    },
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now().toString(36)}`
    writeFileSync(tmp, `${JSON.stringify({ ...base, sources: next }, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    return { ok: false, error: `sources 配置落盘失败（${err instanceof Error ? err.message : String(err)}）——运行态已生效，重启回落` }
  }
  return { ok: true, sources: next }
}
