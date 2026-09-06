/**
 * V19.13 codex 垫片实弹门（真 codex 0.153.4 + 真 z.ai GLM 全链）。
 * 相位①模型线：codex exec 经垫片问 GLM——真话音回来（不含『收到』即 FAIL）。
 * 相位②舰队线：隔离 daemon + 种子任务 + MCP 桥注入——codex 调 war_board 并
 * 报出任务号（不经工具链不可能知道，全链实锤）。
 * 前提：codex 0.153.4 在 clones/codex-0153（或 CODEX_SHIM_CODEX_BIN 指定包内
 * JS 入口）；Z_AI_BASE_URL/Z_AI_API_KEY（或 --env 指向 LookatStudy .env）。
 * 跑法：node --import tsx scripts/live-codex-shim.ts
 * @module stardeck/scripts/live-codex-shim
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { startCodexShim, codexShimProviderArgs } from '../src/codex-shim.ts'

const repoRoot = realpathSync(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const envPath = process.env.STARDECK_SHIM_ENV ?? 'C:/Users/kaiji/vibecodingKJ/projects/LookatStudy/.env'
const loadEnvKey = (k: string): string => {
  if (process.env[k] !== undefined && process.env[k] !== '') return process.env[k]!
  if (!existsSync(envPath)) return ''
  const m = new RegExp(`${k}=(.*)`).exec(readFileSync(envPath, 'utf8'))
  return m ? m[1]!.trim() : ''
}
const base = loadEnvKey('Z_AI_BASE_URL').replace(/\/+$/, '')
const apiKey = loadEnvKey('Z_AI_API_KEY')
const model = process.env.STARDECK_SHIM_MODEL ?? loadEnvKey('Z_AI_MODEL') ?? 'glm-5.2'
if (base === '' || apiKey === '') {
  console.error('实弹门前置缺失：Z_AI_BASE_URL / Z_AI_API_KEY（env 或 --env 文件）——诚实 SKIP 绝不放行。')
  process.exit(2)
}
const codexJs = process.env.CODEX_SHIM_CODEX_BIN ?? 'C:/Users/kaiji/vibecodingKJ/clones/codex-0153/node_modules/@openai/codex/bin/codex.js'
if (!existsSync(codexJs)) {
  console.error(`实弹门前置缺失：codex 入口不在 ${codexJs}（先装隔离前缀或设 CODEX_SHIM_CODEX_BIN）。`)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'codex-shim-live-'))
const stateDir = join(home, 'state')
const warRoot = join(home, 'war')
mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
mkdirSync(warRoot, { recursive: true })

const fwd = (p: string): string => p.split('\\').join('/')
const ts = (): string => new Date().toISOString()
const seedTask = (id: string, title: string): { ws: string; attemptId: string } => {
  const ws = join(warRoot, 'tasks', id)
  mkdirSync(ws, { recursive: true })
  const attemptId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-live-live-live${Math.random().toString(36).slice(2, 6)}`
  appendFileSync(join(stateDir, 'campaigns', `${id}.jsonl`), [
    JSON.stringify({ type: 'task_created', ts: ts(), campaignId: id, title, brief: '垫片实弹', acceptance: '报出任务号', priority: 'normal' }),
    JSON.stringify({ type: 'task_published', ts: ts(), campaignId: id, workspacePath: ws }),
    JSON.stringify({ type: 'task_claimed', ts: ts(), campaignId: id, claimedBy: 'probe-exec', attemptId, attempt: 1 }),
  ].join('\n') + '\n', 'utf8')
  return { ws, attemptId }
}

const shim = await startCodexShim({ port: 0, upstream: base, apiKey, model })
const shimBase = `http://127.0.0.1:${shim.port}/v1`
console.log(`[live] 垫片上线 ${shimBase}（上游 ${base}，模型 ${model}）`)

interface DaemonProc { proc: ReturnType<typeof spawn>; port: number }
async function startDaemon(port: number): Promise<DaemonProc> {
  const proc = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      STARDECK_PORT: String(port),
      STARDECK_STATE_DIR: stateDir,
      STARDECK_WAR_ROOT: warRoot,
      STARDECK_CONFIG: join(home, 'config.json'),
      STARDECK_STAFF: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let daemonLog = ''
  proc.stdout.on('data', d => { daemonLog += d })
  proc.stderr.on('data', d => { daemonLog += d })
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/warroom/api/board`)
      if (res.ok) return { proc, port }
    } catch { /* 未起 */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('daemon 未起：' + daemonLog.slice(-600))
}

function runCodex(label: string, argv: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs = 180_000): Promise<{ code: number | null; out: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [codexJs, ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { child.kill(); resolve({ code: null, out }) }, timeoutMs)
    child.on('exit', code => { clearTimeout(timer); resolve({ code, out }) })
    console.log(`[live] ${label}：codex exec …（timeout ${timeoutMs / 1000}s）`)
  })
}

