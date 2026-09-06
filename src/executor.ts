/**
 * stardeck 执行者适配层：把「征召一名外勤」翻译成「框定并 spawn 一个
 * 无头 CLI agent 进程」——cwd=任务工作区 + 征召令简报（prompts.ts 正典
 * 组装）+ 工具面注入（stardeck 出口协议）。独立形态的控制范式：spawn
 * 框住世界，agent 经工具面回账交证（拉式），attemptId 即 capability。
 *
 * 三适配器（契约均自上游源码仓实证，2026-09-01 克隆至本机 projects/）：
 * - opencode：`run --auto` 一次性 + 项目级 opencode.json 注 MCP 桥（R0 实弹）；
 * - codex：`exec --json -C` 一次性 + 项目级 .codex/config.toml 注
 *   [mcp_servers.stardeck]（codex-rs/config/src/mcp_types.rs:323-329 字段实证；
 *   项目层 config_loader_tests.rs:2903 实证）；中途投递通道=`codex exec resume`；
 * - pi：`-p` 一次性（进程退出=完工，对齐「进程即生命」）+ 项目级
 *   .pi/extensions/stardeck-tools.ts 注册 war_claim/war_submit/war_fail
 *   （extensions.md：registerTool+typebox；安全面：无头须 --approve 放行
 *   项目扩展——security.md:29）。pi 无 MCP——扩展即它的集成面。中途投递
 *   通道=RPC 模式（rpc.md：prompt/steer/agent_settled，LF-JSONL）。
 * 大副（staff）不是执行者——spawnStaffAgent 走同一框定法，见 staff.ts。
 * @module stardeck/executor
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface as readlineCreateInterface } from 'node:readline'
import { commanderOrderFor } from './prompts.ts'
import { codexShimProviderArgs } from './codex-shim.ts'

/** MCP 桥的绝对路径（随包发布；dist 构建后与 daemon 同目录）。 */
export function mcpBridgePath(): string {
  const fromSrc = fileURLToPath(new URL('./mcp-bridge.mjs', import.meta.url))
  return fromSrc
}

export interface ExecutorSpawnArgs {
  taskId: string
  title: string
  acceptance: string
  workspacePath: string
  /** daemon 基址（工具面回连用）。 */
  http: string
  /** 执行者身份 id（写入账本 claimedBy 的 oc-* 串，由征召方生成）。 */
  agentId: string
  model: string
  /** codex 语义：spawn 时 `-c model_provider=<it>`（空=codex 自身默认）。 */
  modelProvider: string
  /** V19.13 codex 垫片基址（非空=codex 模型面走 Responses→chat 垫片，压过 modelProvider）。 */
  codexShimBase?: string
  executorBin: string
  stateDir: string
}

export interface ExecutorSession {
  agentId: string
  taskId: string
  child: ChildProcess
  logPath: string
  startedAt: number
  exitCode: number | null
}

export interface ExecutorAdapter {
  id: string
  /** 框定+spawn（写简报/注工具面/起进程/接管日志）。 */
  spawn(args: ExecutorSpawnArgs): Promise<ExecutorSession>
}

/** 征召令正文=正典 commanderOrderFor + stardeck 工具接入面（出口教学增量）。
 * face 决定接入面措辞：opencode/codex=经 MCP 桥；pi=经注入扩展（无 MCP）；
 * zcode=http 直连（无头不加载项目 MCP——2026-09-04 playground 实证）。 */
export function executorBrief(args: ExecutorSpawnArgs, face: 'mcp' | 'pi-extension' | 'http' = 'mcp'): string {
  const order = commanderOrderFor({
    maxUnits: 0,
    taskId: args.taskId,
    title: args.title,
    workspacePath: args.workspacePath,
    acceptance: args.acceptance,
    dossier: '',
  })
  const surface = face === 'mcp'
    ? '【stardeck MCP 接入面】本工作区已接入 stardeck MCP 服务（server 名 stardeck，war_* 工具全量可用）：'
    : face === 'http'
      ? '【stardeck 工具接入面】经 HTTP 直连舰桥（zcode/codex/dsh 无头形态不加载项目 MCP 或 MCP 工具不进模型面：若本进程工具面里没有 war_* 工具，一律走这条通道）：POST 端点=环境变量 STARDECK_HTTP 的值 + "/warroom/api/tools/call"；请求体 JSON：{"name":"<工具名>","arguments":{…},"agentId":环境变量 STARDECK_AGENT 的值}。必须用 node（process.execPath 或 node 脚本）发请求，恒 UTF-8——禁用 Windows 控制台 curl 拼 JSON（GBK 编码会把中文拼成乱码，乱码哨会拒收并打回重交）。'
      : '【stardeck 工具接入面】本工作区已由 stardeck 扩展注册 war_claim / war_submit / war_fail 工具（经 HTTP 回连舰桥，与 MCP 同名同义）：'
  return [
    order,
    '',
    surface,
    `- 你的外勤编号：${args.agentId}——调用任何 stardeck 工具/接口都必须以此身份（工具面板缺 war_* 时改用 HTTP 直连，请求体必须带 "agentId": "${args.agentId}"，否则账本记为无名氏）；`,
    '- 先 war_claim({task_id}) 领取任务，回执里的 attempt_id 是本次尝试令牌（完整保留，提交时原样携带、不要截断）；',
    '- 完成后 war_submit({task_id, attempt_id, report, evidence}) 交证。report 是给舰长的最终答复，不是过程日志（战报纪律）：①首句直接回答任务的问题（结论先行）；②关键发现/数据列点；③产物逐一给相对路径（如 `report.md`，只指路、不复述文件内容）；④有自然下一步就给一句；⑤不复述执行过程。evidence 必须是 JSON 字符串：{"checks":[{"item":"验收项","passed":true}],"tests":{"command":"你真实跑过的验证命令","exit_code":0,"passed":N,"failed":0},"files":["本次产出文件的相对路径"]}——checks 逐项核对验收标准；tests 命令必须真实跑过且退出码为 0；',
    '- 取证纪律（tests 必须有轨迹）：跑 tests 命令时把输出落到 .stardeck/evidence/tests.log（如 node script.js > .stardeck/evidence/tests.log 2>&1; echo $? >> .stardeck/evidence/tests.log——末尾追加一行退出码），war_submit 多带一个参数 tests_evidence=".stardeck/evidence/tests.log"——舰桥核对轨迹文件存在、mtime 晚于领取时刻且尾部退出码与自报一致。没有轨迹的 tests 声明不算验证（账本会标注，舰长重点盯）；轨迹相悖直接打回；',
    '- 修不动就 war_fail({task_id, attempt_id, reason}) 上报失败。舰桥核对的是证据的格式、边界与取证轨迹；内容真实性由舰长翻阅把关——自报与轨迹相悖会被打回重做，不要心存侥幸。',
  ].join('\n')
}

/** 按平台常见安装位探测 opencode 二进制（可被 config.executorBin 覆盖）。 */
export function detectOpencodeBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
  }
  return 'opencode'
}

/** codex 入口探测：win32 优先 npm 全局包的 JS 入口（.cmd 垫片不能裸 spawn
 * ——Node 安全补丁禁无 shell 跑 .cmd，首测确认）；再退 PATH。 */
export function detectCodexBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const jsEntry = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (existsSync(jsEntry)) return jsEntry
  }
  return 'codex'
}

/** pi 入口探测：同上——npm 全局包 JS 入口优先（dist/bundle/cli.js）。 */
export function detectPiBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const jsEntry = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
    if (existsSync(jsEntry)) return jsEntry
  }
  return 'pi'
}

/** spawn 一个 CLI 入口：JS 入口经 process.execPath 直跑（免 shell、免 .cmd
 * 垫片、参数零重组）；真实 exe 直接跑；win32 的 .cmd 垫片给教学错误。 */
function spawnCli(entry: string, argv: string[], opts: { cwd: string; stateDir: string; role: 'executor' | 'staff'; agentId: string; taskId: string; env?: NodeJS.ProcessEnv; onStdoutLine?: (line: string) => void }): ExecutorSession {
  if (/\.(js|mjs|cjs)$/.test(entry)) return spawnLogged(process.execPath, [entry, ...argv], opts)
  if (process.platform === 'win32' && /\.cmd$/i.test(entry)) {
    throw new Error(`执行者入口是 npm .cmd 垫片（${entry}）——不能无 shell 裸 spawn（参数会被重组）。请把 STARDECK_EXECUTOR_BIN 指到包内 JS 入口（如 node_modules/@openai/codex/bin/codex.js）或真实 exe。`)
  }
  return spawnLogged(entry, argv, opts)
}

// ---------- 工具面注入（③ bound 合并语义 + 各家集成面） ----------

/**
 * 项目级 opencode 配置注入（bound 合并语义，HANDOFF 迭代候选③）：
 * - 全新工作区（无 opencode.json）：直写 stardeck 桥配置；
 * - bound 工作区（已有 opencode.json）：逐键合并——只改 mcp.stardeck 一项，
 *   用户其余键原样保留；首次动手前把用户原件备份到
 *   .stardeck/opencode.json.pre-stardeck（只备一次，保最初原貌）；
 * - 已有文件不是合法 JSON：拒绝覆盖（stardeck 不毁用户配置），抛教学错误
 *   ——征召失败走任务排队/巡检补征，不静默丢配置。
 * 幂等：重复注入只刷新 mcp.stardeck（agentId/env 每次征召不同，必须可更新）。
 */
