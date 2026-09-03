/**
 * stardeck daemon——独立形态的装配层（原 dsh 插件 src/index.ts 的对位物）：
 * node:http 服务器 + dashboard 路由鸭子直挂 + war_* 工具注册表 + MCP/工具
 * 调用端点 + 执行者适配器（CommanderOps）+ 巡检（回收失联/补征召）+ 板 UI
 * 静态服务。零宿主依赖——这是「会话外一切」独立成立的正式形态。
 * @module stardeck/daemon
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWarStore } from './state.ts'
import { registerDashboard } from './dashboard.ts'
import { warTools, type CommanderOps, type SubagentsServiceFace, type WorkspaceOps } from './tools.ts'
import { loadRoster } from './units.ts'
import { materializeTaskWorkspace, materializeInstanceWorkspace, releaseTaskWorkspace } from './workspace.ts'
import { runtimeFlags } from './flags.ts'
import { appendEvent, listCampaignIds, loadCampaign } from './events.ts'
import { appendDirectiveEvent, dueScheduledDirectives, loadDirectives } from './directives.ts'
import { deliverViaRpc } from './steer.ts'
import { conscriptPlan } from './rules.ts'
import { detectOpencodeBin, detectCodexBin, detectPiBin, detectZcodeBin, detectClaudeBin, detectGeminiBin, ADAPTERS, ExecutorRegistry, jumpArgs, buildTerminalCommand, readAttachMap, writeAttachMapEntry, piLatestSessionId, piSessionDirFor, type ExecutorSession, type AttachEntry } from './executor.ts'
import { readSessionHistory } from './history.ts'
import { spawn } from 'node:child_process'
import { staffWorklist, staffOrderFor, spawnStaffAgent, staffExecutorFor } from './staff.ts'
import { probeFleet, fleetSeatIds, bindableSeatIds, bindNoteFor } from './fleet.ts'
import { ensureDirs, loadConfig, persistFleetBinding, type StardeckConfig } from './config.ts'
import { backfillAttachMap } from './backfill.ts'
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
    id === 'codex' ? detectCodexBin(config.executorBin) : id === 'pi' ? detectPiBin(config.executorBin) : id === 'zcode' ? detectZcodeBin(config.executorBin) : id === 'claude' ? detectClaudeBin(config.executorBin) : id === 'gemini' ? detectGeminiBin(config.executorBin) : detectOpencodeBin(config.executorBin)

  // ---------- 执行者适配器 → CommanderOps（征召面） ----------
  const newAgentId = (taskId: string): string => `oc-${taskId}-${Date.now().toString(36)}`
  const conscript = async (task: CampaignState, _signal: AbortSignal): Promise<{ spawned: true; childId: string } | { spawned: false; reason: string }> => {
    if (task.workspacePath === undefined) return { spawned: false, reason: '任务无工作区——无从框定执行者' }
    if (registry.liveFor(task.campaignId) !== undefined) return { spawned: false, reason: '该任务已有在役执行者（spawn-once 守卫）' }
    if (registry.live().length >= config.maxExecutors) return { spawned: false, reason: `执行者满编（${config.maxExecutors}）——排队等巡检补征` }
    const adapter = ADAPTERS[activeExecutor] ?? ADAPTERS.opencode!
    const agentId = newAgentId(task.campaignId)
    const session: ExecutorSession = await adapter.spawn({
      taskId: task.campaignId,
      title: task.title ?? task.intent,
      acceptance: task.acceptance ?? '',
      workspacePath: task.workspacePath,
      http: base,
      agentId,
      model: activeModel,
      modelProvider: config.modelProvider,
      executorBin: binFor(activeExecutor),
      stateDir,
    })
    registry.register(session)
    console.log(`[stardeck] 执行者应征 ${agentId} → 任务 ${task.campaignId}（日志 ${session.logPath}）`)
    return { spawned: true, childId: agentId }
  }
  const commander: CommanderOps = {
    conscript,
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
  const answering = new Set<string>()
  const answerCommand = async (commandId: string, text: string): Promise<{ ok: true; note: string } | { ok: false; error: string }> => {
    const directive = loadDirectives(stateDir).find(d => d.id === commandId)
    if (directive === undefined) return { ok: false, error: `命令 ${commandId} 不存在。` }
    if (directive.status !== 'talking') return { ok: false, error: `命令 ${commandId} 当前不是追问中（${directive.status}）——无可答复的大副提问。` }
    if (directive.staffSessionId === undefined || directive.staffSessionId === null) return { ok: false, error: '该命令没有大副会话捕获（早于会话捕获功能的旧命令）——请直接下新命令。' }
    const entry = readAttachMap(stateDir)[directive.staffSessionId]
    if (entry === undefined) return { ok: false, error: `大副会话映射缺失（${directive.staffSessionId}）——无法续跑投递。` }
    if (entry.executor !== 'pi') return { ok: false, error: `答复通道现只支持 pi 席（该会话属 ${entry.executor}）——其余席的续跑通道待接入。` }
    if (answering.has(commandId)) return { ok: false, error: '该命令已有一封答复在途——等大副消化完再发。' }
    answering.add(commandId)
    let settled: Promise<boolean> | null = null
    try {
      const out = await deliverViaRpc({
        bin: binFor('pi'), cwd: entry.workspacePath, sessionId: entry.sessionId, model: activeModel,
        message: `【舰长答复】${text}\n（请继续按既定流程推进：需要呈批用 war_plan，可直接发布用 war_publish。）`,
        kind: 'prompt',
      })
      if (!out.ok) return { ok: false, error: `答复投递失败：${out.error ?? '未知'}` }
      settled = out.settled
      // 审计入账（append-only；不改 fold 状态——talking 态由大副后续动作推进）。
      appendDirectiveEvent(stateDir, { type: 'directive_answered', ts: new Date().toISOString(), directiveId: commandId, text, channel: 'pi-rpc' })
      console.log(`[stardeck] 舰长答复已送达 ${commandId} → pi 会话 ${entry.sessionId}（RPC 续跑）`)
      return { ok: true, note: '答复已送达大副会话（pi 续跑）——它将继续推进；进展看命令卡与任务链。' }
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
    flags,
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
  function boardCandidates(): Array<{ taskId: string; status: CampaignState['status']; workspacePath?: string; priority?: string; startedAt: string }> {
    return listCampaignIds(stateDir)
      .map(id => loadCampaign(stateDir, id))
      .filter(t => t.startedAt !== '')
      .map(t => ({ taskId: t.campaignId, status: t.status, workspacePath: t.workspacePath, priority: t.priority, startedAt: t.startedAt }))
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
      const plannable = conscriptPlan(boardCandidates())
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
  let staffSpawning = false
  let staffRetryAfter = 0
  let staffFleet = 'opencode'
  async function staffTick(): Promise<void> {
    if (!config.staff) return
    for (const id of dueScheduledDirectives(loadDirectives(stateDir), Date.now())) {
      appendDirectiveEvent(stateDir, { type: 'directive_dispatched', ts: new Date().toISOString(), directiveId: id })
      console.log(`[stardeck] 定时命令到点派发 ${id}`)
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
      // 大副随舰队（定案 2026-09-02）：舰队绑谁大副跑谁；codex 实弹受阻
      //（README 在档）诚实回退 opencode 并打点。
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
      staffSession = await spawnStaffAgent({
        brief: staffOrderFor(items, flags, staffFleet === 'pi' ? 'pi-extension' : 'mcp'),
        workspacePath: join(stateDir, 'staff'),
        http: base,
        agentId,
        model: staffFleet === 'zcode' ? '' : activeModel, // 大副随舰队：模型串随板面绑定；zcode 引擎吃自身 config 不透传
        executor: staffFleet,
        executorBin: binFor(staffFleet),
        stateDir,
      })
      console.log(`[stardeck] 大副应征 ${agentId}（${staffFleet} 席，工单 ${items.length} 件，日志 ${staffSession.logPath}）`)
    } finally {
      staffSpawning = false
    }
  }
  const staffTimer = setInterval(() => {
    void staffTick().catch(err => console.error('[stardeck] 大副 tick 异常（跳过本轮）:', err instanceof Error ? err.message : err))
  }, 15_000)
  staffTimer.unref()

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

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
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
          return sendJson(res, 200, { ok: true, active: { executor: activeExecutor, model: activeModel }, seats: probeFleet(config.executorBin) })
        }
        if (key === 'POST /warroom/api/fleet') {
          const body = JSON.parse(await readBody(req)) as { executor?: unknown; model?: unknown }
          const executor = typeof body.executor === 'string' ? body.executor.trim() : ''
          if (executor === '') return sendJson(res, 400, { ok: false, error: 'executor 必填（opencode | pi | codex）。' })
          if (ADAPTERS[executor] === undefined) {
            // 契约席（copilot/amp/cursor/droid…）档案在档但适配器未实装——诚实拒绝绑定。
            const contract = fleetSeatIds().filter(id => ADAPTERS[id] === undefined)
            return sendJson(res, 400, { ok: false, error: fleetSeatIds().includes(executor) ? `${executor} 是契约席（spawn 适配器未实装——只登记可看，接入轮实装后开放绑定）。` : `未知舰队：${executor}（可绑：${bindableSeatIds().join(' | ')}）。` , contractSeats: contract })
          }
          activeExecutor = executor
          if (typeof body.model === 'string') activeModel = body.model.trim()
          console.log(`[stardeck] 舰队绑定 → ${activeExecutor}${activeModel !== '' ? ` @ ${activeModel}` : ''}（只影响后续征召与下一轮大副；在役执行者不动）`)
          // P0-2 落盘：重启不丢绑定（env 优先级不变；坏 JSON 拒绝覆盖——回执警示）。
          const persist = persistFleetBinding(activeExecutor, activeModel)
          if (!persist.ok) console.warn(`[stardeck] 舰队绑定未落盘：${persist.error}`)
          return sendJson(res, 200, { ok: true, active: { executor: activeExecutor, model: activeModel }, note: bindNoteFor(activeExecutor, activeModel), ...(persist.ok ? {} : { warning: `绑定已生效但未落盘：${persist.error}（重启后将回落启动配置）` }) })
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