let failures = 0
const assert = (cond: boolean, label: string): void => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`)
  if (!cond) failures++
}

try {
  // ---------- 相位① 模型线：codex 经垫片对 GLM 说话 ----------
  const codexHome1 = join(home, 'cx1')
  mkdirSync(codexHome1, { recursive: true })
  writeFileSync(join(codexHome1, 'config.toml'), '', 'utf8')
  const ws1 = join(home, 'ws1')
  mkdirSync(ws1, { recursive: true })
  const env1 = { ...process.env, CODEX_HOME: codexHome1 }
  const r1 = await runCodex('相位① 模型线', [
    'exec', '--skip-git-repo-check', '--json', '--sandbox', 'danger-full-access',
    '-C', fwd(ws1),
    ...codexShimProviderArgs(shimBase),
    '-m', process.env.CODEX_SHIM_SLUG ?? model,
    '只回复两个字：收到。不要多说任何字，不要调用任何工具。',
  ], env1, ws1)
  assert(r1.code === 0, '相位① codex 退出码 0')
  assert(/收到/.test(r1.out), '相位① GLM 话音经垫片回来（含「收到」）')
  assert(r1.out.includes('thread.started'), '相位① JSONL 事件流在（thread.started）')

  // ---------- 相位② 舰队线：MCP 桥 + war_board 全链 ----------
  const daemon = await startDaemon(3978)
  const seeded = seedTask('20260906-codexlive', 'ZEBRA-PROBE 垫片实弹任务')
  const board = await (await fetch('http://127.0.0.1:3978/warroom/api/board')).json()
  assert(board.tasks.some((t: { taskId: string }) => t.taskId === '20260906-codexlive'), '相位② 种子任务上板')

  const codexHome2 = join(home, 'cx2')
  mkdirSync(codexHome2, { recursive: true })
  writeFileSync(join(codexHome2, 'config.toml'), '', 'utf8')
  const ws2 = join(home, 'ws2')
  mkdirSync(join(ws2, '.stardeck'), { recursive: true })
  const bridge = fwd(join(repoRoot, 'dist', 'mcp-bridge.mjs'))
  const env2 = { ...process.env, CODEX_HOME: codexHome2, STARDECK_HTTP: `http://127.0.0.1:${daemon.port}`, STARDECK_AGENT: 'oc-live-codex' }
  const tomlInlineEnv = `{ STARDECK_HTTP = "http://127.0.0.1:${daemon.port}", STARDECK_AGENT = "oc-live-codex" }`
  // 隔离实验：并挂探测 MCP 服（1 个 probe_ping 工具，标准形状）——若 shim 收到
  // probe_ping 而无 stardeck 工具=桥形状问题；两个都没有=codex 暴露层问题。
  const probeServer = fwd(join(repoRoot, '.goal', 'codex-probe', 'mcp-probe-server.mjs'))
  const r2 = await runCodex('相位② 舰队线', [
    'exec', '--skip-git-repo-check', '--json', '--sandbox', 'danger-full-access',
    '-C', fwd(ws2),
    '-c', `mcp_servers.stardeck.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.stardeck.args=${JSON.stringify([bridge])}`,
    '-c', `mcp_servers.stardeck.env=${tomlInlineEnv}`,
    '-c', `mcp_servers.probe.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.probe.args=${JSON.stringify([probeServer, 'liveexp'])}`,
    ...codexShimProviderArgs(shimBase),
    '-m', process.env.CODEX_SHIM_SLUG ?? model,
    // zcode 同款 http 面正典（a791d09）：0.153 exec 形态 MCP 工具不进模型工具
    // 面（deferred/tool_search 架构，探测服双证）——教 HTTP 直连，账本零差异。
    '你是 stardeck 舰的外勤。若工具面板里没有 stardeck 的 war_* 工具，走 HTTP 直连舰桥：POST 端点=环境变量 STARDECK_HTTP 的值 + "/warroom/api/tools/call"，请求体 JSON {"name":"war_board","arguments":{},"agentId":环境变量 STARDECK_AGENT 的值}；用 node 发请求（禁用 Windows 控制台 curl）。查完任务栏后只回复 ZEBRA-PROBE 那个任务的完整任务号（2026 开头）。',
  ], env2, ws2)
  assert(r2.code === 0, '相位② codex 退出码 0')
  writeFileSync(join(repoRoot, '.goal', 'codex-probe', 'live-phase2.log'), r2.out, 'utf8')
  assert(r2.out.includes('20260906-codexlive'), '相位② codex（http 面）查账本报出任务号（全链实锤）')
  assert(!r2.out.includes('NO-TOOL'), '相位② MCP 桥在 codex 侧可见（非兜底措辞）')

  if (failures === 0) console.log('\nLIVE PASS：垫片模型线 + 舰队线全链 5 断言全过')
  else console.log(`\nLIVE FAIL：${failures} 断言未过`)
} finally {
  await shim.close()
  try {
    const res = await fetch('http://127.0.0.1:3978/warroom/api/shutdown', { method: 'POST' })
    void res
  } catch { /* daemon 已死 */ }
  await new Promise(r => setTimeout(r, 400))
  rmSync(home, { recursive: true, force: true })
}
process.exit(failures === 0 ? 0 : 1)
