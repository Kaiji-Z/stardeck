/**
 * stardeck connect —— 一行接入代理舰长外接席（D30）。
 *
 * `stardeck connect <host>`：daemon 不在就后台拉起 → POST /proxy/seats 签席
 * （token 只此一次）→ 把 stardeck-proxy MCP 服注册进宿主配置。四宿主全部
 * **声明式文件写**（不 spawn 宿主 CLI——win32 .cmd 垫片陷阱不触，跨平台一致；
 * 注册面以 2026-10 各宿主最新版机制实证为准）：
 *   claude   → ~/.claude.json 顶层 mcpServers（`claude mcp add -s user` 同址）
 *   zcode    → ~/.zcode/cli/config.json 的 mcp.servers（开源 CLI 变体读
 *              setting.json——文件在则双写并补 features.mcp 闸）
 *   opencode → ~/.config/opencode/opencode.json 的 mcp（type:local command 数组）
 *   codex    → CODEX_HOME(~/.codex)/config.toml 的 [mcp_servers.stardeck-proxy]
 *              （文本级摘旧表再追加——injectCodexMcp 同法）
 *   通用/未知 → 打印 {"mcpServers": …} 配置块自拷
 * 写盘纪律承注入家族：首动备份 <file>.pre-stardeck、幂等只刷本键、坏 JSON
 * 拒绝覆盖。红线：配置只含 --face proxy + STARDECK_PROXY_TOKEN——执行者
 * war_* 一件不出（出口协议）。
 * @module stardeck/connect
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { loadConfig } from './config.ts'
import { mcpBridgePath } from './executor.ts'

export const PROXY_SERVER_NAME = 'stardeck-proxy'

export interface ProxyConnectArgs {
  token: string
  http: string
  bridgePath: string
  nodePath: string
}

/** claude：`claude mcp add stardeck-proxy -s user -e … -- <node> <bridge> --face proxy` 的等价注册体。 */
export function buildClaudeProxyEntry(a: ProxyConnectArgs): Record<string, unknown> {
  return { type: 'stdio', command: a.nodePath, args: [a.bridgePath, '--face', 'proxy'], env: { STARDECK_PROXY_TOKEN: a.token, STARDECK_HTTP: a.http } }
}

/** codex：config.toml [mcp_servers.stardeck-proxy] 表体。 */
export function buildCodexProxyTable(a: ProxyConnectArgs): string {
  const q = (v: string): string => JSON.stringify(v)
  return [
    '',
    '# stardeck 注入（stardeck connect；工具面经 mcp-bridge --face proxy 回连舰桥，代理席五件）',
    '[mcp_servers.stardeck-proxy]',
    `command = ${q(a.nodePath)}`,
    `args = [${q(a.bridgePath)}, '--face', 'proxy']`,
    `env = { STARDECK_PROXY_TOKEN = ${q(a.token)}, STARDECK_HTTP = ${q(a.http)} }`,
    '',
  ].join('\n')
}

/** opencode：opencode.json 的 mcp["stardeck-proxy"] 值（command 是数组）。 */
export function buildOpencodeProxyEntry(a: ProxyConnectArgs): Record<string, unknown> {
  return { type: 'local', command: [a.nodePath, a.bridgePath, '--face', 'proxy'], environment: { STARDECK_PROXY_TOKEN: a.token, STARDECK_HTTP: a.http }, enabled: true }
}

/** zcode：config.json 的 mcp.servers["stardeck-proxy"] 值（command 串+args 数组）。 */
export function buildZcodeProxyEntry(a: ProxyConnectArgs): Record<string, unknown> {
  return { type: 'stdio', command: a.nodePath, args: [a.bridgePath, '--face', 'proxy'], env: { STARDECK_PROXY_TOKEN: a.token, STARDECK_HTTP: a.http }, enabled: true }
}

/** 通用：{"mcpServers": …} 配置块（industry-standard 形状——zcode .agents 兼容层同款）。 */
export function buildGenericBlock(a: ProxyConnectArgs): string {
  return JSON.stringify({ mcpServers: { [PROXY_SERVER_NAME]: { command: a.nodePath, args: [a.bridgePath, '--face', 'proxy'], env: { STARDECK_PROXY_TOKEN: a.token, STARDECK_HTTP: a.http } } } }, null, 2)
}

/** JSON 注册文件合并（注入家族纪律）：坏 JSON 拒绝覆盖；首动备份 .pre-stardeck；
 *  写走 tmp+rename 原子换名；幂等只刷 stardeck-proxy 一个键。 */