export function injectOpencodeMcp(workspacePath: string, args: { http: string; agentId: string }): void {
  const cfgPath = join(workspacePath, 'opencode.json')
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true }) // 备份落 .stardeck/ 下——独立调用也要自给自足
  const entry = {
    type: 'local',
    command: [process.execPath, mcpBridgePath()],
    environment: { STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
  }
  let existing: Record<string, unknown> | undefined
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8')
    try {
      existing = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      throw new Error(`工作区已有 opencode.json 但不是合法 JSON，stardeck 拒绝覆盖（不毁用户配置）：${err instanceof Error ? err.message : String(err)}——请先修复该文件，巡检会自动补征。`)
    }
    if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
      const backup = join(workspacePath, '.stardeck', 'opencode.json.pre-stardeck')
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
      const mcp = { ...((existing.mcp as Record<string, unknown> | undefined) ?? {}), stardeck: entry }
      writeFileSync(cfgPath, `${JSON.stringify({ ...existing, mcp }, null, 2)}\n`, 'utf8')
      return
    }
    existing = undefined // 数组/标量等异形：按无文件直写（不可能是用户的有效 opencode 配置）
  }
  writeFileSync(cfgPath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { stardeck: entry } }, null, 2)}\n`, 'utf8')
}

/** TOML 基本串：JSON 转义与 TOML 双引号串兼容（含 Windows 反斜杠路径）。 */
function tomlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * 项目级 codex 配置注入：.codex/config.toml 写 [mcp_servers.stardeck]
 * （字段实证：codex-rs/config/src/mcp_types.rs——command/args/env；项目层
 * 实证：config_loader_tests.rs:2903）。合并语义：只动 stardeck 一张表——
 * 已有同名表先整块摘除（表头行到下一顶格 [ 段头/EOF）再追加新表，其余
 * 用户内容字节不动；首动备份 .stardeck/config.toml.pre-stardeck。文本级
 * 操作不解析 TOML：用户文件若本身坏 TOML，codex 自会报错——诚实。
 */
export function injectCodexMcp(workspacePath: string, args: { http: string; agentId: string }): void {
  const cfgPath = join(workspacePath, '.codex', 'config.toml')
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true })
  mkdirSync(join(workspacePath, '.codex'), { recursive: true })
  const table = [
    '',
    '# stardeck 注入（征召时自动重写本表；工具面经 mcp-bridge 回连舰桥）',
    '[mcp_servers.stardeck]',
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(mcpBridgePath())}]`,
    `env = { STARDECK_HTTP = ${tomlString(args.http)}, STARDECK_AGENT = ${tomlString(args.agentId)} }`,
    '',
  ].join('\n')
  let existing = ''
  if (existsSync(cfgPath)) {
    existing = readFileSync(cfgPath, 'utf8')
    const backup = join(workspacePath, '.stardeck', 'config.toml.pre-stardeck')
    if (!existsSync(backup)) writeFileSync(backup, existing, 'utf8')
    // 摘除既有 [mcp_servers.stardeck] 整表（幂等重注入）。
    const lines = existing.split('\n')
    const kept: string[] = []
    let inStardeck = false
    for (const line of lines) {
      if (/^\[mcp_servers\.stardeck\]/.test(line.trim())) { inStardeck = true; continue }
      if (inStardeck && /^\[/.test(line)) inStardeck = false
      if (!inStardeck) kept.push(line)
    }
    existing = kept.join('\n').replace(/\n*$/, '\n')
  }
  writeFileSync(cfgPath, `${existing}${table}`, 'utf8')
}

/**
 * 项目级 pi 扩展注入：.pi/extensions/stardeck-tools.ts 注册
 * war_claim/war_submit/war_fail（pi 无 MCP——扩展即集成面；registerTool
 * 契约实证 extensions.md + extensions/types.ts:449）。身份经
 * STARDECK_HTTP/STARDECK_AGENT 环境变量回连（spawn 时注入进程环境）。
 * 每次征召整文件重写（机器产物，内容幂等）；首动若有同名异物备份一次。
 */
export function injectPiExtension(workspacePath: string, args: { http: string; agentId: string }, role: 'executor' | 'staff' = 'executor'): void {
  const dir = join(workspacePath, '.pi', 'extensions')
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true })
  const filePath = join(dir, 'stardeck-tools.ts')
  const body = role === 'staff' ? piStaffExtensionSource(args) : piExtensionSource(args)
  if (existsSync(filePath)) {
    const prev = readFileSync(filePath, 'utf8')
    if (prev !== body) {
      const backup = join(workspacePath, '.stardeck', 'pi-extension.pre-stardeck')
      if (!existsSync(backup)) writeFileSync(backup, prev, 'utf8')
    }
  }
  writeFileSync(filePath, body, 'utf8')
}

/** 注入的 pi 扩展源码（纯函数便于快照/测试；typebox 为 pi 扩展运行时自带导入）。 */
export function piExtensionSource(args: { http: string; agentId: string }): string {
  return `// stardeck 注入的执行者出口协议扩展（征召时自动重写——勿手改）。
// 工具经 daemon HTTP 面（/warroom/api/tools/call）回账交证；attemptId 即 capability，舰桥核证据的格式/边界/取证轨迹（内容真实性舰长翻阅把关）。
import { Type } from "typebox"

const HTTP = process.env.STARDECK_HTTP ?? ${JSON.stringify(args.http)}
const AGENT = process.env.STARDECK_AGENT ?? ${JSON.stringify(args.agentId)}

async function call(tool: string, toolArgs: Record<string, unknown>): Promise<string> {
  const res = await fetch(\`\${HTTP}/warroom/api/tools/call\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: tool, arguments: toolArgs, agentId: AGENT }),
  })
  const out = (await res.json()) as { ok?: boolean; result?: unknown; error?: string }
  return out.ok === true ? JSON.stringify(out.result) : \`工具失败：\${out.error ?? res.status}\`
}

export default function (pi: { registerTool: (tool: unknown) => void }) {
  pi.registerTool({
    name: "war_claim",
    label: "war_claim",
    description: "领取 stardeck 任务，回执含 attempt_id 令牌（提交/上报失败时原样携带，不要截断）。",
    promptSnippet: "war_claim: 领取 stardeck 任务拿 attempt_id 令牌",
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_toolCallId: string, params: { task_id: string }) {
      return { content: [{ type: "text" as const, text: await call("war_claim", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_submit",
    label: "war_submit",
    description: "交证：report 一段人话战报；evidence 必须是 JSON 字符串 {\\"checks\\":[{\\"item\\":\\"验收项\\",\\"passed\\":true}],\\"tests\\":{\\"command\\":\\"真实跑过的验证命令\\",\\"exit_code\\":0,\\"passed\\":N,\\"failed\\":0},\\"files\\":[\\"产出文件相对路径\\"]}，tests 另带 tests_evidence 指向 .stardeck/evidence/ 下的真实运行日志（尾部含退出码行）。舰桥核对格式、边界与轨迹；内容真实性由舰长翻阅把关——不要伪造。",
    promptSnippet: "war_submit: 按 evidence JSON 形交证，tests 附取证轨迹",
    parameters: Type.Object({
      task_id: Type.String(),
      attempt_id: Type.String(),
      report: Type.String(),
      evidence: Type.String(),
      tests_evidence: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: { task_id: string; attempt_id: string; report: string; evidence: string; tests_evidence?: string }) {
      return { content: [{ type: "text" as const, text: await call("war_submit", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_fail",
    label: "war_fail",
    description: "修不动就上报失败：reason 一句人话原因。",
    promptSnippet: "war_fail: 上报失败附人话原因",
    parameters: Type.Object({
      task_id: Type.String(),
      attempt_id: Type.String(),
      reason: Type.String(),
    }),
    async execute(_toolCallId: string, params: { task_id: string; attempt_id: string; reason: string }) {
      return { content: [{ type: "text" as const, text: await call("war_fail", params) }], details: {} }
    },
  })
}
`
}

// ---------- 无头框定（进程即生命） ----------

/** pi 大副扩展源码（纯；快照门 tests/staff-snapshots/pi-staff-extension.ts）。
 * 只注册大副侧动词——红线：禁注册 war_claim/war_submit/war_fail（出口协议
 * 只属执行者扩展；大副不是执行者，产出即账本）。 */
