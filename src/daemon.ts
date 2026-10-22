/**
 * stardeck daemon——独立形态的装配层（原 dsh 插件 src/index.ts 的对位物）：
 * node:http 服务器 + dashboard 路由鸭子直挂 + war_* 工具注册表 + MCP/工具
 * 调用端点 + 执行者适配器（CommanderOps）+ 巡检（回收失联/补征召）+ 板 UI
 * 静态服务。零宿主依赖——这是「会话外一切」独立成立的正式形态。
 * @module stardeck/daemon
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWarStore } from './state.ts'
import { registerDashboard } from './dashboard.ts'
import { warTools, type CommanderOps, type SubagentsServiceFace, type WorkspaceOps } from './tools.ts'
import { loadRoster } from './units.ts'
import { materializeTaskWorkspace, materializeInstanceWorkspace, releaseTaskWorkspace, resolveWorkspaceRoot } from './workspace.ts'
import { runtimeFlags } from './flags.ts'
import { appendEvent, listCampaignIds, loadCampaign } from './events.ts'
import { appendDirectiveEvent, dueScheduledDirectives, loadDirectives, newDirectiveId } from './directives.ts'
import { deliverViaOpencode, deliverViaRpc } from './steer.ts'
import { conscriptPlan } from './rules.ts'
import { detectOpencodeBin, detectCodexBin, detectPiBin, detectZcodeBin, detectClaudeBin, detectGeminiBin, detectDshBin, ADAPTERS, ExecutorRegistry, jumpArgs, buildTerminalCommand, readAttachMap, writeAttachMapEntry, piLatestSessionId, piSessionDirFor, seatAgentPrefix, type ExecutorSession, type AttachEntry } from './executor.ts'
import { readSessionHistory } from './history.ts'
import { spawn } from 'node:child_process'
import { staffWorklist, staffOrderFor, spawnStaffAgent, staffExecutorFor, harvestStaffDirectiveEvents, finalStaffReply, renderBriefForSign, CLARIFY_ROUNDS_CAP, proxyOrderFor, proxyCommandBlocksOf, proxyVerdictBlocksOf, proxySceneBlocksOf, proxyManagementBlocksOf, type StaffWorkItem } from './staff.ts'
import { appendBridgeEvent, bridgeUnanswered, bridgeHistoryWindow, loadBridgeMessages, syncBridgeNotices, type BridgeArtifact } from './bridge.ts'
import { boardProjection, bridgeDigest, directiveProjection, ledgerSlice } from './dashboard.ts'
import { probeFleet, fleetSeatIds, bindableSeatIds, bindNoteFor } from './fleet.ts'
import { ensureDirs, loadConfig, persistFleetBinding, type StardeckConfig } from './config.ts'
import { backfillAttachMap } from './backfill.ts'
import { issueProxySeat, seatByToken, loadProxySeats } from './proxy-seats.ts'
import { runProxyLoop, proxyLoopEnvOf } from './proxy-loop.ts'
import { renderScene, type SceneContext } from './scene.ts'
import type { CampaignState } from './types.ts'

export interface DaemonHandle {
  config: StardeckConfig
  base: string
  close(): Promise<void>
}

export function packageVersion(): string {
  for (const cand of ['../package.json', '../../package.json']) {
    try {
      const p = JSON.parse(readFileSync(fileURLToPath(new URL(cand, import.meta.url)), 'utf8')) as { version?: string }
      if (typeof p.version === 'string') return p.version
    } catch { /* keep looking */ }
  }
  return '0.0.0'
}

/** 原生文件夹拾取的 PowerShell 脚本（纯，测试管辖）：WinForms
 * FolderBrowserDialog（**自带「新建文件夹」按钮**，可浏览任意位置）。
 * 首版 Shell.BrowseForDialog 实弹翻车：后台 daemon 的进程不允许抢前台，
 * 对话框静默落在 z 序底层（「点了没弹」实为弹在浏览器后面）——改用
 * TopMost 属主窗 ShowDialog(owner) 强制置顶弹出。输出强制 UTF-8 防
 * PS 5.1 ANSI 码页乱中文路径；title 单引号按 PS 规则翻倍转义。 */