function mergeJsonConfig(
  path: string,
  merge: (root: Record<string, unknown>) => Record<string, unknown>,
): { ok: true; path: string } | { ok: false; error: string } {
  let base: Record<string, unknown> = {}
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8')
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: `${path} 不是 JSON 对象——拒绝覆盖，请手工修复` }
      }
      base = { ...(parsed as Record<string, unknown>) }
      const backup = `${path}.pre-stardeck`
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
    } catch (err) {
      return { ok: false, error: `${path} 不是合法 JSON，stardeck 拒绝覆盖：${err instanceof Error ? err.message : String(err)}` }
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now().toString(36)}`
    writeFileSync(tmp, `${JSON.stringify(merge(base), null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** TOML 文本级注入（injectCodexMcp 同法）：摘旧 [mcp_servers.stardeck-proxy] 整表再追加。 */
function writeCodexToml(path: string, table: string): { ok: true; path: string } | { ok: false; error: string } {
  try {
    mkdirSync(dirname(path), { recursive: true })
    let existing = ''
    if (existsSync(path)) {
      existing = readFileSync(path, 'utf8')
      const backup = `${path}.pre-stardeck`
      if (!existsSync(backup)) writeFileSync(backup, existing, 'utf8')
      const kept: string[] = []
      let inTable = false
      for (const line of existing.split('\n')) {
        if (/^\[mcp_servers\.stardeck-proxy\]/.test(line.trim())) { inTable = true; continue }
        if (inTable && /^\[/.test(line)) inTable = false
        if (!inTable) kept.push(line)
      }
      existing = kept.join('\n').replace(/\n*$/, '\n')
    }
    writeFileSync(path, `${existing}${table}`, 'utf8')
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface ConnectPaths {
  home?: string
  xdgConfig?: string
  codexHome?: string
  zcodeHome?: string
}

/** 各宿主注册文件落点（纯——env 可注，测试隔离）。 */
export function hostConfigPaths(host: 'claude' | 'zcode' | 'opencode' | 'codex', p: ConnectPaths = {}): string {
  const home = p.home ?? homedir()
  if (host === 'claude') return join(home, '.claude.json')
  if (host === 'zcode') return p.zcodeHome !== undefined ? join(p.zcodeHome, 'cli', 'config.json') : join(home, '.zcode', 'cli', 'config.json')
  if (host === 'codex') return join(p.codexHome ?? join(home, '.codex'), 'config.toml')
  const xdg = p.xdgConfig ?? join(home, '.config')
  return join(xdg, 'opencode', 'opencode.json')
}

export interface ConnectResult {
  ok: boolean
  base: string
  seatId?: string
  /** 交 CLI 打印的全部行（注册回执/用法/撤销法/通用配置块）。 */
  lines: string[]
  error?: string
}

/** 确保 daemon 在跑：healthz 探活；不在且 spawnDaemon 可用则拉起再等（30s）。 */
async function ensureDaemon(base: string, spawnDaemon?: () => void): Promise<{ ok: true } | { ok: false; error: string }> {
  const probe = async (): Promise<boolean> => {
    try {
      const r = await fetch(`${base}/warroom/api/healthz`, { signal: AbortSignal.timeout(1500) })
      return r.ok
    } catch { return false }
  }
  if (await probe()) return { ok: true }
  if (spawnDaemon !== undefined) {
    try { spawnDaemon() } catch (err) { return { ok: false, error: `daemon 拉起失败：${err instanceof Error ? err.message : String(err)}` } }
    for (let i = 0; i < 60; i++) {
      if (await probe()) return { ok: true }
      await new Promise(r => setTimeout(r, 500))
    }
    return { ok: false, error: `daemon 拉起后 30s 未就绪（${base}）——手动 stardeck start 看日志` }
  }
  return { ok: false, error: `daemon 未在运行（${base}）——先 stardeck start` }
}

export interface RunConnectOptions {
  /** 缺省按 loadConfig().port 推 127.0.0.1。 */
  base?: string
  bridgePath?: string
  nodePath?: string
  paths?: ConnectPaths
  /** daemon 缺席时的拉起器（打包态=defaultSpawnDaemon 的 detached 自 spawn；测试注入）；缺省=不拉只报。 */
  spawnDaemon?: () => void
}

/** connect 主流程：探活/拉起 daemon → 签席 → 按宿主注册 → 结构化回执。 */
export async function runConnect(host: string, opts: RunConnectOptions = {}): Promise<ConnectResult> {
  const base = opts.base ?? `http://127.0.0.1:${loadConfig().port}`
  const up = await ensureDaemon(base, opts.spawnDaemon)
  if (!up.ok) return { ok: false, base, lines: [], error: up.error }
  let seat: { ok?: boolean; seatId?: string; token?: string; error?: string }
  try {
    seat = await fetch(`${base}/warroom/api/proxy/seats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<{ ok?: boolean; seatId?: string; token?: string; error?: string }>)
  } catch (err) {
    return { ok: false, base, lines: [], error: `签席失败：${err instanceof Error ? err.message : String(err)}` }
  }
  if (seat.ok !== true || typeof seat.token !== 'string' || typeof seat.seatId !== 'string') {
    return { ok: false, base, lines: [], error: `签席被拒：${seat.error ?? JSON.stringify(seat)}` }
  }
  const args: ProxyConnectArgs = {
    token: seat.token,
    http: base,
    bridgePath: opts.bridgePath ?? mcpBridgePath(),
    nodePath: opts.nodePath ?? process.execPath,
  }
  const paths = opts.paths ?? {}
  const normalized: 'claude' | 'zcode' | 'opencode' | 'codex' | 'generic' = (['claude', 'zcode', 'opencode', 'codex'] as const).includes(host as never) ? host as 'claude' | 'zcode' | 'opencode' | 'codex' : 'generic'
  const lines: string[] = []
  if (normalized === 'generic') {
    lines.push('通用 MCP 配置（把它注册进你的 agent 宿主，名字随意）：')
    lines.push(buildGenericBlock(args))
    lines.push('宿主若吃 .agents/mcp.json 兼容层（如 zcode 工作区），整段粘进去即可。')
  } else {
    const target = hostConfigPaths(normalized, paths)
    let out: { ok: true; path: string } | { ok: false; error: string }
    if (normalized === 'claude') {
      out = mergeJsonConfig(target, root => ({ ...root, mcpServers: { ...((root.mcpServers as Record<string, unknown> | undefined) ?? {}), [PROXY_SERVER_NAME]: buildClaudeProxyEntry(args) } }))
    } else if (normalized === 'opencode') {
      out = mergeJsonConfig(target, root => ({ ...root, mcp: { ...((root.mcp as Record<string, unknown> | undefined) ?? {}), [PROXY_SERVER_NAME]: buildOpencodeProxyEntry(args) } }))
    } else if (normalized === 'codex') {
      out = writeCodexToml(target, buildCodexProxyTable(args))
    } else {
      out = mergeJsonConfig(target, root => {
        const mcp = { ...((root.mcp as Record<string, unknown> | undefined) ?? {}) }
        mcp.servers = { ...((mcp.servers as Record<string, unknown> | undefined) ?? {}), [PROXY_SERVER_NAME]: buildZcodeProxyEntry(args) }
        return { ...root, mcp }
      })
      // 开源 CLI 变体（setting.json）双写：文件在才动——同键注册 + features.mcp 闸。
      if (out.ok && paths.zcodeHome === undefined) {
        const settingPath = join(paths.home ?? homedir(), '.zcode', 'cli', 'setting.json')
        if (existsSync(settingPath)) {
          const settingOut = mergeJsonConfig(settingPath, root => ({
            features: { ...((root.features as Record<string, unknown> | undefined) ?? {}), mcp: true },
            mcp: { ...((root.mcp as Record<string, unknown> | undefined) ?? {}), servers: { ...((((root.mcp as Record<string, unknown> | undefined) ?? {}).servers as Record<string, unknown> | undefined) ?? {}), [PROXY_SERVER_NAME]: buildZcodeProxyEntry(args) } },
          }))
          if (settingOut.ok) lines.push(`（检测到 zcode CLI setting.json——已双写：${settingPath}）`)
        }
      }
    }
    if (!out.ok) return { ok: false, base, seatId: seat.seatId, lines, error: out.error }
    lines.push(`已注册 ${normalized} 宿主：${out.path}`)
    lines.push(`（stardeck-proxy → mcp-bridge --face proxy；首动备份 *.pre-stardeck。撤销：删除该文件里的 "${PROXY_SERVER_NAME}" 键即可${normalized === 'claude' ? `，或 claude mcp remove ${PROXY_SERVER_NAME} -s user` : ''}。）`)
  }
  lines.push(`打开 ${base}/ 跟代理舰长说话——现在答话的是你的 ${normalized === 'generic' ? 'agent' : normalized}（重启该宿主生效）。`)
  lines.push('token 只此一次：本条注册就是凭证，泄露=他人可代舰长说话。')
  return { ok: true, base, seatId: seat.seatId, lines }
}

/** 打包态自拉起器：detached spawn `node bin/stardeck.mjs start`（node 直跑 mjs，
 *  win32 .cmd 垫片不触）。开发态（tsx 直跑 src/cli.ts）给不出可 spawn 的入口
 *  → undefined，上层诚实报「先 stardeck start」。 */
export function defaultSpawnDaemon(): (() => void) | undefined {
  const entry = resolve(process.argv[1] ?? '')
  if (!/stardeck\.mjs$/.test(entry)) return undefined
  return (): void => {
    const child = spawn(process.execPath, [entry, 'start'], { detached: true, stdio: 'ignore', cwd: dirname(entry) })
    child.unref()
  }
}