export function piStaffExtensionSource(args: { http: string; agentId: string }): string {
  return `// stardeck 注入的大副侧工具扩展（征召时自动重写——勿手改）。
// 工具经 daemon HTTP 面（/warroom/api/tools/call）回账；大副无 attemptId、
// 无 war_claim/war_submit——分诊/计划/发布即产出。与 MCP 桥同名同义。
import { Type } from "typebox"

const HTTP = process.env.STARDECK_HTTP ?? ${JSON.stringify(args.http)}
const AGENT = process.env.STARDECK_AGENT ?? ${JSON.stringify(args.agentId)}

async function call(tool: string, toolArgs: Record<string, unknown>): Promise<string> {
  const res = await fetch(\`\${HTTP}/warroom/api/tools/call\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: tool, arguments: toolArgs, agentId: AGENT }),
  })
  const out = (await res.json()) as { ok?: boolean; result?: unknown; error?: string }
  return out.ok === true ? JSON.stringify(out.result) : \`工具失败：\${out.error ?? res.status}\`
}

export default function (pi: { registerTool: (tool: unknown) => void }) {
  pi.registerTool({
    name: "war_board",
    label: "war_board",
    description: "战略任务栏：跨工作区查看全部任务与任务书全文。呈报/发布前先看板。",
    promptSnippet: "war_board: 看 stardeck 任务栏全局",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: Record<string, never>) {
      return { content: [{ type: "text" as const, text: await call("war_board", {}) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_triage",
    label: "war_triage",
    description: "大副接令第一轮报档位：L0 简单直发 | L1 复杂呈批 | L2 不明确先澄清。每命令只分诊一次。",
    promptSnippet: "war_triage: 报分诊档位 L0/L1/L2",
    parameters: Type.Object({
      command_id: Type.String(),
      grade: Type.String(),
      reason: Type.String(),
      confidence: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId: string, params: { command_id: string; grade: string; reason: string; confidence?: number }) {
      return { content: [{ type: "text" as const, text: await call("war_triage", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_plan",
    label: "war_plan",
    description: "L1/L2 呈计划草案待舰长批准（目标、≤5 步骤、工作区、风险与回退；批准前 war_publish 会被拦）。",
    promptSnippet: "war_plan: 呈一页纸计划待批",
    parameters: Type.Object({
      command_id: Type.String(),
      plan: Type.String(),
    }),
    async execute(_toolCallId: string, params: { command_id: string; plan: string }) {
      return { content: [{ type: "text" as const, text: await call("war_plan", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_publish",
    label: "war_publish",
    description: "发布任务书上任务栏（务必携带 commandId——发布后命令卡自动标记已批准）。L0 直发；L1/L2 计划批准后发布。",
    promptSnippet: "war_publish: 发布任务书（带 commandId）",
    parameters: Type.Object({
      title: Type.String(),
      brief: Type.String(),
      acceptance: Type.String(),
      priority: Type.Optional(Type.String()),
      quality: Type.Optional(Type.String()),
      deps: Type.Optional(Type.Array(Type.String())),
      cron: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      workspace: Type.Optional(Type.String()),
      commandId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: { title: string; brief: string; acceptance: string; [k: string]: unknown }) {
      return { content: [{ type: "text" as const, text: await call("war_publish", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_abandon_command",
    label: "war_abandon_command",
    description: "命令意图无法成案时废弃命令（附一句人话原因——慎用；已批准出任务的不能废）。",
    promptSnippet: "war_abandon_command: 废弃无法成案的命令",
    parameters: Type.Object({
      command_id: Type.String(),
      reason: Type.String(),
    }),
    async execute(_toolCallId: string, params: { command_id: string; reason: string }) {
      return { content: [{ type: "text" as const, text: await call("war_abandon_command", params) }], details: {} }
    },
  })
}
`
}

const PROMPT = 'Mission: read the file .stardeck/brief.md at the workspace root and execute it now. The stardeck tools (war_*) are already connected. Follow its exit protocol exactly — claim the task first, then do the work, then submit real evidence.'

export interface HeadlessAgentArgs {
  /** 框定工作区（简报与工具面注入都落在它名下；大副用 stateDir/staff）。 */
  workspacePath: string
  /** 落地简报正文（.stardeck/brief.md）。 */
  brief: string
  /** 会话标题（审计面）。 */
  title: string
  http: string
  agentId: string
  model: string
  executorBin: string
  stateDir: string
  /** 日志前缀角色（executor-…/staff-…）。 */
  role: 'executor' | 'staff'
  /** 首轮指令（缺省=读简报执行的正典 PROMPT）。 */
  prompt?: string
  /** 附着面：给执行者进程挂原生会话号捕获（写 attach-map.json）。大副不挂。 */
  attachTaskId?: string
  /** V19.13 codex 垫片基址（codex 席 GLM 直驱；余席忽略）。 */
  codexShimBase?: string
}

/** spawn 后接管日志/退场记账的共用段（三适配器与大副共用）。
 * onStdoutLine=附着面的行钩（opencode 事件流捕原生会话号用，逐行喂给回调）。 */
function spawnLogged(bin: string, argv: string[], opts: { cwd: string; stateDir: string; role: 'executor' | 'staff'; agentId: string; taskId: string; env?: NodeJS.ProcessEnv; onStdoutLine?: (line: string) => void }): ExecutorSession {
  const logDir = join(opts.stateDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `${opts.role}-${opts.agentId}.log`)
  const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd, windowsHide: true, env: opts.env })
  const session: ExecutorSession = { agentId: opts.agentId, taskId: opts.taskId, child, logPath, startedAt: Date.now(), exitCode: null }
  const log = createWriteStream(logPath, { flags: 'a' })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  if (opts.onStdoutLine !== undefined && child.stdout !== null) {
    readlineCreateInterface({ input: child.stdout }).on('line', opts.onStdoutLine)
  }
  const settle = (code: number | null): void => {
    if (session.exitCode === null) session.exitCode = code ?? -1
    log.close() // 进程退场即收流——常驻 daemon 下不泄 fd（Windows 还锁目录）
  }
  child.on('exit', settle)
  child.on('error', () => settle(-1))
  return session
}

/**
 * 无头 opencode agent 框定法（执行者与大副共用）：写简报 → 注 MCP 配置
 * （bound 合并语义）→ spawn（cwd=工作区）→ 接管日志。进程即生命——退出/
 * 报错都只记账，不做善后（巡检负责回收语义）。
 */
export async function spawnHeadlessOpencode(args: HeadlessAgentArgs): Promise<ExecutorSession> {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
  injectOpencodeMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
  const modelArgs = args.model !== '' ? ['--model', args.model] : []
  return spawnLogged(args.executorBin, [
    'run', ...modelArgs, '--auto', '--format', 'json', '--dir', args.workspacePath,
    '--title', args.title,
    args.prompt ?? PROMPT,
  ], {
    cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
    onStdoutLine: args.attachTaskId !== undefined
      ? opencodeSessionCapture({ stateDir: args.stateDir, taskId: args.attachTaskId, workspacePath: args.workspacePath })
      : undefined,
  })
}

/**
 * 无头 zcode agent 框定法（大副随舰队用；执行者走 zcodeAdapter）：写简报 →
 * 注 .mcp.json 桥（全量 war_*）→ spawn（node+.cjs 经 spawnCli）→ 接管日志。
 * 模型不透传——zcode 引擎吃自身 config 的 provider 条目（~/.zcode/cli/config.json）。
 * 会话号在 --json 尾包（进程收尾）才出：attachTaskId 捕获=事后可跳。
 */
export async function spawnHeadlessZcode(args: HeadlessAgentArgs): Promise<ExecutorSession> {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
  injectZcodeMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
  return spawnCli(args.executorBin, zcodePromptArgs({ prompt: args.prompt ?? PROMPT }),
    {
      cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
      env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
      onStdoutLine: args.attachTaskId !== undefined
        ? zcodeSessionCapture({ stateDir: args.stateDir, taskId: args.attachTaskId, workspacePath: args.workspacePath })
        : undefined,
    })
}

/**
 * 无头 pi agent 框定法（大副随舰队用；执行者走 piAdapter）：写简报 → 注
 * .pi/extensions/stardeck-tools.ts（role 定工具集：staff=大副侧动词，禁出口
 * 协议三件）→ spawn（--approve -p 一次性）。pi 无进程内会话号事件——大副会话
 * 由 daemon 在退场时惰性扫描 ~/.pi/agent/sessions 入 attach-map。
 */
export async function spawnHeadlessPi(args: HeadlessAgentArgs): Promise<ExecutorSession> {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
  injectPiExtension(args.workspacePath, { http: args.http, agentId: args.agentId }, args.role === 'staff' ? 'staff' : 'executor')
  return spawnCli(args.executorBin, piPrintArgs({ model: args.model, prompt: args.prompt ?? PROMPT }),
    {
      cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
      env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
    })
}

/**
 * 无头 claude agent 框定法（大副随舰队用；执行者走 claudeAdapter）：写简报 →
 * 注 .mcp.json 桥（与 zcode 同构）→ spawn（-p --output-format json）。
 * 鉴权透传 daemon 环境（ANTHROPIC_BASE_URL/AUTH_TOKEN 或用户原生 /login）；
 * 会话号在尾包（进程收尾）——attachTaskId 捕获=事后可跳。
 */
export async function spawnHeadlessClaude(args: HeadlessAgentArgs): Promise<ExecutorSession> {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
  injectZcodeMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
  return spawnCli(args.executorBin, claudePrintArgs({ model: args.model, prompt: args.prompt ?? PROMPT }),
    {
      cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
      env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
      onStdoutLine: args.attachTaskId !== undefined
        ? claudeSessionCapture({ stateDir: args.stateDir, taskId: args.attachTaskId, workspacePath: args.workspacePath })
        : undefined,
    })
}

/** codex 模型串归一（纯）：provider/id 形取 id（codex 吃裸模型 id；dsh 同款
 * 归一语义）。空串/裸 id 原样。 */
export function codexModelId(model: string): string {
  const idx = model.indexOf('/')
  return idx >= 0 ? model.slice(idx + 1) : model
}

/** codex 隔离 CODEX_HOME（V19.13）：用户 ~/.codex 可能带 0.44 时代 chat-wire
 *  provider（0.153 启动即硬拒）或其它与我们 -c 注入相冲的配置——stardeck 的
 *  codex spawn 一律指向工作区内自足的空 home（provider 经 -c 五旗注入，
 *  不读也不写用户 ~/.codex）。 */
export function codexHomeFor(workspacePath: string): string {
  const home = join(workspacePath, '.stardeck', 'codex-home')
  mkdirSync(home, { recursive: true })
  return home
}