export function folderPickerScript(title: string): string {
  const psTitle = title.replace(/'/g, "''")
  return [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    'Add-Type -AssemblyName System.Windows.Forms;',
    `$f=New-Object System.Windows.Forms.FolderBrowserDialog;`,
    `$f.Description='${psTitle}';`,
    '$f.ShowNewFolderButton=$true;',
    '$owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true;',
    "$r=$f.ShowDialog($owner); $owner.Dispose();",
    "if($r -eq [System.Windows.Forms.DialogResult]::OK){ [Console]::Out.Write($f.SelectedPath) }",
  ].join(' ')
}

export function startDaemon(configOverride: Partial<StardeckConfig> = {}): DaemonHandle {
  const config = loadConfig(configOverride)
  ensureDirs(config)
  const base = `http://127.0.0.1:${config.port}`
  const stateDir = config.stateDir
  // P1-6 attach-map backfill（启动时一次，best-effort）：老日志反查补缺失键——
  // 只补不覆盖；补了打一行账，没有就静默（新装/已齐都不吵）。
  try {
    const bf = backfillAttachMap(stateDir)
    if (bf.added > 0) console.log(`[stardeck] attach-map backfill：补 ${bf.added} 键（${bf.items.map(i => `${i.key}→${i.executor}:${i.sessionId.slice(0, 8)}…`).join(' · ')}）`)
  } catch (err) {
    console.warn(`[stardeck] attach-map backfill 失败（不影响启动）：${err instanceof Error ? err.message : String(err)}`)
  }
  const store = createWarStore(stateDir)
  const flags = runtimeFlags({ WARROOM_FEATURES: config.extraFeatures === '' ? undefined : config.extraFeatures } as NodeJS.ProcessEnv)
  const roster = () => loadRoster(join(stateDir, 'units'), undefined)
  const registry = new ExecutorRegistry()
  // ---------- 舰队运行态（UI 入口绑定，2026-09-01）：「每次打开绑一个 CLI」----------
  // 启动配置为底，POST /warroom/api/fleet 可切（只影响后续征召与下一轮大副
  //——在役执行者进程不动；大副随舰队：绑谁下轮跑谁，codex 受阻回退 opencode）。
  let activeExecutor = ADAPTERS[config.executor] !== undefined ? config.executor : 'opencode'
  let activeModel = config.model
  const binFor = (id: string): string =>
    id === 'codex' ? detectCodexBin(config.executorBin) : id === 'pi' ? detectPiBin(config.executorBin) : id === 'zcode' ? detectZcodeBin(config.executorBin) : id === 'claude' ? detectClaudeBin(config.executorBin) : id === 'gemini' ? detectGeminiBin(config.executorBin) : id === 'dsh' ? detectDshBin(config.executorBin) : detectOpencodeBin(config.executorBin)

  // ---------- 执行者适配器 → CommanderOps（征召面） ----------
  // V24.1：编号前缀=席别（oc- 曾是全席硬编码遗留）；spawn 即上账席别
  // （task_conscripted），卡面徽标不依赖 attach-map 的会话捕获时机。
  const newAgentId = (seat: string, taskId: string): string => `${seatAgentPrefix(seat)}-${taskId}-${Date.now().toString(36)}`
  const conscript = async (task: CampaignState, _signal: AbortSignal): Promise<{ spawned: true; childId: string } | { spawned: false; reason: string }> => {
    if (task.workspacePath === undefined) return { spawned: false, reason: '任务无工作区——无从框定执行者' }
    if (registry.liveFor(task.campaignId) !== undefined) return { spawned: false, reason: '该任务已有在役执行者（spawn-once 守卫）' }
    if (registry.live().length >= config.maxExecutors) return { spawned: false, reason: `执行者满编（${config.maxExecutors}）——排队等巡检补征` }
    const adapter = ADAPTERS[activeExecutor] ?? ADAPTERS.opencode!
    const agentId = newAgentId(activeExecutor, task.campaignId)
    appendEvent(stateDir, { type: 'task_conscripted', ts: new Date().toISOString(), campaignId: task.campaignId, executor: activeExecutor, agentId })
    const session: ExecutorSession = await adapter.spawn({
      taskId: task.campaignId,
      title: task.title ?? task.intent,
      acceptance: task.acceptance ?? '',
      workspacePath: task.workspacePath,
      http: base,
      agentId,
      model: activeModel,
      modelProvider: config.modelProvider,
      codexShimBase: config.codexShimBase,
      executorBin: binFor(activeExecutor),
      stateDir,
    })
    registry.register(session)
    console.log(`[stardeck] 执行者应征 ${agentId} → 任务 ${task.campaignId}（日志 ${session.logPath}）`)
    return { spawned: true, childId: agentId }
  }
  const commander: CommanderOps = {
    conscript,
    // B1-重派死锁修复（插件仓回流 P0）：requeue 落账点先释放 spawn-once 守卫
    //——本仓守卫形态=ExecutorRegistry 的活进程判定（liveFor），war_fail 的调用
    // 方执行者进程自身还在役，不显式遗忘则重派征召恒被「该任务已有在役执行者」
    // 挡回。遗忘后旧令牌即刻失效（claim 发新令牌），旧进程若再交卷会被令牌
    // 核对拒绝——不会双头执行。
    releaseSpawned(taskId) { registry.forgetTask(taskId) },
    // P0-1 中途投递（pi 先行，2026-09-02）：批注转达=attach 映射定位该任务会话
    // → pi RPC 续跑投 follow_up 帧（回执成功即转达成立）。非 pi 席/无映射/投递
    // 失败=诚实 false（账面只记「已上栏」不记「已转达」——老降级语义原样）。
    async relayTo(childId, text) {
      const session = registry.byAgent(childId)
      if (session === undefined) return false
      const entry = readAttachMap(stateDir)[session.taskId]
      if (entry === undefined || entry.executor !== 'pi') return false
      const out = await deliverViaRpc({
        bin: binFor('pi'), cwd: entry.workspacePath, sessionId: entry.sessionId,
        message: text, kind: 'follow_up',
      })
      if (!out.ok) console.warn(`[stardeck] 批注转达失败（task ${session.taskId}）：${out.error ?? '未知'}`)
      return out.ok
    },
    forget(taskId) { registry.forgetTask(taskId) },
  }

  // ---------- P0-1 板内答复（talking 命令 → 大副会话续跑）----------
  // 单飞守卫：同一命令同时只允许一封在途（重试风暴防线）；答复只认 talking 态。
  // 席别分发（P0-1 收尾）：pi=RPC prompt 帧（受理回执即返）；opencode=run -s
  // 续跑（活过观察窗即受理——大副默认席自此可答）；其余席仍诚实拒绝。
  const answering = new Set<string>()
  const answerCommand = async (commandId: string, text: string, channel: string = 'board'): Promise<{ ok: true; note: string } | { ok: false; error: string }> => {
    const directive = loadDirectives(stateDir).find(d => d.id === commandId)
    if (directive === undefined) return { ok: false, error: `命令 ${commandId} 不存在。` }
    if (directive.status !== 'talking') return { ok: false, error: `命令 ${commandId} 当前不是追问中（${directive.status}）——无可答复的大副提问。` }
    // 澄清协议答复（2026-09-08）：挂起澄清的命令走账本回环——入账即受理，
    // 大副下一轮带问答史重开成案（外聘无头进程不续跑；账本即状态，全席通用，
    // 也避免与成案轮双发）。D26：channel 入账（board/bridge——审计分面对话来源）。
    if (directive.clarification?.status === 'pending') {
      appendDirectiveEvent(stateDir, { type: 'directive_clarification_answered', ts: new Date().toISOString(), directiveId: commandId, text, channel })
      console.log(`[stardeck] 舰长澄清答复入账 ${commandId}（第 ${directive.clarification.round} 轮）——大副将开新一轮成案`)
      return { ok: true, note: '答复已入账——大副将带着答复开新一轮定案，进展看命令卡与任务链。' }
    }
    if (directive.staffSessionId === undefined || directive.staffSessionId === null) return { ok: false, error: '该命令没有大副会话捕获（早于会话捕获功能的旧命令）——请直接下新命令。' }
    const entry = readAttachMap(stateDir)[directive.staffSessionId]
    if (entry === undefined) return { ok: false, error: `大副会话映射缺失（${directive.staffSessionId}）——无法续跑投递。` }
    if (entry.executor !== 'pi' && entry.executor !== 'opencode') return { ok: false, error: `答复通道现支持 pi / opencode 席（该会话属 ${entry.executor}）——其余席的续跑通道待接入。` }
    if (answering.has(commandId)) return { ok: false, error: '该命令已有一封答复在途——等大副消化完再发。' }
    answering.add(commandId)
    const message = `【舰长答复】${text}\n（请继续按既定流程推进：需要呈批用 war_plan，可直接发布用 war_publish。）`
    let settled: Promise<boolean> | null = null
    try {
      const out = entry.executor === 'pi'
        ? await deliverViaRpc({
          bin: binFor('pi'), cwd: entry.workspacePath, sessionId: entry.sessionId, model: activeModel,
          message, kind: 'prompt',
        })
        : await deliverViaOpencode({
          bin: binFor('opencode'), cwd: entry.workspacePath, sessionId: entry.sessionId, model: activeModel,
          message, stateDir,
        })
      if (!out.ok) return { ok: false, error: `答复投递失败：${out.error ?? '未知'}` }
      settled = out.settled
      const viaChannel = entry.executor === 'pi' ? 'pi-rpc' : 'opencode-run'
      // 审计入账（append-only；不改 fold 状态——talking 态由大副后续动作推进）。
      // D27 正名：channel=来源面（board/bridge），via=续跑投递通道——两维正交；
      // 旧版以 via 覆盖 channel（对话面来源丢失，审计分叉），自 D27 起双字段。
      appendDirectiveEvent(stateDir, { type: 'directive_answered', ts: new Date().toISOString(), directiveId: commandId, text, channel, via: viaChannel })
      console.log(`[stardeck] 舰长答复已送达 ${commandId} → ${entry.executor} 会话 ${entry.sessionId}（${viaChannel} 续跑）`)
      return { ok: true, note: `答复已送达大副会话（${viaChannel} 续跑）——它将继续推进；进展看命令卡与任务链。` }
    } finally {
      // 在途守卫持续到「消化完」（settled）——受理即放行会双进程续跑同一会话文件。
      void (settled ?? Promise.resolve(false)).finally(() => { answering.delete(commandId) })
    }
  }

  // ---------- 深编制替身：v1 不接线（单外勤），面在但不撒谎 ----------
  const subagents: SubagentsServiceFace = {
    async startContinuable() { throw new Error('stardeck v1：深编制未接线（单外勤模式，勿 war_deploy_unit）') },
    async followup() { throw new Error('stardeck v1：followup 未接线') },
    interrupt() {},
    async listDescendants() { return [] },
  }
  const workspace: WorkspaceOps = {
    materialize: (root, taskId, repo) => {
      const m = materializeTaskWorkspace(root, taskId, repo)
      return { path: m.path, kind: m.kind, ...(m.note !== undefined ? { note: m.note } : {}) }
    },
    materializeInstance: (root, taskId, slug) => {
      const m = materializeInstanceWorkspace(root, taskId, slug)
      return { path: m.path, kind: m.kind, ...(m.note !== undefined ? { note: m.note } : {}) }
    },
  }

  // ---------- 工具注册表 ----------
  // D27 定夺授权运行态：代理舰长会话在册表 + 舰长授权开关（启动取
  // config.proxyVerdict；POST /bridge/settings 运行时可翻，重启回落默认 OFF——
  // 授权是舰长的动作，不落盘=重启不继承授权，安全缺省）。
  // D29 外接席：proxyx-<ts36> 在册表（启动自 proxy-seats.json 装载，签发即加）
  // ——与内置 proxy- 同权同约束（定夺门仍叠授权旗；管理块作废语义同直落）。
  // 身份门防冒用：seatId 会随 issuedBy 入账本（公开），只查「在册」可被伪造
  // agentId 直打 /tools/call 冒用——门必须叠「在途祝福」：只有 daemon 自己的
  // 收割路径（applyProxyReply）放行的 callTool 才过门（Stop-if 那根刺的正解）。
  const proxyAgentIds = new Set<string>()
  const proxySeatIds = new Set<string>(loadProxySeats(stateDir).map(s => s.seatId))
  const proxyGateBless = new Set<string>()
  let proxyVerdictRuntime = config.proxyVerdict
  // D32 流式上屏：内置 loop 的打字机缓冲（onTextDelta 增量、入账/失手即清）。
  // SSE 帧随 seq 变化推送 {live}——会话态不进账本，读投影纪律不破。
  const proxyLive = { seq: 0, text: '' }
  const tools = warTools({
    store,
    stateDir,
    maxUnits: config.maxUnits,
    maxAttempts: config.maxAttempts,
    roster,
    subagents,
    commander,
    workspace,
    warRoot: config.warRoot,
    workspaceRoot: resolveWorkspaceRoot('', config.warRoot),
    flags,
    verdictProxyGate: (agentId: string) => proxyVerdictRuntime && (proxyAgentIds.has(agentId) || proxySeatIds.has(agentId)) && proxyGateBless.has(agentId),
    managementProxyGate: (agentId: string) => (proxyAgentIds.has(agentId) || proxySeatIds.has(agentId)) && proxyGateBless.has(agentId), // D28③：管理块作废语义直落（无旗拍板）；通过语义仍走上行授权旗。D29：外接在册席同权+在途祝福防冒用
  }) as Record<string, { name: string; description: string; parameters: Record<string, unknown>; execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> }>
  const toolList = Object.values(tools)
  const byName = new Map(toolList.map(t => [t.name, t]))

  /** dsh-tools 的 defineTool 已把 parameters 规范成 JSON Schema 形状
   * （{type:'object', properties, required}）——MCP inputSchema 直通即可，
   * 不要在错误层级重造（R0 首弹踩过的坑，机检在此留针）。 */
  function jsonSchemaOf(params: Record<string, unknown>): Record<string, unknown> {
    return { type: 'object', ...(params.properties !== undefined ? { properties: params.properties } : {}), ...(Array.isArray(params.required) && params.required.length > 0 ? { required: params.required } : {}) }
  }

  async function callTool(name: string, args: Record<string, unknown>, agentId: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const tool = byName.get(name)
    if (tool === undefined) return { ok: false, error: `未知工具：${name}` }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('工具执行超时（300s）')), 300_000)
    try {
      const result = await tool.execute(args, { agent: { id: agentId }, signal: ac.signal })
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
  }

  // ---------- dashboard 路由（单 prefix，handler 内部自分发 method+path） ----------
  let dashboardHandler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined
  registerDashboard(
    { register(route) { dashboardHandler = route.handler as typeof dashboardHandler; return () => {} } },
    {
      store,
      stateDir,
      roster,
      warRoot: config.warRoot,
      flags,
      conscription: () => ({ spawned: registry.spawned(), skips: {} }),
      releaseWorkspace: path => releaseTaskWorkspace(config.warRoot, path),
      answerCommand,
      bridgeEnabled: config.bridge,
      bridgeProxy: {
        proxy: () => config.proxy,
        proxyVerdict: () => proxyVerdictRuntime,
        setProxyVerdict: (granted: boolean) => {
          proxyVerdictRuntime = granted
          console.log(`[stardeck] 舰长${granted ? '授权' : '收回'}代理舰长代定夺（运行态，重启回落 OFF）`)
        },
      },
      // D32 流式上屏：SSE 帧随 live.seq 变化推 {live} 打字机文本。
      proxyLive: () => ({ seq: proxyLive.seq, text: proxyLive.text }),
      shutdown: () => { triggerShutdown() },
      // K17 计划判定回推（独立形态替位）：pi 席经 RPC 续跑投 follow_up（与板内答复
      // 同通道）；非 pi/失败 best-effort 跳过——驳回理由已入 fold，重拟工单必带。
      pushToStaff: (staffKey, text) => {
        const entry = readAttachMap(stateDir)[staffKey]
        if (entry === undefined || entry.executor !== 'pi') return
        void deliverViaRpc({ bin: binFor('pi'), cwd: entry.workspacePath, sessionId: entry.sessionId, message: text, kind: 'follow_up' })
          .then(out => { if (!out.ok) console.warn(`[stardeck] 判定回推未送达（${staffKey}）：${out.error ?? '未知'}——重拟工单会带驳回意见兜底`) })
          .catch(() => { /* best-effort */ })
      },
      // P1-7 独立派生（无宿主面时兜底）：会话=attach-map 会话号并集 + 在役任务条目。
      // 工作区**不派生**：war_root 扫出来的是内部任务目录，不是用户工作区——派生了
      // 会顶掉 HQ 弹窗的手动注册区（路径输入+原生拾取），用户反而选不了自己的目录
      // （2026-09-02 用户实抓）。host-workspaces 在独立形态保持缺席=手动区正解。
      localSessions: () => {
        const map = readAttachMap(stateDir)
        const ids = new Set(Object.values(map).map(e => e.sessionId))
        for (const s of registry.live()) { const e = map[s.taskId]; if (e !== undefined) ids.add(e.sessionId) }
        return [...ids]
      },
    },
  )

  // P1-5 优雅停服的迟绑定触发器（handle 在 registerDashboard 之后才成形——
  // /shutdown 路由经 deps 拿到这个闭包，close 后干净退出）。
  let closeRef: () => Promise<void> = () => Promise.resolve()
  const triggerShutdown = (): void => {
    void closeRef().catch(() => { /* close 尽力而为 */ }).finally(() => process.exit(0))
  }

  // ---------- 巡检：回收失联 + 补征召（独立形态下进程即生命，定义比宿主更硬） ----------
  function boardCandidates(): Array<{ taskId: string; status: CampaignState['status']; workspacePath?: string; priority?: string; startedAt: string; deps?: string[] }> {
    return listCampaignIds(stateDir)
      .map(id => loadCampaign(stateDir, id))
      .filter(t => t.startedAt !== '')
      .map(t => ({ taskId: t.campaignId, status: t.status, workspacePath: t.workspacePath, priority: t.priority, startedAt: t.startedAt, deps: t.deps }))
  }
  function patrolTick(): void {
    try {
      // ① 失联回收：in_progress 任务其执行者进程已死且未结算 → 记败并重派/终局。
      for (const c of boardCandidates()) {
        if (c.status !== 'in_progress') continue
        const session = registry.anyFor(c.taskId)
        if (session === undefined || session.exitCode === null) continue
        const task = loadCampaign(stateDir, c.taskId)
        const attempts = task.attempts
        appendEvent(stateDir, { type: 'task_attempt_failed', ts: new Date().toISOString(), campaignId: c.taskId, reason: `执行者进程退出（stardeck 巡检回收，exit=${session.exitCode}）`, from: session.agentId })
        if (attempts < config.maxAttempts) {
          appendEvent(stateDir, { type: 'task_requeued', ts: new Date().toISOString(), campaignId: c.taskId, reason: `第 ${attempts} 次尝试失联：执行者进程退出` })
          // B1-重派死锁修复（插件仓回流）：判死回栏先释放 spawn-once 守卫
          //（本仓=registry 遗忘）——下一轮巡检补征段即可接手。
          registry.forgetTask(c.taskId)
        } else {
          appendEvent(stateDir, { type: 'task_failed', ts: new Date().toISOString(), campaignId: c.taskId, reason: `第 ${attempts} 次尝试失联（重试上限 ${config.maxAttempts} 已用尽）` })
          registry.forgetTask(c.taskId)
        }
      }
      // ② 补征召：发布态任务无在役执行者 → 按队列计划征召（工作区互斥+满编由 conscript 判）。
      // 含「起跑即夭折」回收（mtit94od 实测案例）：执行者 spawn 后未 claim 即退（如 API key 缺失），
      // 死会话若不遗忘会永久占住任务——①的失联回收只管 in_progress，published 态无人清，
      // 卡片就停在「等待外勤小队领取」且账本零痕迹。故：已注册但进程已死 → 先遗忘再补征。
      // B2（插件仓回流）：计划滤 deps——dep-locked 任务不被提前征召（claim 被
      // 拒空转、简报只发一次）也不遮蔽同工作区可跑任务。
      const candidates = boardCandidates()
      const statusOf = (id: string) => candidates.find(t => t.taskId === id)?.status
      const plannable = conscriptPlan(candidates, statusOf)
      for (const t of plannable) {
        const prior = registry.anyFor(t.taskId)
        if (prior !== undefined) {
          if (prior.exitCode === null) continue
          console.log(`[stardeck] 起跑即夭折回收：任务 ${t.taskId} 的执行者 ${prior.agentId} 已退出（exit=${prior.exitCode}），遗忘后补征`)
          appendEvent(stateDir, { type: 'task_requeued', ts: new Date().toISOString(), campaignId: t.taskId, reason: `执行者起跑即夭折（未 claim 即退出，exit=${prior.exitCode}）——已遗忘并补征` })
          registry.forgetTask(t.taskId)
        }
        void conscript(loadCampaign(stateDir, t.taskId), new AbortController().signal).catch((err: unknown) => {
          console.error('[stardeck] 征召失败（下轮巡检重试）:', err instanceof Error ? err.message : err)
        })
      }
    } catch (err) {
      console.error('[stardeck] 巡检异常（跳过本轮）:', err instanceof Error ? err.message : err)
    }
  }
  const patrol = setInterval(patrolTick, 15_000)
  patrol.unref()

  // ---------- 大副外聘（HANDOFF①）：引信替位 + 定时令派发 + 按工单 spawn ----------
  // 独立形态没有宿主 relay 面——staffTick 就是外聘大副的哨位：①定时令到点补
  // directive_dispatched（宿主 30s tick 的替位，巡检 15s 代行）；②有工单且
  // 大副不在役 → 框定 spawn 一轮（接令/呈改计划/发布，见 staff.ts）。等舰长
  // 定夺（计划 pending）不出单——「等」就是诚实。
  let staffSession: ExecutorSession | undefined
  let staffItems: StaffWorkItem[] = []
  let staffSpawning = false
  let staffRetryAfter = 0
  let staffFleet = 'opencode'
  async function staffTick(): Promise<void> {
    if (!config.staff) return
    for (const id of dueScheduledDirectives(loadDirectives(stateDir), Date.now())) {
      appendDirectiveEvent(stateDir, { type: 'directive_dispatched', ts: new Date().toISOString(), directiveId: id })
      console.log(`[stardeck] 定时命令到点派发 ${id}`)
    }
    // D26 机械战报（五触发，不跑模型）：幂等同步——dedupKey=源事件指纹，
    // 同源事件永只报一次；入账即 revision 变化，聊天窗/板双双刷新。
    if (config.bridge) {
      try {
        const noticed = syncBridgeNotices(stateDir)
        if (noticed > 0) console.log(`[stardeck] 舰桥战报入账 ${noticed} 条`)
      } catch (err) {
        console.warn(`[stardeck] 舰桥战报同步失败（跳过本轮）：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (staffSession !== undefined) {
      const alive = staffSession.exitCode === null && staffSession.child.exitCode === null
      if (alive) {
        if (Date.now() - staffSession.startedAt < config.staffTimeoutMin * 60_000) return
        console.warn(`[stardeck] 大副主席龄熔断（>${config.staffTimeoutMin}min）：${staffSession.agentId}——kill 后下轮重开`)
        try { staffSession.child.kill() } catch { /* already gone */ }
      } else {
        console.log(`[stardeck] 大副退场（exit=${staffSession.exitCode}）——工单未清则下轮重开`)
      }
      // pi 大副无进程内会话号事件：退场时惰性扫描本轮会话文件入 attach-map
      //（键=staff-<agentId>；minMtime=本轮起跑，不误捕上轮）。opencode/zcode
      // 行钩已捕，这里只补 pi——板上「任务会话」钮的数据源。
      if (staffFleet === 'pi') {
        const sid = piLatestSessionId(piSessionDirFor(join(stateDir, 'staff')), staffSession.startedAt)
        if (sid !== null) {
          writeAttachMapEntry(stateDir, staffSession.agentId, { executor: 'pi', sessionId: sid, workspacePath: join(stateDir, 'staff'), capturedAt: new Date().toISOString() })
          console.log(`[stardeck] 大副会话入账 ${staffSession.agentId} → pi ${sid}`)
        }
      }
      // 澄清协议收割（2026-09-08）：本轮大副最终答复的结构化块 → 命令账本
      //（澄清挂起/任务书入账）。失败诚实降级——下轮工单重试语义接管。
      try {
        const knownIds = new Set(staffItems.map(i => i.commandId))
        const byIdNow = new Map(loadDirectives(stateDir).map(d => [d.id, d]))
        const clarifyRoundOf = (id: string): number => byIdNow.get(id)?.clarification?.round ?? 0
        const harvested = harvestStaffDirectiveEvents(stateDir, staffSession.agentId, knownIds, clarifyRoundOf)
        for (const ev of harvested.events) {
          appendDirectiveEvent(stateDir, ev)
          console.log(`[stardeck] 大副产出入账 ${ev.type} → ${ev.directiveId}`)
        }
        for (const rej of harvested.rejectedClarifications) {
          // 机械闸（D23 完整形态）：过限澄清不入账——命令停在 answered 态，
          // 成案单带「必须定案或弃案」纪律持续出，行为收敛。
          console.warn(`[stardeck] 澄清轮超限（第 ${rej.round} 轮 > 上限 ${CLARIFY_ROUNDS_CAP}）：${rej.commandId} 的澄清块拒收——成案单将强制定案或弃案`)
        }
        // D24 两档制：L1 签发流——任务书入账后由系统代开呈批件（plan pending=
        // 待舰长签发，工单不出=罚时豁免；签发走 /commands/plan，war_publish 硬门
        // 靠 plan approved 放行）。驳回重拟的新任务书同样在此重开呈批件。
        for (const d of loadDirectives(stateDir)) {
          if ((d.grade === 'L1' || d.grade === 'L2') && d.brief !== undefined && (d.plan === undefined || d.plan.status === 'rejected') && d.status !== 'approved' && d.status !== 'cancelled') {
            appendDirectiveEvent(stateDir, { type: 'directive_plan_opened', ts: new Date().toISOString(), directiveId: d.id, plan: renderBriefForSign(d.brief) })
            console.log(`[stardeck] L1 任务书呈批 ${d.id}——等舰长签发`)
          }
        }
        // D27：大副回话双写退役——聊天窗对话者换成代理舰长席（proxyTick），
        // 大副只经澄清/任务书块+决策卡+机械战报显形，不再说聊天话。
      } catch (err) {
        console.warn(`[stardeck] 大副产出收割失败（下轮工单重试）：${err instanceof Error ? err.message : String(err)}`)
      }
      // 定向退避：退场/熔断后工单仍未清（这轮没干成活）→ 罚 2 分钟再重开，
      // 防 received-未分诊单引发 15s 重试风暴；干成了活（工单清空）不罚。
      if (staffWorklist(loadDirectives(stateDir)).length > 0) staffRetryAfter = Date.now() + 120_000
      staffSession = undefined
    }
    if (staffSpawning || Date.now() < staffRetryAfter) return
    const items = staffWorklist(loadDirectives(stateDir))
    if (items.length === 0) return
    staffSpawning = true
    try {
      const agentId = `staff-${Date.now().toString(36)}`
      // 大副随舰队 + 双席正典（V19.13）：可选舰队必须大副+外勤双接通——
      // pi/zcode/claude/codex/dsh 亲自出；双席不全的（gemini/qwen）在舰队门
      // 已不可选，这里回退 opencode 仅作防御并打点。
      staffFleet = staffExecutorFor(activeExecutor)
      if (staffFleet !== activeExecutor) console.log(`[stardeck] 大副随舰队：${activeExecutor} 实弹受阻，本轮大副由 ${staffFleet} 代跑`)
      // 引信替位：draft 工单落 session_opened + received（宿主态 relay 面的对位
      // 物；已 received/talking 的重试单不重复落）。
      const byId = new Map(loadDirectives(stateDir).map(d => [d.id, d]))
      for (const item of items) {
        const d = byId.get(item.commandId)
        if (d === undefined || d.status !== 'draft') continue
        appendDirectiveEvent(stateDir, { type: 'directive_session_opened', ts: new Date().toISOString(), directiveId: d.id, staffSessionId: agentId })
        appendDirectiveEvent(stateDir, { type: 'directive_received', ts: new Date().toISOString(), directiveId: d.id, staffSessionId: agentId })
      }
      // D27：chat 附页退役——聊天对话归代理舰长席（proxyTick）；大副工单只带命令。
      staffSession = await spawnStaffAgent({
        brief: staffOrderFor(items, flags, staffFleet === 'pi' ? 'pi-extension' : staffFleet === 'zcode' || staffFleet === 'dsh' || staffFleet === 'codex' ? 'http' : 'mcp'),
        workspacePath: join(stateDir, 'staff'),
        http: base,
        agentId,
        model: staffFleet === 'zcode' ? '' : activeModel, // 大副随舰队：模型串随板面绑定；zcode 引擎吃自身 config 不透传（dsh/codex 串在适配器内归一）
        executor: staffFleet,
        executorBin: binFor(staffFleet),
        stateDir,
        codexShimBase: config.codexShimBase,
      })
      staffItems = items
      console.log(`[stardeck] 大副应征 ${agentId}（${staffFleet} 席，工单 ${items.length} 件，日志 ${staffSession.logPath}）`)
    } finally {
      staffSpawning = false
    }
  }
  const staffTimer = setInterval(() => {
    void staffTick().catch(err => console.error('[stardeck] 大副 tick 异常（跳过本轮）:', err instanceof Error ? err.message : err))
  }, 15_000)
  staffTimer.unref()

  // ---------- 代理舰长席（D27）：聊天窗对话者——拟令【命令】块→命令卡 ----------
  // 舰长在舰桥频道的代理人：未答话驱动无头回合（resume 优先/全新 spawn 兜底），
  // 退场收割三写——①终答全文入 bridge（对话面）②【命令】块经命令通道建 draft
  // 卡（issuedBy=proxy-…，大副下轮分诊——拟令闭环）③（授权 ON）【定夺】块走
  // war_close_task（B3 flag-gated 通路，身份=在册代理会话）。代理舰长无工具
  // 面（executor.ts 注入守卫）——写全经收割，账本为源不变。
  let proxySession: ExecutorSession | undefined
  let proxySpawning = false
  let proxyRetryAfter = 0
  let proxyResumeBusy = false
  let proxyResumeRetryAfter = 0
  const proxyChatOrder = () => {
    const messages = loadBridgeMessages(stateDir)
    const pending = bridgeUnanswered(messages)
    return {
      pending: pending.map(m => ({ text: m.text, ts: m.ts })),
      history: bridgeHistoryWindow(messages.filter(m => !(m.kind === 'user' && pending.some(c => c.ts === m.ts)))),
      digest: JSON.stringify(bridgeDigest(stateDir)),
      ledger: JSON.stringify(ledgerSlice(stateDir)), // D28 知识面：近期账本切片（directive 尾 30+task 尾 30）
    }
  }
  /** D28③ 绑席核心（POST /fleet 与代理舰长【绑席】块共用）：校验→切运行态→
   * 落盘。坏席/契约席诚实拒绝（可绑面=bindableSeatIds）。 */
  const applyFleetBinding = (executor: string, model: string): { ok: true; note: string; persisted: boolean } | { ok: false; error: string } => {
    if (ADAPTERS[executor] === undefined) {
      return fleetSeatIds().includes(executor)
        ? { ok: false, error: `${executor} 是契约席（spawn 适配器未实装——只登记可看，接入轮实装后开放绑定）。` }
        : { ok: false, error: `未知舰队：${executor}（可绑：${bindableSeatIds().join(' | ')}）。` }
    }
    activeExecutor = executor
    activeModel = model // 空串=执行者自身默认（POST /fleet 既有语义——绑定即覆写）
    console.log(`[stardeck] 舰队绑定 → ${activeExecutor}${activeModel !== '' ? ` @ ${activeModel}` : ''}（只影响后续征召与下一轮大副；在役执行者不动）`)
    const persist = persistFleetBinding(activeExecutor, activeModel)
    if (!persist.ok) console.warn(`[stardeck] 舰队绑定未落盘：${persist.error}`)
    return { ok: true, note: bindNoteFor(activeExecutor, activeModel), persisted: persist.ok }
  }
  /** D29 抽取：代理舰长终答的共用收割面（块文法→账本）。内置 spawn 席（退场
   *  收割）与外接席（POST /proxy/reply）同吃一条管线——图景对账/命令卡/定夺/
   *  管理块直落全继承，账本为源不变。返回收割摘要供 reply 回执诚实交代。 */
  type ProxyHarvest = { commands: number; commandDropped: number; sceneArtifact: string | null; sceneRejected: string | null; management: number; managementDropped: number; verdicts: number; verdictsRejected: number }
  /** 对外入口：在途祝福包裹——本函数是代理身份 callTool 的唯一合法通道，
   *  伪造 agentId 直打 /tools/call 因无祝福过不了门。 */
  const applyProxyReply = async (agentId: string, reply: string, sessionId?: string): Promise<ProxyHarvest> => {
    proxyGateBless.add(agentId)
    try { return await applyProxyReplyBlessed(agentId, reply, sessionId) } finally { proxyGateBless.delete(agentId) }
  }
  const applyProxyReplyBlessed = async (agentId: string, reply: string, sessionId?: string): Promise<ProxyHarvest> => {
    const ts = new Date().toISOString()
    // D28② 图景：先渲染（草稿对账过才随话轮带 artifact 入账；失败落 scene 战报
    // 诚实告知——下轮可重出，不硬凑半图）。
    let artifact: BridgeArtifact | undefined
    let sceneArtifact: string | null = null
    let sceneRejected: string | null = null
    const { scene, dropped: sceneDropped } = proxySceneBlocksOf(reply)
    if (sceneDropped > 0) console.warn(`[stardeck] 代理舰长【图景】块弃收 ${sceneDropped} 份（空块/超 6000 字/单轮限 1 份）`)
    if (scene !== null) {
      const context: SceneContext = {
        commands: new Map(loadDirectives(stateDir).map(d => [d.id, { status: d.status }])),
        tasks: new Map(listCampaignIds(stateDir).map(id => { const t = loadCampaign(stateDir, id); return [id, { status: t.status }] as const })),
      }
      const rendered = renderScene(scene, context)
      if (rendered.ok) {
        const id = `scene-${Date.now().toString(36)}`
        mkdirSync(join(stateDir, 'artifacts'), { recursive: true })
        writeFileSync(join(stateDir, 'artifacts', `${id}.html`), rendered.html, 'utf8')
        artifact = { id, title: rendered.title }
        sceneArtifact = id
        console.log(`[stardeck] 代理舰长图景落盘 ${id}（${rendered.title}）`)
      } else {
        appendBridgeEvent(stateDir, { type: 'bridge_system_notice', ts, noticeKind: 'scene', dedupKey: `scene:${agentId}:${ts}`, text: `图景渲染未过对账：${rendered.reason}` })
        sceneRejected = rendered.reason
        console.warn(`[stardeck] 代理舰长图景拒收：${rendered.reason}`)
      }
    }
    appendBridgeEvent(stateDir, { type: 'bridge_agent_message', ts, text: reply, agentId, ...(sessionId !== undefined ? { sessionId } : {}), ...(artifact !== undefined ? { artifact } : {}) })
    let commands = 0
    const { commands: commandTexts, dropped } = proxyCommandBlocksOf(reply)
    for (const text of commandTexts) {
      commands++
      const directiveId = newDirectiveId()
      appendDirectiveEvent(stateDir, { type: 'directive_created', ts: new Date().toISOString(), directiveId, text, issuedBy: agentId })
      console.log(`[stardeck] 代理舰长拟令入账 ${directiveId}（${text.length} 字）——大副下轮分诊`)
    }
    if (dropped > 0) console.warn(`[stardeck] 代理舰长【命令】块弃收 ${dropped} 条（空块/超 2000 字/超单轮上限）`)
    let verdicts = 0
    let verdictsRejected = 0
    for (const v of proxyVerdictBlocksOf(reply)) {
      if (!proxyVerdictRuntime) {
        verdictsRejected++
        console.warn(`[stardeck] 代理舰长【定夺】块拒收（授权 OFF）：任务 ${v.taskId}——仍呈舰长定夺`)
        continue
      }
      const verdict = v.pass ? `通过（代理舰长代定夺：${v.reason === '' ? '证据与理由未附——呈舰长复核' : v.reason}）` : `打回（代理舰长代定夺：${v.reason}）`
      const out = await callTool('war_close_task', { task_id: v.taskId, verdict }, agentId)
      if (out.ok) { verdicts++; console.log(`[stardeck] 代理舰长代定夺入账：任务 ${v.taskId} ${v.pass ? '通过' : '打回'}（授权在册）`) }
      else { verdictsRejected++; console.warn(`[stardeck] 代理舰长代定夺被拒：任务 ${v.taskId}——${out.error}`) }
    }
    // D28③ 管理块（全部直落拍板——无旗，全审计）：撤令/停定时令→war_abandon_command；
    // 重派→续接令建卡+作废收官（B3 门 managementProxyGate 支线=作废语义放行）；
    // 绑席→applyFleetBinding+战报确认。
    let management = 0
    const { blocks: mgmt, dropped: mgmtDropped } = proxyManagementBlocksOf(reply)
    if (mgmtDropped > 0) console.warn(`[stardeck] 代理舰长管理块弃收 ${mgmtDropped} 条（理由超 300 字/超单轮 3 条）`)
    for (const b of mgmt) {
      if (b.kind === '撤令' || b.kind === '定时令停') {
        const reason = `${b.kind === '撤令' ? '代理舰长代撤（舰长口谕）' : '代理舰长代停定时令（舰长口谕）'}：${b.reason === '' ? '（未附理由）' : b.reason}`
        const out = await callTool('war_abandon_command', { command_id: b.id, reason }, agentId)
        if (out.ok) { management++; console.log(`[stardeck] 代理舰长${b.kind}入账：命令 ${b.id}`) }
        else console.warn(`[stardeck] 代理舰长${b.kind}被拒：命令 ${b.id}——${out.error}`)
        continue
      }
      if (b.kind === '重派') {
        const directiveId = newDirectiveId()
        appendDirectiveEvent(stateDir, { type: 'directive_created', ts: new Date().toISOString(), directiveId, text: `!!直接做：重派失败任务 ${b.id}——按原任务书与验收标准重跑一遍（原任务作废收官，本令是其续接）。代理舰长代落（舰长口谕）：${b.reason}`, issuedBy: agentId })
        const out = await callTool('war_close_task', { task_id: b.id, verdict: `作废收官——重派续接令 ${directiveId}（代理舰长代行，舰长口谕：${b.reason === '' ? '未附理由' : b.reason}）` }, agentId)
        if (out.ok) { management++; console.log(`[stardeck] 代理舰长重派入账：任务 ${b.id} 作废，续接令 ${directiveId} 已建——大副下轮分诊`) }
        else console.warn(`[stardeck] 代理舰长重派被拒：任务 ${b.id}——${out.error}（续接令 ${directiveId} 已建，舰长可在板上处置）`)
        continue
      }
      // 绑席：坏席诚实拒绝+战报（成功也战报——聊天里看得见换席生效）。
      const seatNote = (ok: boolean, text: string): void => {
        appendBridgeEvent(stateDir, { type: 'bridge_system_notice', ts: new Date().toISOString(), noticeKind: 'terminal', dedupKey: `fleet:${Date.now().toString(36)}`, text })
        console.log(`[stardeck] 代理舰长绑席${ok ? '' : '被拒'}：${text}`)
      }
      if (!bindableSeatIds().includes(b.id)) {
        seatNote(false, `绑席被拒：${b.id} 不可绑（可绑：${bindableSeatIds().join(' | ')}）。`)
        continue
      }
      const applied = applyFleetBinding(b.id, b.reason !== '' ? b.reason : activeModel) // 块省略模型=沿用当前（POST 语义是覆写，调用侧补齐）
      if (applied.ok) { management++; seatNote(true, `舰队绑定 → ${b.id}${b.reason !== '' ? ` @ ${b.reason}` : ''}（代理舰长代行；只影响后续征召${applied.persisted ? '' : '；⚠ 未落盘' }）。`) }
      else seatNote(false, `绑席被拒：${applied.error}`)
    }
    return { commands, commandDropped: dropped, sceneArtifact, sceneRejected, management, managementDropped: mgmtDropped, verdicts, verdictsRejected }
  }
  const harvestProxyReply = async (agentId: string): Promise<void> => {
    const reply = finalStaffReply(stateDir, agentId)
    if (reply === null) return
    const entry = readAttachMap(stateDir)[agentId]
    await applyProxyReply(agentId, reply, entry?.sessionId)
  }
  // ---------- D29 外接席契约面共用助手（HTTP 路由与 MCP proxy face 同源）----------
  const proxyOrderPayload = (seatId: string): Record<string, unknown> => {
    const chat = proxyChatOrder()
    return { seatId, base, order: proxyOrderFor(chat, { verdictAuthorized: proxyVerdictRuntime }), pending: chat.pending, history: chat.history, digest: chat.digest, ledger: chat.ledger }
  }
  const proxyReplyAccepted = async (seatId: string, text: string, via: string): Promise<{ seatId: string; harvested: ProxyHarvest }> => {
    const harvested = await applyProxyReply(seatId, text)
    console.log(`[stardeck] 外接席回话收割 ${seatId}（${via}：命令 ${harvested.commands}·管理 ${harvested.management}·定夺 ${harvested.verdicts}）`)
    return { seatId, harvested }
  }
  /** 座席面工具清单：只读四件+交答一件——执行者 war_* 一件不出（出口协议红线）。 */
  const proxyFaceTools = [
    { name: 'get_order', description: '拉取代理舰长座席载荷：order 正文是当轮工作令（含【命令】【图景】等块文法教学），history/ledger/digest 为当前快照。每轮开工先调它。', inputSchema: { type: 'object', properties: {} as Record<string, unknown>, required: [] } },
    { name: 'submit_reply', description: '交终答全文（含结构化块）。系统收割入账并回执收割摘要。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '终答全文' } }, required: ['text'] } },
    { name: 'read_board', description: '读板投影（只读）：命令与任务清单。', inputSchema: { type: 'object', properties: {} as Record<string, unknown>, required: [] } },
    { name: 'read_digest', description: '读待决摘要（只读）：待签/待验收/待答复等。', inputSchema: { type: 'object', properties: {} as Record<string, unknown>, required: [] } },
    { name: 'read_ledger', description: '读近期账本切片（只读）：命令尾 N+任务尾 N，按时间升序。', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '每类条数上限 1-200，缺省 30' } }, required: [] } },
  ]
  async function proxyTick(): Promise<void> {
    if (!config.bridge || !config.proxy) return
    if (proxySession !== undefined) {
      const alive = proxySession.exitCode === null && proxySession.child.exitCode === null
      if (alive) {
        if (Date.now() - proxySession.startedAt < config.staffTimeoutMin * 60_000) return
        console.warn(`[stardeck] 代理舰长席龄熔断（>${config.staffTimeoutMin}min）：${proxySession.agentId}——kill 后下轮重开`)
        try { proxySession.child.kill() } catch { /* already gone */ }
      } else {
        console.log(`[stardeck] 代理舰长退场（exit=${proxySession.exitCode}）`)
      }
      // pi 惰性扫描（同大副家法）：退场时补会话号入 attach-map。
      const fleetNow = staffExecutorFor(activeExecutor)
      if (fleetNow === 'pi') {
        const sid = piLatestSessionId(piSessionDirFor(join(stateDir, 'proxy')), proxySession.startedAt)
        if (sid !== null) {
          writeAttachMapEntry(stateDir, proxySession.agentId, { executor: 'pi', sessionId: sid, workspacePath: join(stateDir, 'proxy'), capturedAt: new Date().toISOString() })
          console.log(`[stardeck] 代理舰长会话入账 ${proxySession.agentId} → pi ${sid}`)
        }
      }
      try {
        await harvestProxyReply(proxySession.agentId)
      } catch (err) {
        console.warn(`[stardeck] 代理舰长收割失败（下轮退避重试）：${err instanceof Error ? err.message : String(err)}`)
      }
      // 没干成活（未答话还在）→ 罚 2 分钟防重试风暴。
      if (bridgeUnanswered(loadBridgeMessages(stateDir)).length > 0) proxyRetryAfter = Date.now() + 120_000
      proxySession = undefined
    }
    if (proxySpawning || Date.now() < proxyRetryAfter) return
    const pendingMsgs = bridgeUnanswered(loadBridgeMessages(stateDir))
    if (pendingMsgs.length === 0) return
    // 逻辑常驻（resume 优先）：上轮代理舰长原生会话在 attach-map 且席别=当前
    // 舰队（opencode/pi 有续跑原语）→ 简报 resume 投递；失败/无答复退避 2 分钟
    // 后回落全新 spawn 携史兜底（全席保底路径，行为不依赖 resume 成活）。
    if (!proxyResumeBusy && Date.now() >= proxyResumeRetryAfter) {
      const messages = loadBridgeMessages(stateDir)
      const lastProxy = [...messages].reverse().find(m => m.kind === 'agent' && m.agentId !== undefined && m.agentId.startsWith('proxy-'))
      if (lastProxy !== undefined && lastProxy.agentId !== undefined && lastProxy.sessionId !== undefined) {
        const entry = readAttachMap(stateDir)[lastProxy.agentId]
        const fleetNow = staffExecutorFor(activeExecutor)
        if (entry !== undefined && (entry.executor === 'opencode' || entry.executor === 'pi') && entry.executor === fleetNow) {
          proxyResumeBusy = true
          const brief = proxyOrderFor(proxyChatOrder(), { verdictAuthorized: proxyVerdictRuntime })
          void (async () => {
            try {
              const out = entry.executor === 'pi'
                ? await deliverViaRpc({ bin: binFor('pi'), cwd: entry.workspacePath, sessionId: entry.sessionId, model: activeModel, message: brief, kind: 'prompt' })
                : await deliverViaOpencode({ bin: binFor('opencode'), cwd: entry.workspacePath, sessionId: entry.sessionId, model: activeModel, message: brief, stateDir })
              if (!out.ok) {
                console.warn(`[stardeck] 代理舰长续跑投递失败（${out.error ?? '未知'}）——退避后全新回合兜底`)
                proxyResumeRetryAfter = Date.now() + 120_000
                return
              }
              await (out.settled ?? Promise.resolve(false))
              const reply = finalStaffReply(stateDir, lastProxy.agentId!)
              if (reply === null) {
                console.warn('[stardeck] 代理舰长续跑完成但未取到答复——退避后全新回合兜底')
                proxyResumeRetryAfter = Date.now() + 120_000
                return
              }
              await harvestProxyReply(lastProxy.agentId!)
              console.log(`[stardeck] 代理舰长续跑回话入账（${reply.length} 字，resume）`)
            } catch (err) {
              console.warn(`[stardeck] 代理舰长续跑异常（退避后全新回合兜底）：${err instanceof Error ? err.message : String(err)}`)
              proxyResumeRetryAfter = Date.now() + 120_000
            } finally {
              proxyResumeBusy = false
            }
          })()
          return
        }
      }
    }
    // D29 内置 loop 支线（resume 让路——CLI 会话还热就先续跑）：旗开且 key 齐
    // 则本轮由 loop 应答（零 spawn、秒级）；失手/空答诚实降级——落一条战报后
    // 继续走舰队席 spawn 兜底，行为永不依赖 loop 成活；下轮 tick 照常重试 loop。
    if (proxyLoopEnvOf(process.env).enabled) {
      const loopEnv = proxyLoopEnvOf(process.env)
      proxySpawning = true
      try {
        const order = proxyOrderFor(proxyChatOrder(), { verdictAuthorized: proxyVerdictRuntime })
        proxyLive.text = ''
        proxyLive.seq += 1
        const out = await runProxyLoop(order, loopEnv, {
          reads: {
            board: async () => ({ commands: directiveProjection(stateDir), tasks: boardProjection(stateDir) }),
            digest: () => bridgeDigest(stateDir),
            ledger: () => ledgerSlice(stateDir),
          },
          // D32 打字机：增量推进 live 缓冲——SSE 帧随 seq 推 {live}，浮窗逐字上屏。
          onTextDelta: d => { proxyLive.text += d; proxyLive.seq += 1 },
        })
        if (out.text === '') throw new Error('本轮无终答文本')
        proxyLive.text = ''
        proxyLive.seq += 1
        await applyProxyReply('proxy-loop', out.text)
        console.log(`[stardeck] 代理舰长 loop 回话入账（${out.text.length} 字，${out.steps} 步/工具 ${out.toolCalls} 次）`)
        return
      } catch (err) {
        proxyLive.text = ''
        proxyLive.seq += 1
        console.warn(`[stardeck] 代理舰长 loop 失手——本轮降级舰队席：${err instanceof Error ? err.message : String(err)}`)
        appendBridgeEvent(stateDir, { type: 'bridge_system_notice', ts: new Date().toISOString(), noticeKind: 'retry', dedupKey: `proxyloop:${Date.now().toString(36)}`, text: '内置 loop 本轮失手（详见作战日志）——改由舰队席应答。' })
      } finally {
        proxySpawning = false
      }
    }
    proxySpawning = true
    try {
      const agentId = `proxy-${Date.now().toString(36)}`
      const fleetNow = staffExecutorFor(activeExecutor)
      if (fleetNow !== activeExecutor) console.log(`[stardeck] 代理舰长随舰队：${activeExecutor} 实弹受阻，本轮代理舰长由 ${fleetNow} 代跑`)
      proxyAgentIds.add(agentId)
      proxySession = await spawnStaffAgent({
        brief: proxyOrderFor(proxyChatOrder(), { verdictAuthorized: proxyVerdictRuntime }),
        workspacePath: join(stateDir, 'proxy'),
        http: base,
        agentId,
        model: fleetNow === 'zcode' ? '' : activeModel,
        executor: fleetNow,
        executorBin: binFor(fleetNow),
        stateDir,
        codexShimBase: config.codexShimBase,
        role: 'proxy',
      })
      console.log(`[stardeck] 代理舰长应征 ${agentId}（${fleetNow} 席，待答 ${pendingMsgs.length} 条，日志 ${proxySession.logPath}）`)
    } finally {
      proxySpawning = false
    }
  }
  const proxyTimer = setInterval(() => {
    void proxyTick().catch(err => console.error('[stardeck] 代理舰长 tick 异常（跳过本轮）:', err instanceof Error ? err.message : err))
  }, 15_000)
  proxyTimer.unref()

  // ---------- 静态板 UI（public/ + dist/client.js；dev 未构建时给指引） ----------
  const here = fileURLToPath(new URL('.', import.meta.url))
  const assetCandidates = (rel: string): string[] => [join(here, rel), join(here, '../', rel), join(here, '../../', rel)]
  function serveAsset(res: ServerResponse, rel: string, type: string): boolean {
    for (const file of assetCandidates(rel)) {
      if (!existsSync(file)) continue
      try {
        const body = readFileSync(file)
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
        res.end(body)
        return true
      } catch { /* try next candidate */ }
    }
    return false
  }

  /** 请求体读取（工具调用/fleet/attach 面）。C2 加固（插件仓回流同款）：
   * 64KB 上限（超限 413 拒）+ 流中断自然终止（async 迭代不挂起 handler）。 */
  const BODY_LIMIT = 64 * 1024
  class HttpBodyError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
  }
  async function readBody(req: IncomingMessage): Promise<string> {
    const parts: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > BODY_LIMIT) throw new HttpBodyError('请求体超过 64KB 上限。', 413)
      parts.push(buf)
    }
    return Buffer.concat(parts).toString('utf8')
  }
  function sendJson(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base)
      const key = `${req.method} ${url.pathname}`
      try {
        if (key === 'GET /warroom/api/healthz') return sendJson(res, 200, { ok: true, product: 'stardeck', version: packageVersion(), ts: new Date().toISOString() })
        if (key === 'GET /warroom/api/mcp/tools') {
          return sendJson(res, 200, toolList.map(t => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.parameters) })))
        }
        if (key === 'POST /warroom/api/mcp/call' || key === 'POST /warroom/api/tools/call') {
          const body = JSON.parse(await readBody(req)) as { name?: string; arguments?: Record<string, unknown>; agentId?: string }
          if (typeof body.name !== 'string' || body.name === '') return sendJson(res, 400, { ok: false, error: 'name 必填' })
          const out = await callTool(body.name, body.arguments ?? {}, body.agentId ?? 'anonymous')
          // 乱码哨（2026-09-02 用户实抓：体检报告战报入账即花）：report 含 U+FFFD
          // 替换符=字节在到达前已坏（执行者侧 shell 编码事故嫌疑，如 Windows GBK
          // 控制台拼 curl JSON——我方 readBody 恒 UTF-8，MCP 桥 stdio 亦然）。账本
          // 忠实入账不改写；回执警示教导改走 MCP/UTF-8 通道重交。
          // 2026-09-04 playground 实抓扩展：war_publish 的标题/任务书/验收同样
          // 中招（心跳任务标题成花）——哨位覆盖全部自由文本入口。
          const rec = out as { ok?: boolean; warning?: string }
          const mojibakeFields: string[] = []
          if (body.name === 'war_submit' && typeof body.arguments?.report === 'string' && (body.arguments.report as string).includes('\uFFFD')) mojibakeFields.push('战报')
          if (body.name === 'war_publish') {
            if (typeof body.arguments?.title === 'string' && (body.arguments.title as string).includes('\uFFFD')) mojibakeFields.push('任务标题')
            if (typeof body.arguments?.brief === 'string' && (body.arguments.brief as string).includes('\uFFFD')) mojibakeFields.push('任务书')
            if (typeof body.arguments?.acceptance === 'string' && (body.arguments.acceptance as string).includes('\uFFFD')) mojibakeFields.push('验收标准')
          }
          if (rec.ok === true && mojibakeFields.length > 0) {
            rec.warning = `${mojibakeFields.join('/')}含乱码（U+FFFD 替换符——疑似你侧 shell 用了非 UTF-8 编码拼请求，如 Windows GBK 控制台的 curl）。请改用 MCP 工具或 UTF-8 HTTP 通道重新提交。`
            console.warn(`[stardeck] ${body.name} ${mojibakeFields.join('/')}含乱码——回执已警示重交`)
          }
          return sendJson(res, 200, out) // 工具业务失败也 200——调用方看 ok/error（错误文案即教学）
        }
        if (key === 'GET /warroom/api/fleet') {
          // D30 开箱面：proxyLoop 随门面下发——全席缺席时门给「内置 loop」诚实指引。
          return sendJson(res, 200, { ok: true, active: { executor: activeExecutor, model: activeModel }, seats: probeFleet(config.executorBin), proxyLoop: proxyLoopEnvOf(process.env).enabled })
        }
        if (key === 'POST /warroom/api/fleet') {
          const body = JSON.parse(await readBody(req)) as { executor?: unknown; model?: unknown }
          const executor = typeof body.executor === 'string' ? body.executor.trim() : ''
          const model = typeof body.model === 'string' ? body.model.trim() : ''
          if (executor === '') return sendJson(res, 400, { ok: false, error: 'executor 必填（opencode | pi | codex）。' })
          const applied = applyFleetBinding(executor, model)
          if (!applied.ok) {
            // 契约席（copilot/amp/cursor/droid…）档案在档但适配器未实装——诚实拒绝绑定。
            const contract = fleetSeatIds().filter(id => ADAPTERS[id] === undefined)
            return sendJson(res, 400, { ok: false, error: applied.error, contractSeats: contract })
          }
          // P0-2 落盘：重启不丢绑定（env 优先级不变；坏 JSON 拒绝覆盖——回执警示）。
          return sendJson(res, 200, { ok: true, active: { executor: activeExecutor, model: activeModel }, note: applied.note, ...(applied.persisted ? {} : { warning: '绑定已生效但未落盘（重启后将回落启动配置）。' }) })
        }
        // ---------- D29 外接代理舰长席（HTTP 为单一真相源；MCP proxy face 同源转发）----------
        if ((key.startsWith('GET /warroom/api/proxy/') || key.startsWith('POST /warroom/api/proxy/')) && (!config.bridge || !config.proxy)) {
          return sendJson(res, 404, { ok: false, error: '代理舰长席未开（STARDECK_PROXY/BRIDGE 关）——外接席随之停用。' })
        }
        if (key === 'POST /warroom/api/proxy/seats') {
          const { seatId, token } = issueProxySeat(stateDir)
          proxySeatIds.add(seatId)
          console.log(`[stardeck] 外接代理舰长席签发 ${seatId}`)
          return sendJson(res, 200, { ok: true, seatId, token, note: 'token 只此一次出现（落盘只存哈希）。用法：GET /warroom/api/proxy/order?token= 拉座席载荷（order 正文含块文法教学）；POST /warroom/api/proxy/reply {token,text} 交终答。' })
        }
        if (key === 'GET /warroom/api/proxy/order') {
          const seat = seatByToken(stateDir, url.searchParams.get('token') ?? '')
          if (seat === null) return sendJson(res, 403, { ok: false, error: '座席 token 无效——先 POST /warroom/api/proxy/seats 签发。' })
          return sendJson(res, 200, { ok: true, ...proxyOrderPayload(seat.seatId) })
        }
        if (key === 'POST /warroom/api/proxy/reply') {
          const body = JSON.parse(await readBody(req)) as { token?: unknown; text?: unknown }
          if (typeof body.token !== 'string' || body.token === '') return sendJson(res, 400, { ok: false, error: 'token 必填。' })
          const seat = seatByToken(stateDir, body.token)
          if (seat === null) return sendJson(res, 403, { ok: false, error: '座席 token 无效——先 POST /warroom/api/proxy/seats 签发。' })
          const text = typeof body.text === 'string' ? body.text : ''
          if (text.trim() === '') return sendJson(res, 400, { ok: false, error: 'text 必填（终答全文——块文法写在 order 正文里）。' })
          return sendJson(res, 200, { ok: true, ...(await proxyReplyAccepted(seat.seatId, text, 'HTTP')) })
        }
        // MCP proxy face（同源转发终点——mcp-bridge.mjs --face proxy 消费）：
        if (key === 'GET /warroom/api/proxy/mcp/tools') {
          const seat = seatByToken(stateDir, url.searchParams.get('token') ?? '')
          if (seat === null) return sendJson(res, 403, { ok: false, error: '座席 token 无效。' })
          return sendJson(res, 200, proxyFaceTools)
        }
        if (key === 'POST /warroom/api/proxy/mcp/call') {
          const body = JSON.parse(await readBody(req)) as { token?: unknown; name?: unknown; arguments?: Record<string, unknown> }
          const seat = seatByToken(stateDir, typeof body.token === 'string' ? body.token : '')
          if (seat === null) return sendJson(res, 403, { ok: false, error: '座席 token 无效——先 POST /warroom/api/proxy/seats 签发。' })
          const name = typeof body.name === 'string' ? body.name : ''
          const args = body.arguments ?? {}
          if (name === 'get_order') return sendJson(res, 200, { ok: true, result: proxyOrderPayload(seat.seatId) })
          if (name === 'submit_reply') {
            const text = typeof args.text === 'string' ? args.text : ''
            if (text.trim() === '') return sendJson(res, 200, { ok: false, error: 'text 必填（终答全文——块文法写在 order 正文里）。' })
            return sendJson(res, 200, { ok: true, result: await proxyReplyAccepted(seat.seatId, text, 'MCP') })
          }
          if (name === 'read_board') return sendJson(res, 200, { ok: true, result: { commands: directiveProjection(stateDir), tasks: boardProjection(stateDir) } })
          if (name === 'read_digest') return sendJson(res, 200, { ok: true, result: bridgeDigest(stateDir) })
          if (name === 'read_ledger') {
            const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 200) : 30
            return sendJson(res, 200, { ok: true, result: { entries: ledgerSlice(stateDir, limit, limit) } })
          }
          return sendJson(res, 200, { ok: false, error: `未知座席工具：${name}（座席面只有 get_order/submit_reply/read_board/read_digest/read_ledger——执行者 war_* 不在此面）。` })
        }
        if (key.startsWith('GET /warroom/api/artifact/')) {
          // D28② 图景出线：artifacts/ 下已对账图页（零脚本、CSP 全关——沙箱
          // iframe 的 src 面）。id 白名单 + 目录限界，404/400 按码出线。
          const id = key.slice('GET /warroom/api/artifact/'.length)
          if (!/^[a-z0-9-]{1,64}$/.test(id)) return sendJson(res, 400, { ok: false, error: '图景 id 形如 scene-<ts36>。' })
          const file = join(stateDir, 'artifacts', `${id}.html`)
          if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: `图景 ${id} 不存在（或已被清理）。` })
          const html = readFileSync(file, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'cache-control': 'no-store' })
          res.end(html)
          return
        }
        // 附着面共用解析（jump/history 共享）：映射优先、双键型——taskId=执行者
        // 原生会话；staff-<id>=大副原生会话（无 campaign，账本查找只放映射未命中
        // 后的任务分支，pi 惰性捕获仅任务分支）。
        const resolveAttach = (taskId: string): { entry: AttachEntry; campaign: CampaignState } | { error: string; code: number } => {
          let entry = readAttachMap(stateDir)[taskId]
          const campaign = loadCampaign(stateDir, taskId)
          if (entry === undefined && campaign.campaignId !== '' && campaign.startedAt !== '' && campaign.workspacePath !== undefined && campaign.workspacePath !== '') {
            // pi 惰性捕获（会话文件名即号）。
            const sessionId = piLatestSessionId(piSessionDirFor(campaign.workspacePath))
            if (sessionId !== null) {
              entry = { executor: 'pi', sessionId, workspacePath: campaign.workspacePath, capturedAt: new Date().toISOString() }
              writeAttachMapEntry(stateDir, taskId, entry)
            }
          }
          if (entry === undefined) {
            if (campaign.campaignId === '' || campaign.startedAt === '') return { error: `目标不存在（既非任务也非大副会话）：${taskId}`, code: 404 }
            return { error: '无原生会话映射（该任务尚无执行者事件流/会话文件）——稍后再试。', code: 409 }
          }
          return { entry, campaign }
        }
        if (key === 'POST /warroom/api/attach/entries') {
          // 只读轻量面：批量查 attach 映射（板面据此决定给不给「在 TUI 中打开」）。
          const body = JSON.parse(await readBody(req)) as { taskIds?: unknown }
          const ids = Array.isArray(body.taskIds) ? body.taskIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
          const map = readAttachMap(stateDir)
          const entries: Record<string, { executor: string; sessionId: string } | null> = {}
          for (const id of ids) entries[id] = map[id] !== undefined ? { executor: map[id]!.executor, sessionId: map[id]!.sessionId } : null
          return sendJson(res, 200, { ok: true, entries })
        }
        if (key === 'POST /warroom/api/attach/history') {
          // 会话历史只读弹窗（零 token）：按映射席别读本机存档，不 resume 不烧模型。
          const body = JSON.parse(await readBody(req)) as { taskId?: unknown }
          const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
          if (taskId === '') return sendJson(res, 400, { ok: false, error: 'taskId 必填。' })
          const resolved = resolveAttach(taskId)
          if ('error' in resolved) return sendJson(res, resolved.code, { ok: false, error: resolved.error })
          try {
            const history = readSessionHistory(resolved.entry.executor, resolved.entry.sessionId, resolved.entry.workspacePath)
            return sendJson(res, 200, { ok: true, ...history })
          } catch (err) {
            return sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
        }
        if (key === 'POST /warroom/api/attach/jump') {
          const body = JSON.parse(await readBody(req)) as { taskId?: unknown; dryRun?: unknown }
          const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
          if (taskId === '') return sendJson(res, 400, { ok: false, error: 'taskId 必填。' })
          const resolved = resolveAttach(taskId)
          if ('error' in resolved) return sendJson(res, resolved.code, { ok: false, error: resolved.error })
          const entry = resolved.entry
          const plan = { executor: entry.executor, sessionId: entry.sessionId, cwd: entry.workspacePath, argv: jumpArgs(entry.executor, entry.sessionId) }
          if (body.dryRun === true) return sendJson(res, 200, { ok: true, dryRun: true, ...plan })
          let terminal: { file: string; args: string[] }
          try {
            terminal = buildTerminalCommand(plan.cwd, plan.argv, entry.executor === 'zcode')
          } catch (err) {
            return sendJson(res, 501, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          const child = spawn(terminal.file, terminal.args, { detached: true, stdio: 'ignore', windowsHide: false })
          child.unref()
          return sendJson(res, 200, { ok: true, launched: true, ...plan })
        }
        if (key === 'POST /warroom/api/planets/pick') {
          // 独立形态 HQ 注册门：原生资源管理器选文件夹（弹窗在用户桌面，需桌面
          // 会话）。Shell.BrowseForFolder 0x41 = RETURNONLYFSDIRS|NEWDIALOGSTYLE
          // ——Vista 风格可调窗，**自带「新建文件夹」按钮，可浏览任意位置**
          // （定案：新建不限于任何仓根）。输出强制 UTF-8（PS 5.1 控制台默认
          // ANSI 码页，中文路径会乱——坑录预防）。
          if (process.platform !== 'win32') {
            return sendJson(res, 501, { ok: false, error: '文件夹拾取现只实装 win32（Shell.BrowseForFolder）；其余平台可直接在输入框填写路径注册。' })
          }
          const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', folderPickerScript('为 stardeck 星球选择工作区文件夹（可在此新建文件夹）')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
          const timer = setTimeout(() => { child.kill() }, 10 * 60_000)
          let out = ''
          child.stdout?.on('data', d => { out += d.toString('utf8') })
          child.on('error', err => {
            clearTimeout(timer)
            sendJson(res, 500, { ok: false, error: `文件夹拾取失败（powershell 未起）：${err instanceof Error ? err.message : String(err)}` })
          })
          child.on('exit', () => {
            clearTimeout(timer)
            const path = out.trim()
            if (path === '') return sendJson(res, 200, { ok: false, cancelled: true })
            return sendJson(res, 200, { ok: true, path })
          })
          return
        }
        if (url.pathname.startsWith('/warroom') && dashboardHandler !== undefined) {
          return void await dashboardHandler(req, res)
        }
        if (key === 'GET /' && serveAsset(res, '../public/index.html', 'text/html; charset=utf-8')) return
        // client.js：dev（here=src/）与构建（here=dist/）两种布局都命中。
        if (key === 'GET /client.js' && (serveAsset(res, 'client.js', 'text/javascript; charset=utf-8') || serveAsset(res, 'dist/client.js', 'text/javascript; charset=utf-8'))) return
        if (key === 'GET /favicon.ico') { res.writeHead(204); return void res.end() }
        sendJson(res, 404, { ok: false, error: `no route: ${key}` })
      } catch (err) {
        if (err instanceof HttpBodyError) return sendJson(res, err.status, { ok: false, error: err.message })
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })()
  })

  server.listen(config.port, '127.0.0.1')
  console.log(`[stardeck v${packageVersion()}] 舰桥甲板就位 ${base} （板 UI ${base}/ · 状态 ${stateDir} · 工作区 ${config.warRoot} · 舰队 ${activeExecutor}${config.model !== '' ? ` @ ${config.model}` : '（板面可换）'} · 大副 ${config.staff ? '在岗' : '休眠'} · 工具 ${toolList.length}）`)

  let closed = false
  const handle = {
    config,
    base,
    async close() {
      if (closed) return
      closed = true
      clearInterval(patrol)
      clearInterval(staffTimer)
      if (staffSession !== undefined) { try { staffSession.child.kill() } catch { /* already gone */ } }
      for (const s of registry.live()) { try { s.child.kill() } catch { /* already gone */ } }
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
  closeRef = () => handle.close()
  return handle
}
