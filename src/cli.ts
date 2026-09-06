/**
 * stardeck CLI（bin）。v0.1 命令面：
 *   stardeck            # 等价 start（起 daemon，前台）
 *   stardeck start      # 起 daemon；--port/--state-dir/--model/--executor 覆盖
 *   stardeck open       # 起 daemon + 拉起默认浏览器直达板 UI（P1-5）
 *   stardeck status     # 探活：舰队/revision/命令与任务计数（不在跑=退出码 1）
 *   stardeck stop       # 优雅停服（POST /shutdown——在役执行者先行收割）
 *   stardeck version    # 版本
 * @module stardeck/cli
 */

import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { startDaemon, packageVersion } from './daemon.ts'
import { loadConfig, stardeckHome } from './config.ts'
import { startCodexShim } from './codex-shim.ts'

interface CliOptions {
  port?: number
  stateDir?: string
  warRoot?: string
  model?: string
  executor?: string
  executorBin?: string
  /** codex-shim 面：上游 chat 基址与 key（缺省走 Z_AI_BASE_URL/Z_AI_API_KEY env）。 */
  upstream?: string
  key?: string
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const [command = 'start'] = argv
  const options: CliOptions = {}
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    const next = argv[i + 1]
    if (a === '--port' && next !== undefined) { options.port = Number(next); i++ }
    else if (a === '--state-dir' && next !== undefined) { options.stateDir = next; i++ }
    else if (a === '--war-root' && next !== undefined) { options.warRoot = next; i++ }
    else if (a === '--model' && next !== undefined) { options.model = next; i++ }
    else if (a === '--executor' && next !== undefined) { options.executor = next; i++ }
    else if (a === '--executor-bin' && next !== undefined) { options.executorBin = next; i++ }
    else if (a === '--upstream' && next !== undefined) { options.upstream = next; i++ }
    else if (a === '--key' && next !== undefined) { options.key = next; i++ }
    else { console.error(`未知参数：${a}`); process.exit(2) }
  }
  return { command, options }
}

/** 拉起默认浏览器的跨平台命令（纯，测试管辖）。win32 走 cmd start（空标题参
 *  占位——URL 带查询串时不是窗口名）。 */
export function browserOpenCommand(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] }
  if (platform === 'darwin') return { cmd: 'open', args: [url] }
  return { cmd: 'xdg-open', args: [url] }
}

function openBrowser(url: string): void {
  const { cmd, args } = browserOpenCommand(url)
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (err) {
    console.warn(`浏览器拉起失败（${err instanceof Error ? err.message : String(err)}）——手动打开 ${url}`)
  }
}

/** status：探活并打印舰队/revision/账面计数。daemon 不在跑=退出码 1。 */
async function cmdStatus(): Promise<number> {
  const cfg = loadConfig()
  const base = `http://127.0.0.1:${cfg.port}`
  try {
    const health = await fetch(`${base}/warroom/api/healthz`).then(r => {
      if (!r.ok) throw new Error(`healthz HTTP ${r.status}`)
      return r.json() as Promise<{ product?: string; version?: string }>
    })
    const board = await fetch(`${base}/warroom/api/board`).then(r => r.json() as Promise<{
      revision?: string; commands?: unknown[]; tasks?: Array<{ status?: string }>; threads?: unknown[]
      roster?: Array<{ name?: string }>; rosterErrors?: string[]
    }>)
    const active = board.tasks?.filter(t => t.status === 'in_progress').length ?? 0
    // 舰队行报活态（/fleet）——status 对正在跑的 daemon 说实话，不读静态文件
    // （板面绑的可以≠config 默认；/fleet 失败退回 config 行）。
    const fleet = await fetch(`${base}/warroom/api/fleet`).then(r => r.json() as Promise<{ active?: { executor?: string; model?: string } }>).catch(() => ({}) as { active?: { executor?: string; model?: string } })
    const fleetLine = fleet.active !== undefined
      ? `舰队 ${fleet.active.executor ?? '?'}${fleet.active.model !== undefined && fleet.active.model !== '' ? ` @ ${fleet.active.model}` : '（板面可换）'}`
      : `舰队 ${cfg.executor}${cfg.model !== '' ? ` @ ${cfg.model}` : '（板面可换）'}`
    console.log([
      `${health.product ?? 'stardeck'} v${health.version ?? '?'} — 在运行 ${base}`,
      `${fleetLine} · revision ${board.revision ?? '?'}`,
      `命令 ${board.commands?.length ?? 0} · 任务 ${board.tasks?.length ?? 0}（在役 ${active}） · 挂载 ${board.threads?.length ?? 0} · 名册 ${board.roster?.length ?? 0}${(board.rosterErrors?.length ?? 0) > 0 ? `（${board.rosterErrors.length} 席未检出）` : ''}`,
      `板 UI ${base}/`,
    ].join('\n'))
    return 0
  } catch {
    console.error(`stardeck daemon 未在运行（${base} 无响应）——先 stardeck start。`)
    return 1
  }
}