/** codex 事件行→线程号（纯）：JSONL `thread.started` 首包的 thread_id（uuid 形，
 * 区别于 zcode 的 sess_ 与 opencode 的 ses_）。 */
export function codexThreadIdFromLine(line: string): string | null {
  const m = /"thread_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/.exec(line)
  return m !== null ? m[1]! : null
}

/** codex 线程号捕获器（行钩）：首中即写映射并闭锁（thread.started 在流首）。 */
export function codexSessionCapture(opts: { stateDir: string; taskId: string; workspacePath: string }): (line: string) => void {
  let done = false
  return (line: string) => {
    if (done) return
    const sessionId = codexThreadIdFromLine(line)
    if (sessionId === null) return
    done = true
    writeAttachMapEntry(opts.stateDir, opts.taskId, {
      executor: 'codex', sessionId, workspacePath: opts.workspacePath, capturedAt: new Date().toISOString(),
    })
  }
}

/**
 * 无头 codex 大副框定法（V19.13 双席正典）：写简报 → spawn（exec 一次性 +
 * shim provider 五旗 GLM 直驱）。工具通道=http 面教学（exec 形态 MCP 工具
 * 不进模型面——D21 双证，故不注 MCP 桥，简报 face=http）；win32 沙箱分野
 * 在 codexExecArgs 内。线程号行钩捕获入 attach-map（键=staff-<agentId>）。
 */
export function spawnHeadlessCodexStaff(args: HeadlessAgentArgs): ExecutorSession {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
    return spawnCli(args.executorBin, codexExecArgs({
      workspacePath: args.workspacePath, model: codexModelId(args.model), codexShimBase: args.codexShimBase, prompt: args.prompt ?? PROMPT,
    }), {
      cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
      env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId, CODEX_HOME: codexHomeFor(args.workspacePath) },
      onStdoutLine: args.attachTaskId !== undefined
        ? codexSessionCapture({ stateDir: args.stateDir, taskId: args.attachTaskId, workspacePath: args.workspacePath })
        : undefined,
    })
}

/** codex argv 构造（纯，测试管辖）：exec 一次性 + JSONL 事件流 + 工作区沙箱。
 * MCP 注入走 `-c` 命令行覆盖（**版本稳定通道**——0.44 等旧版不加载项目级
 * .codex/config.toml，首测确认；-c 覆盖全版本生效，值按 TOML 透传）。
 * 契约实证：codex-rs/exec/src/cli.rs（--json/--skip-git-repo-check）、
 * utils/cli/src/shared_options.rs（-C/--cd、-m、-s、-c 覆盖）。
 * 沙箱=workspace-write（写工作区免批；MCP 工具调用不经沙箱——桥进程自己回连）。 */
export function codexExecArgs(args: { workspacePath: string; model: string; modelProvider?: string; codexShimBase?: string; mcp?: { command: string; args: string[]; env: Record<string, string> }; prompt: string }): string[] {
  const mcp = args.mcp
  const tomlInlineEnv = (env: Record<string, string>): string => `{ ${Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }` // TOML 内联表（key = "v"）——JSON 冒号语法 codex 不认（复测确认）
  // V19.13 垫片优先：codexShimBase 非空=模型面走 Responses→chat 垫片（完整
  // provider 定义经 -c 注入——0.153.4 实弹直通；压过裸 modelProvider 直通）。
  const providerFlags = args.codexShimBase !== undefined && args.codexShimBase !== ''
    ? codexShimProviderArgs(args.codexShimBase)
    : (args.modelProvider !== undefined && args.modelProvider !== '' ? ['-c', `model_provider=${args.modelProvider}`] : [])
  // V19.13 沙箱实测分野：0.153 新 Windows 沙箱（restricted token）把
  // exec_command 全拦（实弹三连拒）——workspace-write 在 win32 等于废人；
  // stardeck 执行者本就与 opencode/pi 同级全权，win32 直言 danger-full-access。
  const sandbox = process.platform === 'win32' ? 'danger-full-access' : 'workspace-write'
  return [
    'exec', '--skip-git-repo-check', '--json', '--sandbox', sandbox,
    '-C', args.workspacePath,
    ...(mcp !== undefined ? [
      '-c', `mcp_servers.stardeck.command=${JSON.stringify(mcp.command)}`,
      '-c', `mcp_servers.stardeck.args=${JSON.stringify(mcp.args)}`,
      '-c', `mcp_servers.stardeck.env=${tomlInlineEnv(mcp.env)}`,
    ] : []),
    ...providerFlags,
    ...(args.model !== '' ? ['-m', args.model] : []),
    args.prompt,
  ]
}

/** pi argv 构造（纯，测试管辖）：-p 一次性（进程退出=完工）+ --approve 放行
 * 项目扩展（安全面契约：pi security.md:29——无头模式不弹信任框，--approve
 * 一次性放行）。cwd 由 spawn options 框定（pi 无 --cd 旗）。 */
export function piPrintArgs(args: { model: string; prompt: string }): string[] {
  return [
    '--approve', '-p',
    ...(args.model !== '' ? ['--model', args.model] : []),
    args.prompt,
  ]
}

/** opencode 适配器（R0 已验证全链）。 */
export const opencodeAdapter: ExecutorAdapter = {
  id: 'opencode',
  async spawn(args) {
    const session = await spawnHeadlessOpencode({
      workspacePath: args.workspacePath,
      brief: executorBrief(args),
      title: `stardeck:${args.taskId}`,
      http: args.http,
      agentId: args.agentId,
      model: args.model,
      executorBin: args.executorBin,
      stateDir: args.stateDir,
      role: 'executor',
      attachTaskId: args.taskId,
    })
    return { ...session, taskId: args.taskId }
  },
}

/**
 * codex 适配器：`codex exec` 一次性框定 + 项目级 .codex/config.toml 注
 * [mcp_servers.stardeck]。模型/鉴权=用户自己的 CODEX_HOME 配置职责
 * （stardeck 只透传 -m）；中途投递预留 `codex exec resume`（cli.rs:151）。
 */
export const codexAdapter: ExecutorAdapter = {
  id: 'codex',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    // V19.13：简报 face=http（exec 形态 MCP 工具不进模型面——注桥是死重，
    // 工具通道教 HTTP 直连，STARDECK_HTTP/AGENT env 直接挂 agent 进程）。
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args, 'http'), 'utf8')
    return spawnCli(args.executorBin, codexExecArgs({
      workspacePath: args.workspacePath, model: codexModelId(args.model), modelProvider: args.modelProvider, codexShimBase: args.codexShimBase, prompt: PROMPT,
    }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId, CODEX_HOME: codexHomeFor(args.workspacePath) },
        onStdoutLine: codexSessionCapture({ stateDir: args.stateDir, taskId: args.taskId, workspacePath: args.workspacePath }),
      })
  },
}

/**
 * pi 适配器：`pi -p` 一次性框定 + 项目级 .pi/extensions/stardeck-tools.ts
 * 注出口协议三工具（pi 无 MCP，扩展即集成面）。模型=pi 自身 provider 配置
 * （--model 支持 provider/id 形，config.model 直通）；中途投递预留 RPC 模式
 * （prompt/steer/agent_settled）。
 */
export const piAdapter: ExecutorAdapter = {
  id: 'pi',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args, 'pi-extension'), 'utf8')
    injectPiExtension(args.workspacePath, { http: args.http, agentId: args.agentId })
    return spawnCli(args.executorBin, piPrintArgs({ model: args.model, prompt: PROMPT }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
      })
  },
}


/** 执行者注册表（daemon 内存态——进程即生命，重启=全部视为失联走巡检回收）。 */
export class ExecutorRegistry {
  private readonly sessions = new Map<string, ExecutorSession>()

  register(session: ExecutorSession): void {
    this.sessions.set(session.agentId, session)
  }

  forgetTask(taskId: string): void {
    for (const [id, s] of this.sessions) if (s.taskId === taskId) this.sessions.delete(id)
  }

  live(): ExecutorSession[] {
    return [...this.sessions.values()].filter(s => s.exitCode === null && s.child.exitCode === null)
  }

  liveFor(taskId: string): ExecutorSession | undefined {
    return this.live().find(s => s.taskId === taskId)
  }

  anyFor(taskId: string): ExecutorSession | undefined {
    return [...this.sessions.values()].find(s => s.taskId === taskId)
  }

  /** P0-1 中途投递：领取者编号直查（批注转达定位会话用）。 */
  byAgent(agentId: string): ExecutorSession | undefined {
    return this.sessions.get(agentId)
  }

  spawned(): string[] {
    return [...this.sessions.keys()]
  }
}

// ═══ 附着面（attach face，2026-09-02）：/stardeck 召唤舰桥 + 板跳 TUI 会话 ═══
// 宿主前置形态（舰长定）：用户先开执行者 TUI，/stardeck 把舰桥附着上来；
// 板上点「进入会话」在终端拉起执行者 TUI 直达对应原生会话。考证记录见
// .goal/SPEC.md 附着面段（opencode --session / pi --session / codex resume）。

/** 跳转命令模板（纯）：与 jumpArgs 同构（测试锁死）。占位符 <会话号>。
 * zcode 引擎是应用内打包的 zcode.cjs（无 PATH 裸名）——argv 走 node+绝对路径，
 * 且无独立 TUI 分发（@zcode/tui 仅内嵌 SEA 形态，桌面版 node 引擎拿不到，
 * 2026-09-02 秒退实测+官网无 CLI 分发实证）——跳转=无头汇报模式。 */
