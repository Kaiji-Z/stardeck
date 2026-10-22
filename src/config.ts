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


/** D33 段3：内置 loop 供给段（config.json 顶层 `loop` 键）。key 落盘范围仅此一处
 *  （舰长 2026-10-22 拍板放宽：key 只存本机 config——永不入仓/不进日志/不出 daemon）。 */
export interface LoopConfig {
  model: string
  baseUrl: string
  apiKey: string
}

const EMPTY_LOOP: LoopConfig = { model: '', baseUrl: '', apiKey: '' }

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
