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
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${Date.now().toString(36)}`
  writeFileSync(tmp, `${JSON.stringify({ ...base, executor, model }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return { ok: true }
}