export const JUMP_TEMPLATES: Record<string, string> = {
  opencode: 'opencode --session <会话号>',
  pi: 'pi --session <会话号>',
  codex: 'codex resume <会话号>',
  zcode: 'node zcode.cjs --resume <会话号> --prompt <视察汇报>',
  claude: 'claude --resume <会话号>',
  gemini: 'gemini --resume <会话号>',
  qwen: 'qwen --resume <会话号>',
  dsh: 'dsh --profile tui --resume <会话号>',
}

/** zcode 视察提示词：在原会话上下文里让外勤汇报（禁工具——只读现场）。 */
export const ZCODE_JUMP_PROMPT = '舰长进入会话视察。请只做汇报、不要调用任何工具：1) 本任务你做了什么（5 行以内）；2) 关键产出文件列表；3) 验证命令与结果。'

/** 跳转 argv（纯）：board 上「进入会话」钮 → daemon 拉终端时执行。
 * CLI 用裸名——在用户终端（cmd start）里跑，PATH 解析归 shell；程序化
 * spawn 才需要 JS 入口解析（spawnCli 纪律不适用此处）。zcode 例外：
 * 引擎无 PATH 裸名，argv[0]=node、argv[1]=探测到的 zcode.cjs 绝对路径；
 * 且无 TUI——--resume 原会话 + --prompt 视察汇报（--json 尾包落屏）。 */
export function jumpArgs(executor: string, sessionId: string): string[] {
  if (executor === 'pi') return ['pi', '--session', sessionId]
  if (executor === 'codex') return ['codex', 'resume', sessionId]
  if (executor === 'zcode') return ['node', detectZcodeBin(''), '--resume', sessionId, '--prompt', ZCODE_JUMP_PROMPT, '--json']
  if (executor === 'claude') return ['claude', '--resume', sessionId]
  if (executor === 'gemini') return ['gemini', '--resume', sessionId]
  if (executor === 'qwen') return ['qwen', '--resume', sessionId]
  if (executor === 'dsh') {
    const bin = detectDshBin('')
    if (bin.endsWith('.ts')) {
      const root = dshCloneRootOf(bin)
      return [process.execPath, '--import', pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href, bin, '--profile', 'tui', '--resume', sessionId]
    }
    return ['dsh', '--profile', 'tui', '--resume', sessionId]
  }
  return ['opencode', '--session', sessionId]
}

/** opencode 事件流行→原生会话号（纯）：--format json 每行事件携带
 * "sessionID":"ses_…"（1.18.5 实测）。 */
export function opencodeSessionIdFromLine(line: string): string | null {
  const m = /"sessionID":"(ses_[A-Za-z0-9]+)"/.exec(line)
  return m !== null ? m[1]! : null
}

/** attach-map.json 读写（stateDir 侧账，不碰 events fold——账本零分叉）。 */
export interface AttachEntry { executor: string; sessionId: string; workspacePath: string; capturedAt: string }

function attachMapPath(stateDir: string): string {
  return join(stateDir, 'attach-map.json')
}

export function readAttachMap(stateDir: string): Record<string, AttachEntry> {
  try {
    const raw = JSON.parse(readFileSync(attachMapPath(stateDir), 'utf8')) as Record<string, AttachEntry>
    return raw !== null && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function writeAttachMapEntry(stateDir: string, taskId: string, entry: AttachEntry): void {
  const map = readAttachMap(stateDir)
  map[taskId] = entry
  writeFileSync(attachMapPath(stateDir), JSON.stringify(map, null, 2), 'utf8')
}

/** opencode 原生会话号捕获器（行钩）：首次命中 ses_ 号即写映射并闭锁。 */
export function opencodeSessionCapture(opts: { stateDir: string; taskId: string; workspacePath: string }): (line: string) => void {
  let done = false
  return (line: string) => {
    if (done) return
    const sessionId = opencodeSessionIdFromLine(line)
    if (sessionId === null) return
    done = true
    writeAttachMapEntry(opts.stateDir, opts.taskId, {
      executor: 'opencode', sessionId, workspacePath: opts.workspacePath, capturedAt: new Date().toISOString(),
    })
  }
}

/** pi 会话目录（纯，镜像 pi-mono session-manager.ts getDefaultSessionDirPath）：
 * ~/.pi/agent/sessions/--<cwd 斜杠冒号全换->>--。 */
export function piSessionDirFor(cwd: string, agentDir?: string): string {
  const resolved = cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')
  const base = agentDir ?? join(homedir(), '.pi', 'agent')
  return join(base, 'sessions', `--${resolved}--`)
}

/** pi 原生会话号惰性捕获：扫会话目录最新 .jsonl（<时间戳>_<uuid>.jsonl），
 * mtime 晚于 minMtimeMs 才认。执行中/收工后都可调（jump 端点兜底用）。 */
export function piLatestSessionId(sessionDir: string, minMtimeMs = 0): string | null {
  let best: { file: string; mtime: number } | null = null
  let entries: string[]
  try {
    entries = readdirSync(sessionDir)
  } catch {
    return null
  }
  for (const file of entries) {
    if (!file.endsWith('.jsonl') || !file.includes('_')) continue
    const full = join(sessionDir, file)
    let mtime = 0
    try {
      mtime = statSync(full).mtimeMs
    } catch {
      continue
    }
    if (mtime < minMtimeMs) continue
    // 双键定新：mtime 平局（同毫秒写入）按文件名收尾——文件名内嵌时间戳，字典序即时间序。
    if (best === null || mtime > best.mtime || (mtime === best.mtime && file > best.file)) best = { file, mtime }
  }
  if (best === null) return null
  const base = best.file.slice(0, -'.jsonl'.length)
  return base.slice(base.lastIndexOf('_') + 1) || null
}

/** 终端拉起命令构造（纯）：win32=cmd start 起新终端窗（cwd 交给 /D）；
 * keepOpen=cmd /k 包裹——进程退出后窗口留屏（zcode 无 TUI 的汇报模式跑完
 * 即退，不留窗看不到内容）；TUI 形态（opencode/pi/codex）不需要——用户
 * 主动退 TUI 即关窗。非 win32 契约面（教学错误——本机 win32 实弹）。 */
export function buildTerminalCommand(cwd: string, argv: string[], keepOpen = false): { file: string; args: string[] } {
  if (process.platform !== 'win32') {
    throw new Error('附着终端拉起现只实装 win32（cmd start）；其余平台契约在档待征——可手动在任务工作区运行: ' + argv.join(' '))
  }
  // start 语法：start [/D path] command args。标题位只认**带引号**的首参——
  // 首弹传了裸 'stardeck' 被 start 当成程序名（「找不到文件 stardeck」实测）。
  // 命令首参是裸名（node/opencode/pi 等，无空格不落引号），无标题位吞噬风险。
  return keepOpen
    ? { file: 'cmd.exe', args: ['/c', 'start', '/D', cwd, 'cmd', '/k', ...argv] }
    : { file: 'cmd.exe', args: ['/c', 'start', '/D', cwd, ...argv] }
}

/** opencode 召唤件：.opencode/command/stardeck.md（TUI 内 /stardeck 触发）。 */
export function opencodeSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: '.opencode/command/stardeck.md',
    content: [
      '---',
      'description: 召唤 stardeck 舰桥（作战看板）',
      '---',
      `舰长要召唤 stardeck 舰桥。逐步执行，不要跳步：`,
      `1. 用 shell 探测舰桥是否在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board（200 即在线）。`,
      `2. 在线：用 shell 打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"；Linux: xdg-open "${args.boardUrl}/"），然后只回复「舰桥已开启：<url>」。`,
      `3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。`,
    ].join('\n'),
  }
}

/** pi 召唤件：.pi/extensions/stardeck-summon.ts（扩展命令，registerCommand）。 */
export function piSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: '.pi/extensions/stardeck-summon.ts',
    content: [
      '/**',
      ` * stardeck 舰桥召唤命令（由 stardeck 生成）：TUI 内 /stardeck 触发。`,
      ` * 探测舰桥在线 → 开浏览器；不在线给诚实指引。`,
      ` * 跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.pi}。`,
      ' */',
      `const BOARD = "${args.boardUrl}"`,
      '',
      'export default function (pi: { registerCommand: (name: string, cmd: { description: string; handler: (args: string[], ctx: { ui: { notify: (msg: string, level?: string) => void } }) => Promise<void> }) => void }) {',
      '  pi.registerCommand("stardeck", {',
      '    description: "召唤 stardeck 舰桥（作战看板）",',
      '    handler: async (_args, ctx) => {',
      '      const online = await fetch(BOARD + "/warroom/api/board", { method: "GET" }).then((r) => r.ok).catch(() => false)',
      '      const { exec } = await import("node:child_process")',
      '      if (online) {',
      '        if (process.platform === "win32") exec(`start "" "${BOARD}/"`)',
      '        else if (process.platform === "darwin") exec(`open "${BOARD}/"`)',
      '        else exec(`xdg-open "${BOARD}/"`)',
      '        ctx.ui.notify(`舰桥已开启：${BOARD}`)',
      '      } else {',
      '        ctx.ui.notify("舰桥 daemon 未启动——先在 stardeck 仓库运行 pnpm start（默认 ' + args.boardUrl + '）", "warning")',
      '      }',
      '    },',
      '  })',
      '}',
    ].join('\n'),
  }
}