/** stop：POST /shutdown 优雅停服；不在跑如实说。 */
async function cmdStop(): Promise<number> {
  const cfg = loadConfig()
  const base = `http://127.0.0.1:${cfg.port}`
  try {
    const out = await fetch(`${base}/warroom/api/shutdown`, { method: 'POST' }).then(r => r.json() as Promise<{ ok?: boolean }>)
    if (out.ok === true) {
      console.log(`已请求优雅关停（${base}）——在役执行者先行收割。`)
      return 0
    }
    console.error(`停服请求被拒：${JSON.stringify(out)}`)
    return 1
  } catch {
    console.error(`stardeck daemon 未在运行（${base} 无响应）——无需停服。`)
    return 1
  }
}

/** codex Responses→chat 垫片（V19.13）：GLM 直驱 codex 的解锁刀。
 *  key 来源优先级：--key > Z_AI_API_KEY env > 拒启（诚实报缺——key 永不落盘）。 */
async function cmdCodexShim(options: CliOptions): Promise<void> {
  const upstream = options.upstream ?? process.env.Z_AI_BASE_URL ?? ''
  const apiKey = options.key ?? process.env.Z_AI_API_KEY ?? ''
  if (upstream === '' || apiKey === '') {
    console.error('codex-shim 缺配置：需要 --upstream + --key（或 env Z_AI_BASE_URL / Z_AI_API_KEY）——不给 key 不起服。')
    process.exitCode = 2
    return
  }
  const port = options.port ?? 3975
  const shim = await startCodexShim({ port, upstream, apiKey })
  console.log(`[stardeck] codex-shim 已上线 http://127.0.0.1:${port}/v1（上游 ${upstream.replace(/\/\/[^/]+@/, '//')}，chat wire 翻译面）`)
  console.log('[stardeck] codex 侧：STARDECK_CODEX_SHIM_BASE=http://127.0.0.1:' + port + '/v1 起 daemon（或 -c model_providers… 见 AGENTS.md）')
  const shutdown = (): void => {
    void shim.close().then(() => { console.log('[stardeck] codex-shim 已收摊'); process.exitCode = 0 })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// 主入口守卫：直接执行（node cli.ts / dist/cli.mjs）才分发命令——测试 import 取纯函数零副作用。
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
const { command, options } = isMain ? parseArgs(process.argv.slice(2)) : { command: '', options: {} as CliOptions }

if (isMain) {
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(packageVersion())
    process.exit(0)
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log([
      'stardeck — agent 舰队的作战看板与守护进程',
      '',
      '用法：stardeck [start|open|status|stop|codex-shim|version] [--port N] [--state-dir DIR] [--war-root DIR] [--model PROVIDER/MODEL] [--executor ID]',
      '  start 起 daemon（前台）；open 同 start 并拉起浏览器；status 探活；stop 优雅停服',
      '  codex-shim 起 Responses→chat 垫片（GLM 直驱 codex；--upstream/--key 或 Z_AI_* env）',
      `默认状态目录：${stardeckHome()}（STARDECK_HOME 可改；支持 ~/.stardeck/config.json）`,
    ].join('\n'))
    process.exit(0)
  }
  if (command === 'status') {
    void cmdStatus().then(code => { process.exitCode = code })
  } else if (command === 'stop') {
    void cmdStop().then(code => { process.exitCode = code })
  } else if (command === 'codex-shim') {
    void cmdCodexShim(options)
  } else if (command !== 'start' && command !== 'open') {
    console.error(`未知命令：${command}（可用：start | open | status | stop | codex-shim | version | help）`)
    process.exit(2)
  } else {
    runDaemon(command, options)
  }
}

/** 起 daemon（前台）+ open 时健康后拉浏览器 + 信号优雅关停。 */
function runDaemon(command: string, options: CliOptions): void {
  const handle = startDaemon(options)
  if (command === 'open') {
    const tryOpen = (attempt: number): void => {
      void fetch(`${handle.base}/warroom/api/healthz`).then(r => {
        if (r.ok) openBrowser(`${handle.base}/`)
        else if (attempt < 40) setTimeout(() => tryOpen(attempt + 1), 500)
        else console.warn(`daemon 就绪超时——手动打开 ${handle.base}/`)
      }).catch(() => {
        if (attempt < 40) setTimeout(() => tryOpen(attempt + 1), 500)
        else console.warn(`daemon 就绪超时——手动打开 ${handle.base}/`)
      })
    }
    tryOpen(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void handle.close().then(() => process.exit(0))
    })
  }
}
