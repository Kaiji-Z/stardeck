/**
 * stardeck CLI（bin）。v0.7 命令面：
 *   stardeck            # 等价 start（起 daemon，前台；就绪后自动拉浏览器）
 *   stardeck start      # 起 daemon；--no-open 关自动开浏览器；--port/--state-dir/…
 *   stardeck open       # 同 start 且强制拉浏览器（老形态显式面）
 *   stardeck app        # 建「点击即用」快捷方式（win32 开始菜单/.command/.desktop）
 *   stardeck connect    # 一行接入：把任意 agent 宿主注册成代理舰长外接席（D30）
 *   stardeck status     # 探活：舰队/revision/命令与任务计数（不在跑=退出码 1）
 *   stardeck stop       # 优雅停服（POST /shutdown——在役执行者先行收割）
 *   stardeck version    # 版本
 * @module stardeck/cli
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startDaemon, packageVersion } from './daemon.ts'
import { loadConfig, stardeckHome, configFilePath } from './config.ts'
import { startCodexShim } from './codex-shim.ts'
import { runConnect, defaultSpawnDaemon } from './connect.ts'

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
  /** 开箱面（D30）：start 默认就绪后拉浏览器，--no-open 关（open 恒开）。 */
  noOpen?: boolean
  /** 开箱面（D30）：首跑自动建快捷方式，--no-app 关（app 子命令恒建）。 */
  noApp?: boolean
  /** connect [host] 的位置参数（claude|zcode|opencode|codex|generic）。 */
  host?: string
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const [command = 'start', positional] = argv
  const options: CliOptions = {}
  if (command === 'connect' && positional !== undefined) options.host = positional
  for (let i = command === 'connect' && positional !== undefined ? 2 : 1; i < argv.length; i++) {
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
    else if (a === '--no-open') { options.noOpen = true }
    else if (a === '--no-app') { options.noApp = true }
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

/** daemon 就绪后拉浏览器（start 自动面与 open 显式面共用）。 */
function waitHealthyAndOpen(base: string): void {
  const tryOpen = (attempt: number): void => {
    void fetch(`${base}/warroom/api/healthz`).then(r => {
      if (r.ok) openBrowser(`${base}/`)
      else if (attempt < 40) setTimeout(() => tryOpen(attempt + 1), 500)
      else console.warn(`daemon 就绪超时——手动打开 ${base}/`)
    }).catch(() => {
      if (attempt < 40) setTimeout(() => tryOpen(attempt + 1), 500)
      else console.warn(`daemon 就绪超时——手动打开 ${base}/`)
    })
  }
  tryOpen(0)
}

/** 「点击即用」快捷方式的落点与内容计划（纯，测试管辖）。
 *  win32=开始菜单 .lnk（经 PowerShell COM 创建，目标=node 入口，最小化窗口）；
 *  darwin=~/Applications/stardeck.command（双击开终端）；linux=.desktop 条目。 */
export function shortcutPlan(
  platform: NodeJS.Platform,
  paths: { nodePath: string; entryPath: string; home: string },
  env: NodeJS.ProcessEnv = process.env,
): { path: string; content?: string; lnk?: { target: string; args: string; workdir: string } } {
  if (platform === 'win32') {
    const dir = env.APPDATA ?? join(paths.home, 'AppData', 'Roaming')
    return {
      path: join(dir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'stardeck.lnk'),
      lnk: { target: paths.nodePath, args: `"${paths.entryPath}"`, workdir: paths.home },
    }
  }
  if (platform === 'darwin') {
    // 非 win32 计划用 posix 拼接——纯函数可能在任意宿主上为目标平台生成（测试跨平台断言）。
    return { path: `${paths.home}/Applications/stardeck.command`, content: `#!/bin/bash\nexec ${JSON.stringify(paths.nodePath)} ${JSON.stringify(paths.entryPath)}\n` }
  }
  const dir = env.XDG_DATA_HOME ?? `${paths.home}/.local/share`
  return {
    path: `${dir}/applications/stardeck.desktop`,
    content: [
      '[Desktop Entry]',
      'Type=Application',
      'Name=stardeck',
      'Comment=agent 舰队的作战看板与守护进程',
      `Exec=${JSON.stringify(paths.nodePath)} ${JSON.stringify(paths.entryPath)}`,
      'Terminal=true',
      'Categories=Development;',
    ].join('\n') + '\n',
  }
}

/** 创建快捷方式（impure 执行面）。打包态入口=bin/stardeck.mjs；开发态（tsx 直跑
 *  src/cli.ts）返回 ok:false 教学错误——dev 不建快捷方式。 */
export function createShortcut(
  platform: NodeJS.Platform = process.platform,
  paths: { nodePath?: string; entryPath?: string; home?: string } = {},
): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = {
    nodePath: paths.nodePath ?? process.execPath,
    entryPath: paths.entryPath ?? resolve(process.argv[1] ?? ''),
    home: paths.home ?? homedir(),
  }
  if (!/stardeck\.mjs$/.test(resolved.entryPath)) {
    return { ok: false, error: '开发态（tsx 直跑 src/cli.ts）不建快捷方式——npm i -g stardeck 或构建后经 bin/stardeck.mjs 再 stardeck app' }
  }
  const plan = shortcutPlan(platform, resolved)
  try {
    mkdirSync(dirname(plan.path), { recursive: true })
    if (platform === 'win32' && plan.lnk !== undefined) {
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${plan.path}'); $s.TargetPath='${plan.lnk.target}'; $s.Arguments='${plan.lnk.args}'; $s.WorkingDirectory='${plan.lnk.workdir}'; $s.WindowStyle=7; $s.Save()`
      const run = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15_000 })
      if (run.status !== 0 || !existsSync(plan.path)) {
        return { ok: false, error: `PowerShell 建快捷方式失败（exit ${run.status}${run.stderr.toString().trim() !== '' ? `：${run.stderr.toString().trim().slice(0, 120)}` : ''}）` }
      }
      return { ok: true, path: plan.path }
    }
    writeFileSync(plan.path, plan.content ?? '', 'utf8')
    chmodSync(plan.path, 0o755)
    return { ok: true, path: plan.path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
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

/** connect [host]：一行接入代理舰长外接席（D30）。daemon 缺席时打包态自拉起。 */
async function cmdConnect(options: CliOptions): Promise<void> {
  const out = await runConnect(options.host ?? 'generic', {
    base: options.port !== undefined ? `http://127.0.0.1:${options.port}` : undefined,
    spawnDaemon: defaultSpawnDaemon(),
  })
  for (const line of out.lines) console.log(line)
  if (!out.ok) {
    console.error(`connect 失败：${out.error ?? '未知错误'}`)
    process.exitCode = 1
    return
  }
  console.log(`席位 ${out.seatId ?? '?'} 已签发。`)
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
// 两条非直接执行通路豁免见 bin/stardeck.mjs 的 STARDECK_BIN_ENTRY 转发标记。
// win32 路径归一（D30 安装版实测）：argv 给的可能是 junction 别名（C:\Users\…\Programs
// 指到 D 盘真身）而 import.meta.url 恒真身+盘符小写——realpath 归一后大小写不敏比较，
// 否则桌面壳（ELECTRON_RUN_AS_NODE）拉 daemon 静默退 0。
let entryHref = ''
try {
  entryHref = pathToFileURL(realpathSync(resolve(process.argv[1] ?? ''))).href
} catch {
  entryHref = pathToFileURL(resolve(process.argv[1] ?? '')).href
}
const isMain = process.env.STARDECK_BIN_ENTRY === '1' || (process.platform === 'win32'
  ? entryHref.toLowerCase() === import.meta.url.toLowerCase()
  : entryHref === import.meta.url)
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
      '用法：stardeck [start|open|app|connect|status|stop|codex-shim|version] [--port N] [--state-dir DIR] [--war-root DIR] [--model PROVIDER/MODEL] [--executor ID]',
      '  start 起 daemon（前台；就绪自动开浏览器，--no-open 关）；open 同 start 且强制开浏览器',
      '  app 建「点击即用」快捷方式（首跑自动建；--no-app 关）',
      '  connect [claude|zcode|opencode|codex] 一行接入代理舰长外接席（D30，缺省打印通用配置）',
      '  status 探活；stop 优雅停服',
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
  } else if (command === 'connect') {
    void cmdConnect(options)
  } else if (command === 'app') {
    const out = createShortcut()
    if (out.ok) {
      console.log(`已创建快捷方式：${out.path}——双击即达甲板。`)
      process.exitCode = 0
    } else {
      console.error(`快捷方式创建失败：${out.error}`)
      process.exitCode = 1
    }
  } else if (command !== 'start' && command !== 'open') {
    console.error(`未知命令：${command}（可用：start | open | app | connect | status | stop | codex-shim | version | help）`)
    process.exit(2)
  } else {
    runDaemon(command, options)
  }
}

/** 起 daemon（前台）+ 开箱面（D30：start 默认就绪后拉浏览器；首跑自动建快捷
 *  方式——配置文件缺席即首跑判据）+ 信号优雅关停。 */
function runDaemon(command: string, options: CliOptions): void {
  const firstRun = !existsSync(configFilePath())
  const handle = startDaemon(options)
  if (command === 'open' || !options.noOpen) waitHealthyAndOpen(handle.base)
  if (firstRun && !options.noApp) {
    const out = createShortcut()
    if (out.ok) console.log(`[stardeck] 首跑——已建快捷方式：${out.path}（下次双击图标即达；--no-app 关闭此行为）`)
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void handle.close().then(() => process.exit(0))
    })
  }
}