/** codex 召唤件（契约面，实弹零触碰）：~/.codex/prompts/stardeck.md。
 * 版本敏感：custom prompts 机制 churn（0.117 回归 openai/codex#15939/#15941，
 * 上游转向 /skill 体系）——文件自带适用性注记。 */
export function codexSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: 'prompts/stardeck.md',
    content: [
      '<!-- 适用性注记：codex custom prompts 机制版本敏感（0.117 起 /stardeck 可能不再出现在斜杠菜单，',
      '      见 openai/codex#15939 #15941；上游正转向 /skill 体系）。若失效请按当时版本机制重装。 -->',
      '召唤 stardeck 舰桥（作战看板）。执行：',
      `1. 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board。`,
      `2. 在线：打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"），回复「舰桥已开启」。`,
      '3. 不在线：回复「舰桥 daemon 未启动」+ 本机 stardeck 仓库启动方式（pnpm start）。不要伪造成功。',
      `跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.codex}。`,
    ].join('\n'),
  }
}

// ═══ zcode 适配器（第四舰队，2026-09-02）═══
// 引擎=ZCode 桌面应用内打包的 zcode.cjs（Electron resources/glm/，无 PATH 裸名）。
// 无头=`--prompt <text> --json`（--prompt 缺省 yolo 权限模式——无人值守即所需）。
// 工具面=项目级 .mcp.json（源码实证 rootPath 下加载，与 Claude 同款机制）。
// 会话号=--json 尾包 "sessionId":"sess_…"（0.16.5 实测）。模型/授权=用户
// config 的 provider 条目（anthropic kind + api/anthropic + key，桌面同款形状）。

/** zcode 入口探测：win32 优先桌面应用内打包引擎（绝对 .cjs，spawnCli 经 node）；其余退 PATH。 */
export function detectZcodeBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const bundled = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs')
    if (existsSync(bundled)) return bundled
  }
  return 'zcode'
}

/** zcode argv 构造（纯，测试管辖）：--prompt 值形（-p 布尔遇首字符 '-' 的
 * 位置歧义，实测三撞）+ --json 尾包（sessionId 字段）。 */
export function zcodePromptArgs(args: { prompt: string }): string[] {
  return ['--prompt', args.prompt, '--json']
}

/** zcode 事件行→原生会话号（纯）：--json 尾包字段。 */
export function zcodeSessionIdFromLine(line: string): string | null {
  const m = /"sessionId"\s*:\s*"(sess_[A-Za-z0-9-]+)"/.exec(line)
  return m !== null ? m[1]! : null
}

/** zcode 原生会话号捕获器（行钩）：首中即写映射并闭锁。 */
export function zcodeSessionCapture(opts: { stateDir: string; taskId: string; workspacePath: string }): (line: string) => void {
  let done = false
  return (line: string) => {
    if (done) return
    const sessionId = zcodeSessionIdFromLine(line)
    if (sessionId === null) return
    done = true
    writeAttachMapEntry(opts.stateDir, opts.taskId, {
      executor: 'zcode', sessionId, workspacePath: opts.workspacePath, capturedAt: new Date().toISOString(),
    })
  }
}

/**
 * 项目级 zcode 工具面注入：工作区根 .mcp.json（zcode 源码实证 rootPath 下
 * 加载，Claude 同款 mcpServers 机制）。合并语义同 opencode 注入器：逐键合并
 * 只动 mcpServers.stardeck 一项，首动备份 .stardeck/mcp.json.pre-stardeck，
 * 坏 JSON 拒绝覆盖。
 */
export function injectZcodeMcp(workspacePath: string, args: { http: string; agentId: string }): void {
  const cfgPath = join(workspacePath, '.mcp.json')
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true })
  const entry = {
    type: 'stdio',
    command: process.execPath,
    args: [mcpBridgePath()],
    env: { STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
  }
  let existing: Record<string, unknown> | undefined
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8')
    try {
      existing = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      throw new Error(`工作区已有 .mcp.json 但不是合法 JSON，stardeck 拒绝覆盖（不毁用户配置）：${err instanceof Error ? err.message : String(err)}——请先修复该文件，巡检会自动补征。`)
    }
    if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
      const backup = join(workspacePath, '.stardeck', 'mcp.json.pre-stardeck')
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
      const servers = { ...((existing.mcpServers as Record<string, unknown> | undefined) ?? {}), stardeck: entry }
      writeFileSync(cfgPath, `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`, 'utf8')
      return
    }
    existing = undefined
  }
  writeFileSync(cfgPath, `${JSON.stringify({ mcpServers: { stardeck: entry } }, null, 2)}\n`, 'utf8')
}

/** zcode 召唤件：用户级 skill（~/.zcode/skills/stardeck/SKILL.md）——
 * zcode 斜杠命令即 skill（commands list 实证 plugin commands md 同机制）。 */
export function zcodeSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: 'skills/stardeck/SKILL.md',
    content: [
      '---',
      'name: stardeck',
      'description: 召唤 stardeck 舰桥（作战看板）——探测舰桥在线并打开浏览器；不在线给诚实指引。',
      '---',
      '# 召唤 stardeck 舰桥',
      '',
      '按序执行，不要跳步：',
      `1. 用 shell 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board（200 即在线）。`,
      `2. 在线：用 shell 打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"；Linux: xdg-open "${args.boardUrl}/"），然后只回复「舰桥已开启：<url>」。`,
      '3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。',
      '',
      `跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.zcode}。`,
    ].join('\n'),
  }
}

/** zcode 适配器（第四舰队）：--prompt 一次性框定 + 项目级 .mcp.json 注桥 +
 * 会话号捕获（attachTaskId 在场时挂行钩）。模型/授权=用户 config 的 provider
 * 条目（桌面同款形状，见 .goal/SPEC.md 附着面段）。 */
export const zcodeAdapter: ExecutorAdapter = {
  id: 'zcode',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    // http 面（critique 实抓）：zcode 无头不加载项目 .mcp.json——简报不再谎称
    // MCP 已连接，改教 HTTP 直连通道（node + UTF-8 纪律）。
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args, 'http'), 'utf8')
    injectZcodeMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
    return spawnCli(args.executorBin, zcodePromptArgs({ prompt: PROMPT }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
        onStdoutLine: zcodeSessionCapture({ stateDir: args.stateDir, taskId: args.taskId, workspacePath: args.workspacePath }),
      })
  },
}

// ═══ 第七舰队 dsh（2026-09-05，血统回归：宿主变外勤）═══
// dsh=DeepSeek Harness（本仓插件形态的宿主）。无头=`--profile headless "<任务>"`
//（apps/cli/src/bin.ts；官方契约：one task, prints the final assistant text,
// and exits——2026-09-05 实弹 z.ai GLM 网关首弹即通）。四件要害（源码+实弹双证）：
//   - 模型路由：dsh 固定 deepseek 目录且无 env 覆盖——stardeck 自带 --patch
//     外挂层（agent-default-model→GLM），不碰用户 ~/.dsh 任何配置；
//   - 工具面：dsh 无 MCP 配置面（全仓仅 ACP 包）——简报走 http 教学面（zcode
//     正典：STARDECK_HTTP + node/UTF-8 纪律）；
//   - 模块解析：源码仓 bin.ts 依赖 tsconfig paths——spawn 时带
//     TSX_TSCONFIG_PATH=<clone>/tsconfig.json + 绝对 tsx loader（与 cwd 解耦，
//     任务工作区无 node_modules 也能起；2026-09-05 实弹验证）；
//   - 会话存储：stdout 不吐会话号（JSONL 流为测试设施非支持格式）——退场惰扫
//     ~/.dsh/sessions/<projectKey(cwd)>/session-<uuid>/（编码规则=format.ts
//     projectKey 字节级复刻）；存档=session.jsonl.zstd（多帧 zstd，node:zlib
//     公开 API 可解，history.ts 读取器管）。

/** dsh 入口探测：configured 优先；缺省扫本机源码仓克隆（bin.ts 绝对路径，
 * spawn 时经 node+tsx loader）；再退 PATH 裸名。 */
export function detectDshBin(configured: string): string {
  if (configured !== '') return configured
  const cloned = join(homedir(), 'vibecodingKJ', 'clones', 'deepseek-ai', 'deepseek-harness', 'apps', 'cli', 'src', 'bin.ts')
  if (existsSync(cloned)) return cloned
  return 'dsh'
}

/** dsh 源码仓根（bin.ts 上跳四级：apps/cli/src/bin.ts → 仓根）。 */
export function dshCloneRootOf(binTs: string): string {
  return resolve(dirname(dirname(dirname(dirname(binTs)))))
}

/** dsh 模型串归一：provider/id 形取 id 段；空/缺省 glm-5.2（z.ai 网关正典）。 */
export function dshModelId(model: string): string {
  const id = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model
  return id.trim() !== '' ? id.trim() : 'glm-5.2'
}

/** dsh --patch 外挂层内容（纯，测试管辖）：agent-default-model 路由 GLM +
 * llm-deepseek 模型目录补条目——**maxTokens 必须显式**（catalog 缺条目时
 * provider 默认 max_tokens 非法，z.ai 网关拒收「限制[1,131072]」，2026-09-05
 * 实弹抓的坑）；128000/8192 为实弹实证组合。 */
export function dshPatchYml(model: string): string {
  return `# stardeck 外挂层：headless 外勤席位模型路由（随任务工作区走，不动 ~/.dsh）\n- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: ${dshModelId(model)}\n- id: llm-deepseek\n  config:\n    models:\n      - id: ${dshModelId(model)}\n        name: ${dshModelId(model)}\n        contextWindow: 128000\n        maxTokens: 8192\n`
}

/** dsh 无头 argv（纯，测试管辖）：node + 绝对 tsx loader（win32 须 file://
 * URL——裸 C:\ 会被当 'c:' 协议）+ bin.ts + profile headless + --patch 外挂
 * + 任务正文（尾部位置参数）。 */
export function dshHeadlessArgs(args: { cloneRoot: string; binTs: string; patchPath: string; prompt: string }): string[] {
  return [
    '--import', pathToFileURL(join(args.cloneRoot, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href,
    args.binTs, '--profile', 'headless', '--patch', args.patchPath,
    args.prompt,
  ]
}

/** dsh 工作区目录键（纯，字节级复刻 dsh format.ts projectKey）：分隔符折叠成
 * 单 `-`，安全字符直通，其余 ~XXXX 转义；去前导、251 上限、`--…--` 包裹。 */
export function dshProjectKey(cwd: string): string {
  let readable = ''
  let run = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!run) readable += '-'
      run = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      run = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      run = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** dsh 会话惰扫（退场时调）：~/.dsh/sessions/<projectKey>/ 下 mtime≥起跑的
 * 最新 session-<uuid> 目录——stdout 无会话号，这是唯一捕获路（pi 同款惰性）。 */
export function dshLatestSessionId(workspacePath: string, minMtime: number, root = join(homedir(), '.dsh', 'sessions')): string | null {
  const dir = join(root, dshProjectKey(workspacePath))
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  let best: { id: string; mtime: number } | null = null
  for (const e of entries) {
    if (!e.startsWith('session-')) continue
    try {
      const st = statSync(join(dir, e))
      if (st.mtimeMs < minMtime) continue
      if (best === null || st.mtimeMs > best.mtime) best = { id: e, mtime: st.mtimeMs }
    } catch { /* race: 目录被清 */
    }
  }
  return best !== null ? best.id : null
}

/** 无头 dsh agent 框定法（执行者与大副共用）：写简报（http 面）→ 写 --patch
 * 外挂层 → spawn（node+tsx loader，cwd=工作区）→ 退场惰扫会话入 attach-map。 */
export async function spawnHeadlessDsh(args: HeadlessAgentArgs): Promise<ExecutorSession> {
  mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
  writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), args.brief, 'utf8')
  const patchPath = join(args.workspacePath, '.stardeck', 'dsh-model.yml')
  writeFileSync(patchPath, dshPatchYml(args.model ?? ''), 'utf8')
  const binTs = args.executorBin
  const isSourceEntry = binTs.endsWith('.ts')
  const env: NodeJS.ProcessEnv = { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId }
  // 网关映射：DEEPSEEK_* 优先；缺席时 Z_AI_*（本机 GLM 网关正典）补位。
  if (env.DEEPSEEK_API_KEY === undefined && process.env.Z_AI_API_KEY !== undefined) env.DEEPSEEK_API_KEY = process.env.Z_AI_API_KEY
  if (env.DEEPSEEK_BASE_URL === undefined && process.env.Z_AI_BASE_URL !== undefined) env.DEEPSEEK_BASE_URL = process.env.Z_AI_BASE_URL
  const session = isSourceEntry
    ? spawnCli(process.execPath, dshHeadlessArgs({ cloneRoot: dshCloneRootOf(binTs), binTs, patchPath, prompt: args.prompt ?? PROMPT }),
        {
          cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
          env: { ...env, TSX_TSCONFIG_PATH: join(dshCloneRootOf(binTs), 'tsconfig.json') },
        })
    : spawnCli(binTs, ['--profile', 'headless', '--patch', patchPath, args.prompt ?? PROMPT],
        {
          cwd: args.workspacePath, stateDir: args.stateDir, role: args.role, agentId: args.agentId, taskId: '',
          env,
        })
  // 退场惰扫：dsh stdout 无会话号——进程收尾后按 projectKey 反查（执行者/
  // 大副统一经 attachTaskId 给附着键，与 zcode 行钩/pi 惰扫同款账法）。
  if (args.attachTaskId !== undefined && args.attachTaskId !== '') {
    const startedAt = Date.now()
    session.child.on('exit', () => {
      const sid = dshLatestSessionId(args.workspacePath, startedAt - 5_000)
      if (sid !== null) {
        writeAttachMapEntry(args.stateDir, args.attachTaskId!, { executor: 'dsh', sessionId: sid, workspacePath: args.workspacePath, capturedAt: new Date().toISOString() })
      }
    })
  }
  return session
}

/** dsh 适配器（第七舰队）：http 教学面 + 模型外挂层 + 惰扫捕获。 */
export const dshAdapter: ExecutorAdapter = {
  id: 'dsh',
  async spawn(args) {
    return spawnHeadlessDsh({
      workspacePath: args.workspacePath,
      brief: executorBrief(args, 'http'),
      title: args.title,
      http: args.http,
      agentId: args.agentId,
      stateDir: args.stateDir,
      role: 'executor',
      model: args.model,
      executorBin: args.executorBin,
      attachTaskId: args.taskId,
      prompt: PROMPT,
    })
  },
}

// ═══ 第五/六舰队（2026-09-02 定案「扩充舰队支持广度」）═══
// claude（Anthropic Claude Code 2.1.258）：已验证——`claude -p --output-format
// json` 无头一次性（尾包 session_id/result），项目级 `.mcp.json` 与 zcode 同构
// （Claude 同款 mcpServers 机制），`claude --resume <会话号>` 回会话，会话
// JSONL 落 ~/.claude/projects/（历史弹窗零 token 读档）。鉴权双路：原生
// `claude /login`（订阅）或 env ANTHROPIC_BASE_URL+ANTHROPIC_AUTH_TOKEN 走
// anthropic 兼容网关（本机实证 z.ai/api/anthropic + GLM，首弹即通）。
// gemini（Google Gemini CLI 0.58）：契约实验性（本机无 GEMINI_API_KEY）——
// `-p` 无头与 `.gemini/settings.json` mcpServers、`--resume`、自定义命令
// `.gemini/commands/*.toml`（prompt 必填/description 可选，bundle 源码实证）
// 全部在档；0.58 无 --output-format → 无进程内会话号捕获（实验性诚实降级）。

/** claude 入口探测：win32 优先 npm 全局包内原生 exe（bin/claude.exe 直接
 * spawn——原生二进制不走 .cmd 垫片）；其余退 PATH。 */
export function detectClaudeBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const exe = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(exe)) return exe
  }
  return 'claude'
}

/** gemini 入口探测：win32 优先 npm 全局包内 JS 入口（经 node 直跑）；其余退 PATH。 */
export function detectGeminiBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const js = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')
    if (existsSync(js)) return js
  }
  return 'gemini'
}

/** claude argv 构造（纯，测试管辖）：-p 一次性 + --output-format json 尾包 +
 * --dangerously-skip-permissions（无头免批——claude -p 默认权限模式拒一切工具
 * 调用与写盘，外勤会诚实罢工；与 opencode --auto / pi --approve / zcode yolo
 * 同语义：隔离任务工作区内放行。首测确认：不挂该旗则「No claim token
 * exists. Nothing fabricated.」巡检无脑重派）。 */
export function claudePrintArgs(args: { model: string; prompt: string }): string[] {
  return [...(args.model !== '' ? ['--model', args.model] : []), '-p', args.prompt, '--output-format', 'json', '--dangerously-skip-permissions']
}

/** gemini argv 构造（纯，测试管辖）：-p 一次性（0.58 无 --output-format）；
 * -m 模型串透传（0.58 bundle 实证短形；留空=沿用 gemini 自身默认）。 */
export function geminiPrintArgs(args: { model: string; prompt: string }): string[] {
  return [...(args.model !== '' ? ['-m', args.model] : []), '-p', args.prompt]
}

/** claude 事件行→原生会话号（纯）：--output-format json 尾包 session_id 字段
 *（uuid 形，区别于 zcode 的 sess_ 前缀与 opencode 的 ses_）。 */
export function claudeSessionIdFromLine(line: string): string | null {
  const m = /"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/.exec(line)
  return m !== null ? m[1]! : null
}

/** claude 原生会话号捕获器（行钩）：首中即写映射并闭锁（尾包在进程收尾）。 */
export function claudeSessionCapture(opts: { stateDir: string; taskId: string; workspacePath: string }): (line: string) => void {
  let done = false
  return (line: string) => {
    if (done) return
    const sessionId = claudeSessionIdFromLine(line)
    if (sessionId === null) return
    done = true
    writeAttachMapEntry(opts.stateDir, opts.taskId, {
      executor: 'claude', sessionId, workspacePath: opts.workspacePath, capturedAt: new Date().toISOString(),
    })
  }
}

/** gemini 工具面注入：`.gemini/settings.json` 的 mcpServers.stardeck（逐键合并
 * 只动本项；坏 JSON 拒绝覆盖——与 opencode/zcode 注入器同一纪律）。 */
export function injectGeminiMcp(workspacePath: string, args: { http: string; agentId: string }): void {
  const cfgPath = join(workspacePath, '.gemini', 'settings.json')
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true })
  const entry = { command: process.execPath, args: [mcpBridgePath()], env: { STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId } }
  let existing: Record<string, unknown> | undefined
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8')
    try {
      existing = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      throw new Error(`工作区已有 .gemini/settings.json 但不是合法 JSON，stardeck 拒绝覆盖（不毁用户配置）：${err instanceof Error ? err.message : String(err)}——请先修复该文件。`)
    }
    if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
      const backup = join(workspacePath, '.stardeck', 'gemini-settings.pre-stardeck')
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
      const servers = { ...((existing.mcpServers as Record<string, unknown> | undefined) ?? {}), stardeck: entry }
      writeFileSync(cfgPath, `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`, 'utf8')
      return
    }
    existing = undefined
  }
  mkdirSync(join(workspacePath, '.gemini'), { recursive: true })
  writeFileSync(cfgPath, `${JSON.stringify({ mcpServers: { stardeck: entry } }, null, 2)}\n`, 'utf8')
}

/** claude 召唤件：`.claude/commands/stardeck.md`（斜杠命令 /stardeck 触发）。 */
export function claudeSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: '.claude/commands/stardeck.md',
    content: [
      '---',
      'description: 召唤 stardeck 舰桥（作战看板）——探测舰桥在线并打开浏览器；不在线给诚实指引。',
      '---',
      '# 召唤 stardeck 舰桥',
      '',
      '按序执行，不要跳步：',
      `1. 用 shell 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board（200 即在线）。`,
      `2. 在线：用 shell 打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"；Linux: xdg-open "${args.boardUrl}/"），然后只回复「舰桥已开启：<url>」。`,
      '3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。',
      '',
      `跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.claude}。`,
    ].join('\n'),
  }
}

/** gemini 召唤件：`.gemini/commands/stardeck.toml`（自定义命令 TOML——
 * prompt 必填/description 可选，gemini-cli bundle TomlCommandDefSchema 实证）。 */
export function geminiSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: '.gemini/commands/stardeck.toml',
    content: [
      'description = "召唤 stardeck 舰桥（作战看板）：探测舰桥在线并打开浏览器；不在线给诚实指引。"',
      'prompt = """',
      '按序执行，不要跳步：',
      `1. 用 shell 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board（200 即在线）。`,
      `2. 在线：用 shell 打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"；Linux: xdg-open "${args.boardUrl}/"），然后只回复「舰桥已开启：<url>」。`,
      '3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。',
      `跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.gemini}。`,
      '"""',
    ].join('\n'),
  }
}

/** claude 适配器（第五舰队）：-p 一次性 + .mcp.json 桥（与 zcode 同构注入器）
 * + 尾包会话号捕获。鉴权=用户原生登录或 env ANTHROPIC_BASE_URL/AUTH_TOKEN
 * （anthropic 兼容网关，如 z.ai/api/anthropic——透传 daemon 环境）。 */
export const claudeAdapter: ExecutorAdapter = {
  id: 'claude',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args), 'utf8')
    injectZcodeMcp(args.workspacePath, { http: args.http, agentId: args.agentId }) // .mcp.json 与 zcode 同构（Claude 同款机制）
    return spawnCli(args.executorBin, claudePrintArgs({ model: args.model, prompt: PROMPT }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
        onStdoutLine: claudeSessionCapture({ stateDir: args.stateDir, taskId: args.taskId, workspacePath: args.workspacePath }),
      })
  },
}

/** gemini 适配器（第六舰队，契约实验性）：-p 一次性 + .gemini/settings.json 注
 * 桥。0.58 无 --output-format → 无尾包，会话号不捕获（jump 靠 resume 号手填
 * 或后续版本补）；本机无 GEMINI_API_KEY 实弹待机。 */
export const geminiAdapter: ExecutorAdapter = {
  id: 'gemini',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args), 'utf8')
    injectGeminiMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
    return spawnCli(args.executorBin, geminiPrintArgs({ model: args.model, prompt: PROMPT }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
      })
  },
}

// ═══ 第七舰队 qwen（Qwen Code 0.22.3，gemini-cli 分支谱系；2026-09-02 收编轮）═══
// 契约证据双源：vibe-kanban executors/qwen.rs（--acp 驱动/--yolo 自动批/MCP
// ~/.qwen/settings.json）+ 本机实测（`-p` 无头、`--resume <会话号>`、
// `--auth-type openai` openai 兼容面——OPENAI_API_KEY/OPENAI_BASE_URL 环境变量
// 直连 z.ai paas v4 网关鉴权半证：请求可达，模型选择器与网关兼容性不稳，
// 实弹待机）。实验性标记诚实降级：本机未跑通全链前不裸标可绑定。

/** qwen 入口探测：win32 优先 npm 全局包内 JS 入口（经 node 直跑）。 */
export function detectQwenBin(configured: string): string {
  if (configured !== '') return configured
  if (process.platform === 'win32') {
    const js = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@qwen-code', 'qwen-code', 'cli-entry.js')
    if (existsSync(js)) return js
  }
  return 'qwen'
}

/** qwen argv 构造（纯，测试管辖）：-p 一次性 + --yolo 免批（VK 同款）+
 * --auth-type openai（openai 兼容网关鉴权面，key/baseUrl 走环境变量）。 */
export function qwenPrintArgs(args: { model: string; prompt: string }): string[] {
  return [...(args.model !== '' ? ['--model', args.model] : []), '--auth-type', 'openai', '--yolo', '-p', args.prompt]
}

/** qwen 工具面注入：`.qwen/settings.json` 的 mcpServers.stardeck（gemini-cli
 * 分支谱系——项目级 settings 与 .gemini 同语义；逐键合并+坏 JSON 拒绝）。 */
export function injectQwenMcp(workspacePath: string, args: { http: string; agentId: string }): void {
  const cfgPath = join(workspacePath, '.qwen', 'settings.json')
  mkdirSync(join(workspacePath, '.stardeck'), { recursive: true })
  const entry = { command: process.execPath, args: [mcpBridgePath()], env: { STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId } }
  let existing: Record<string, unknown> | undefined
  if (existsSync(cfgPath)) {
    const raw = readFileSync(cfgPath, 'utf8')
    try {
      existing = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      throw new Error(`工作区已有 .qwen/settings.json 但不是合法 JSON，stardeck 拒绝覆盖（不毁用户配置）：${err instanceof Error ? err.message : String(err)}——请先修复该文件。`)
    }
    if (existing !== undefined && typeof existing === 'object' && !Array.isArray(existing)) {
      const backup = join(workspacePath, '.stardeck', 'qwen-settings.pre-stardeck')
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
      const servers = { ...((existing.mcpServers as Record<string, unknown> | undefined) ?? {}), stardeck: entry }
      writeFileSync(cfgPath, `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`, 'utf8')
      return
    }
    existing = undefined
  }
  mkdirSync(join(workspacePath, '.qwen'), { recursive: true })
  writeFileSync(cfgPath, `${JSON.stringify({ mcpServers: { stardeck: entry } }, null, 2)}\n`, 'utf8')
}

/** qwen 召唤件：`.qwen/commands/stardeck.toml`（gemini-cli 同款 TOML 命令面）。 */
export function qwenSummonArtifact(args: { boardUrl: string }): { relativePath: string; content: string } {
  return {
    relativePath: '.qwen/commands/stardeck.toml',
    content: [
      'description = "召唤 stardeck 舰桥（作战看板）：探测舰桥在线并打开浏览器；不在线给诚实指引。"',
      'prompt = """',
      '按序执行，不要跳步：',
      `1. 用 shell 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" ${args.boardUrl}/warroom/api/board（200 即在线）。`,
      `2. 在线：用 shell 打开浏览器（Windows: start "" "${args.boardUrl}/"；macOS: open "${args.boardUrl}/"；Linux: xdg-open "${args.boardUrl}/"），然后只回复「舰桥已开启：<url>」。`,
      '3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。',
      `跳会话模板（与舰桥 jump 面同构）：${JUMP_TEMPLATES.qwen}。`,
      '"""',
    ].join('\n'),
  }
}

/** qwen 适配器（第七舰队，实验性）：-p 一次性 + .qwen/settings.json 注桥 +
 * --yolo 免批。鉴权=openai 兼容面（OPENAI_API_KEY/OPENAI_BASE_URL 环境变量
 * 透传 daemon 环境——本机惯例映射 z.ai GLM 网关）。无尾包事件流（gemini 谱系
 * 0.22 无 --output-format json）——会话号捕获待 ACP/实弹轮补。 */
export const qwenAdapter: ExecutorAdapter = {
  id: 'qwen',
  async spawn(args) {
    mkdirSync(join(args.workspacePath, '.stardeck'), { recursive: true })
    writeFileSync(join(args.workspacePath, '.stardeck', 'brief.md'), executorBrief(args), 'utf8')
    injectQwenMcp(args.workspacePath, { http: args.http, agentId: args.agentId })
    return spawnCli(args.executorBin, qwenPrintArgs({ model: args.model, prompt: PROMPT }),
      {
        cwd: args.workspacePath, stateDir: args.stateDir, role: 'executor', agentId: args.agentId, taskId: args.taskId,
        env: { ...process.env, STARDECK_HTTP: args.http, STARDECK_AGENT: args.agentId },
      })
  },
}

/** 七席注册表（const 不提升——置于文件尾，全部适配器定义之后）。
 * 另有五席契约登记（copilot/amp/cursor/droid/ccr）在 fleet.ts——只有 spawn
 * 契约在档、适配器未实装，绑定门挡住（不装样子）。 */
export const ADAPTERS: Record<string, ExecutorAdapter> = { opencode: opencodeAdapter, codex: codexAdapter, pi: piAdapter, zcode: zcodeAdapter, dsh: dshAdapter, claude: claudeAdapter, gemini: geminiAdapter, qwen: qwenAdapter }
