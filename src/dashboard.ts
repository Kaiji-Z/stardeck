/**
 * The strategic board HTTP API (web compositions only): the war map tab's
 * data source. GET /warroom/api/board returns the cross-workspace projection
 * — every task with status/workspace/troops/reports — plus the unit roster;
 * POST /warroom/api/active toggles war mode (dashboard-side activation
 * mirrors the /war semantics: surface syncs before responding).
 * @module dsh-plugin-warroom/dashboard
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { appendDirectiveEvent, chainHueSlot, deriveContinuation, loadDirectives, newDirectiveId, foldChains, pendingDirectives, readDirectiveEvents } from './directives.ts'
import type { ContinuationMode, ContinuationTaskFace } from './directives.ts'
import { appendEvent, listCampaignIds, loadCampaign, readEvents } from './events.ts'
import { appendThreadEvent, loadAttachedThreads } from './threads.ts'
import { appendBridgeEvent, loadBridgeMessages } from './bridge.ts'
import { assertCronUsable, nextRunOf } from './schedule.ts'
import { queuePositionOf } from './rules.ts'
import type { Roster } from './units.ts'
import type { WarStore } from './state.ts'
import type { CampaignState } from './types.ts'
import { armPlanCard, runSpikeProbe, type SpikeDeps } from './v5spike.ts'
import { planApprovedNotice, planRejectedNotice } from './persona.ts'
import { featureEnabled, type FeatureFlags } from './flags.ts'
import { loadPlanets, registerPlanet } from './planets.ts'

/** Structural slice of the harness webServer route registry. */
export interface RouteRegistry {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
}

/** Minimal structural req/res (Node-ish) — duck-typed, no host imports. */
interface ReqFace { method?: string; url?: string }
interface ResFace {
  setHeader?(k: string, v: string): void
  end(body?: string): void
  write?(chunk: string): unknown
  on?(event: string, cb: () => void): void
  /** C1（对抗审查 2026-09-23，插件仓回流）：真实 HTTP 状态码出线——send()
   *  写入。可选属性：假 res（纯路由测试）无此字段也能安全挂上；daemon 传入
   *  的是真 ServerResponse，赋值即真实生效（旧 `void code` 把全部
   *  400/401/404/409/413/500/501/502 都以 HTTP 200 出线）。 */
  statusCode?: number
}

/** 请求体上限（C2，插件仓回流）：64KB——超限立即停止累积并按 413 拒。 */
const BODY_LIMIT = 64 * 1024

/** 可识别的请求体错误（C2/C3，插件仓回流）：readBody/readJsonBody 抛出；
 * 外层 catch 按 `status` 出线，不再一律 500 回显 V8 原文。 */
class HttpBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Read a request body as a string (the commands POST channel).
 * C2 加固（插件仓回流）：64KB 上限（超限 413 拒）；补 error/aborted 监听
 * ——请求中途断线 resolve('')，不再挂起 handler。 */
function readBody(req: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = req as { on?(event: string, cb: (chunk?: unknown) => void): void }
    const parts: string[] = []
    if (r.on === undefined) {
      resolve('')
      return
    }
    let settled = false
    let size = 0
    const settle = (act: () => void): void => {
      if (settled) return
      settled = true
      act()
    }
    r.on('data', chunk => {
      if (settled) return
      const s = typeof chunk === 'string' ? chunk : String(chunk)
      size += s.length
      if (size > BODY_LIMIT) {
        settle(() => reject(new HttpBodyError('请求体超过 64KB 上限。', 413)))
        return
      }
      parts.push(s)
    })
    r.on('end', () => settle(() => resolve(parts.join(''))))
    r.on('error', () => settle(() => resolve('')))
    r.on('aborted', () => settle(() => resolve('')))
  })
}

/** C3（插件仓回流）：readBody + JSON.parse——坏 JSON 抛可识别错误按 400 干净
 * 文案出线（旧路：裸 JSON.parse 的 SyntaxError 落外层 catch 出 500 并回显
 * V8 原文如 "Unexpected end of JSON input"）。 */
async function readJsonBody(req: unknown): Promise<unknown> {
  const text = await readBody(req)
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpBodyError('请求体不是合法 JSON。', 400)
  }
}

/** C4 反射截断（插件仓回流）：错误文案里对入参的反射最多 120 字符
 * ——10KB 入参不再整段回显。 */
function clipForError(s: string): string {
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

/** realpath 的宽容版：目标不存在时向上找到最近存在祖先做 realpath，再把
 *  余下尾段拼回（守卫要对「尚不存在的产物名」放行到下游 404，不能误拒）。 */
function realpathLoose(p: string): string {
  let tail: string[] = []
  let cur = resolve(p)
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail)
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return resolve(p)
      tail.unshift(basename(cur))
      cur = parent
    }
  }
}

/** V19 战报可读性·纯守卫：产物文件访问的 war_root 双重限界（tests 管辖）。
 *  解析后的绝对路径必须同时落在 war_root 与所报工作区之下——`../` 穿越、
 *  绝对路径顶替、跨任务工作区串门全部拒绝；realpath 二次核对拦下符号链接
 *  指向界外目标的绕行（resolve 不跟链接，V19.12 攻防实测抓到）。返回
 *  null=放行。 */
export function workspaceFileGuardError(warRoot: string, ws: string, name: string): string | null {
  if (ws.trim() === '' || name.trim() === '') return '缺少工作区或文件名参数'
  // name 必须是相对路径：绝对路径（盘符/根斜杠）显式拒绝——join 不重置绝对段，
  // 会拼出「ws/C:/x」这类怪路径（stat 必败），语义上仍按穿越面拒掉。
  if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith('/') || name.startsWith('\\')) return '文件路径越出工作区（拒绝路径穿越）'
  const root = resolve(warRoot)
  const wsAbs = resolve(ws)
  const file = resolve(join(wsAbs, name))
  const inside = (base: string, target: string): boolean => target === base || target.startsWith(base + sep)
  if (!inside(root, wsAbs)) return '该工作区不在 war_root 管辖内，拒绝访问'
  if (!inside(wsAbs, file)) return '文件路径越出工作区（拒绝路径穿越）'
  // realpath 跟随符号链接后的落点仍须在界内（ws 与文件都核——界内链接指向
  // 界外是 V19.12 实证的绕行面）。
  const realFile = realpathLoose(file)
  const realWs = realpathLoose(wsAbs)
  const realRoot = realpathLoose(root)
  if (!inside(realRoot, realWs)) return '该工作区不在 war_root 管辖内，拒绝访问'
  if (!inside(realWs, realFile)) return '文件路径越出工作区（拒绝路径穿越）'
  return null
}

/**
 * Cheap board revision: a sha1 signature over the campaign logs' name+mtime+
 * size, the shared directive log, and the global state file. SSE frames carry
 * ONLY this — clients refetch the full projection when it moves (the
 * wire discipline: never ship task lists on the event channel).
 *
 * V9.11 R2: optional activitySalt folds the in-memory exec-activity verbs into
 * the revision (salt changes only when a VERB changes — same-verb tool streams
 * don't churn the SSE). Discipline intact: the channel still ships rev only.
 */
export function boardRevision(stateDir: string, activitySalt?: string): string {
  let sig = ''
  try {
    const dir = join(stateDir, 'campaigns')
    for (const f of readdirSync(dir).filter(x => x.endsWith('.jsonl')).sort()) {
      const st = statSync(join(dir, f))
      sig += `${f}:${st.mtimeMs}:${st.size};`
    }
  } catch {
    // No campaigns directory yet — an empty board still has a revision.
  }
  try {
    const st = statSync(join(stateDir, 'directives.jsonl'))
    sig += `directives:${st.mtimeMs}:${st.size};`
  } catch {
    // 未建账——空板仍有 revision。
  }
  try {
    const st = statSync(join(stateDir, 'planets.jsonl'))  // V18：星球注册入 revision（SSE 推板刷新）
    sig += `planets:${st.mtimeMs}:${st.size};`
  } catch {
    sig += 'planets:-;' // C6（插件仓回流）：复制粘贴错写的 'directives:-;' 正名（缺档标签语义）
  }
  try {
    const st = statSync(join(stateDir, 'threads.jsonl'))
    sig += `threads:${st.mtimeMs}:${st.size};`
  } catch {
    sig += 'threads:-;'
  }
  try {
    // D26 舰桥频道（v0.3.0）：第六账本入 revision——SSE rev 变化即聊天窗/板
    // 双双刷新（分屏旁观「看板被聊天驱动」的数据面）。
    const st = statSync(join(stateDir, 'bridge.jsonl'))
    sig += `bridge:${st.mtimeMs}:${st.size};`
  } catch {
    sig += 'bridge:-;'
  }
  try {
    const st = statSync(join(stateDir, 'state.json'))
    sig += `state:${st.mtimeMs}:${st.size}`
  } catch {
    sig += 'state:-'
  }
  if (activitySalt !== undefined) sig += `;activity:${activitySalt}`
  return createHash('sha1').update(sig).digest('hex').slice(0, 12)
}

export interface DashboardDeps {
  store: WarStore
  stateDir: string
  roster(): Roster
  /** War root (informational — the client no longer creates sessions here). */
  warRoot: string
  /** v5 R1 机制验证探针（flag `v5-spike`）。缺省 undefined → 探针路由
   * 404，宿主面行为与改前字节等价。 */
  spike?: SpikeDeps
  /** Feature flags（V5-R2 起 dashboard 需要判档位账本路由的开关）。 */
  flags?: FeatureFlags
  /** K17 计划判定回推：把舰长的批/驳结果投回大副会话（index 经 sessions
   *  面接线；缺席/失败 best-effort，不阻塞判定入账）。 */
  pushToStaff?: (sessionId: string, text: string) => void
  /** P0-1 板内答复（2026-09-02）：talking 命令的舰长答复 → pi RPC 续跑大副会话。
   *  daemon 注入实现；缺席 → /commands/answer 501（纯路由测试可省略）。
   *  D26：channel 入参（'board'|'bridge'）——审计可分对话面/板面来源，缺省 board。 */
  answerCommand?: (commandId: string, text: string, channel?: string) => Promise<{ ok: true; note: string } | { ok: false; error: string }>
  /** D26 舰桥频道开关（daemon 注入 config.bridge；缺省 false=旗 OFF 面：bridge
   *  三端点 404、/board 不带 bridge 字段——与改前字节等价）。 */
  bridgeEnabled?: boolean
  /** D27 代理舰长席运行态（daemon 注入；缺省=proxy 在役/未授权——纯路由测试
   *  可省略）：/board bridge 面据此带 proxy/verdictAuthorized，聊天窗降级态
   *  与授权钮的数据源。setProxyVerdict=舰长显式授权/收回（运行态，不落盘）。 */
  bridgeProxy?: {
    proxy: () => boolean
    proxyVerdict: () => boolean
    setProxyVerdict: (granted: boolean) => void
  }
  /** P1-5 优雅停服（CLI stop 面）：缺席 → /shutdown 501（纯路由测试可省略）。 */
  shutdown?: () => void
  /** v3: fired after a command card is created — the host ticks the command
   * fuse NOW so the staff receives in ~1s instead of waiting out the 15s
   * interval. Optional so pure-route tests can omit it. */
  onCommandCreated?: () => void
  /** V9.11 R2 执行卡实时活动（只读）：session/event → 动词的内存滚动表。
   * 缺席时投影不带 activity 字段、revision 不含活动盐——纯路由测试可省略。 */
  activity?: {
    salt(): string
    snapshot(sessionId: string): { verb: string; label: string; ts: string } | null
  }
  /** V17 归档扇出：逐会话调宿主 workspaces.archiveSession（不可逆）。
   *  缺席 → /warroom/api/archive 报「宿主归档通道未接入」（Stop-if 探针）。 */
  archiveSession?: (sessionId: string) => Promise<{ ok: true } | { ok: false; code: string; message: string }>
  /** V17 归档核查（只读）：宿主当前会话 id 清单（A-③ 判据用）。缺席返回 null。 */
  listSessions?: () => Promise<string[] | null>
  /** P1-7 独立形态派生（2026-09-02）：无宿主面时的本地会话清单（attach-map
   *  会话号并集 + 在役执行者）与工作区清单（war_root 目录扫描）——V17 归档
   *  核查/V18 HQ 弹窗在独立形态随之复活（宿主面仍优先）。 */
  localSessions?: () => string[]
  localWorkspaces?: () => Array<{ workspaceId: string; path: string; title: string; sessionCount: number }> | null
  /** D32 流式上屏（只读快照）：内置 loop 打字机缓冲（seq 变化=有新字）。
   *  缺席时 SSE 帧保持 rev-only（纯路由测试可省略）。 */
  proxyLive?: () => { seq: number; text: string; reasoning: string; tools: Array<{ label: string; done: boolean; detail?: string }> }
  /** D36-A 发话即应答：bridge/messages 入账成功后的立即触发钩子（daemon 注入
   *  proxyTick；缺席=SSE 纯路由测试照旧，15s 哨位兜底不变）。 */
  bridgeKick?: () => void
  /** V18 HQ 工作区注册弹窗：宿主 workspace.list（只读；缺席如实报 null）。 */
  listWorkspaces?: () => Promise<Array<{ workspaceId: string; path: string; title: string; sessionCount: number }> | null>
  /** V18 注册时把真实目录幂等收编进宿主 registry（best-effort，失败不阻塞）。 */
  registerHostWorkspace?: (path: string) => Promise<{ ok: boolean; title?: string }>
  /** B1-件② trace 端点的征召视角（只读）：内存态 spawned 守卫 + 去抖拒因表。
   *  缺席 → trace 的 conscription 字段如实 null（纯路由测试可省略）。 */
  conscription?: () => { spawned: readonly string[]; skips: Readonly<Record<string, string>> }
  /** B1-件⑥ 收官清理：链归档后对成员任务 worktree best-effort 释放（index 侧
   *  接 workspace.ts releaseTaskWorkspace）。缺席 → 归档照常、不清理。 */
  releaseWorkspace?: (path: string) => { ok: boolean; note: string }
}

const STATUS_ORDER: Record<CampaignState['status'], number> = { published: 0, in_progress: 1, reported: 2, draft: 3, failed: 4, closed: 5 }

/** The board projection served to the war map (pure — reusable by tests). */
export function boardProjection(stateDir: string, activityOf?: (sessionId: string) => { verb: string; label: string; ts: string } | null): Record<string, unknown>[] {
  const campaigns = listCampaignIds(stateDir)
    .map(id => loadCampaign(stateDir, id))
    .filter(t => t.startedAt !== '')
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
      || ((b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0))
      || (a.startedAt < b.startedAt ? -1 : 1))
  // V7-⑤ 排队位次的候选视图（与 index.ts 征召器同构：campaignId → taskId）。
  const asCandidate = (t: CampaignState) => ({ taskId: t.campaignId, status: t.status, workspacePath: t.workspacePath, priority: t.priority, startedAt: t.startedAt })
  const candidates = campaigns.map(asCandidate)
  return campaigns
    .map(task => {
      let nextRunAt: string | null = null
      if (task.schedule !== undefined && task.schedule.enabled) {
        const anchor = task.schedule.lastTriggeredAt !== undefined ? Date.parse(task.schedule.lastTriggeredAt) : Date.parse(task.startedAt)
        if (Number.isFinite(anchor)) {
          try {
            const next = nextRunOf(task.schedule.cron, anchor)
            if (next !== undefined) nextRunAt = new Date(next).toISOString()
          } catch { /* invalid stored cron — the projection stays null */ }
        }
      }
      return {
        taskId: task.campaignId,
        title: task.title ?? task.intent,
        status: task.status,
        priority: task.priority ?? 'normal',
        quality: task.quality ?? 'common',
        rounds: task.rounds,
        attempts: task.attempts,
        deps: task.deps ?? [],
        lastError: task.lastError ?? null,
        workspacePath: task.workspacePath ?? null,
        workspaceKind: task.workspaceKind ?? null,
        claimedBy: task.claimedBy ?? null,
        executorSeat: task.executorSeat ?? null,
        startedAt: task.startedAt,
        brief: task.brief ?? '',
        acceptance: task.acceptance ?? '',
        schedule: task.schedule === undefined ? null : { cron: task.schedule.cron, enabled: task.schedule.enabled, nextRunAt },
        // V7-⑤ 只读加料「为什么还没动」：征召排队位次（0=现在可征召）+
        // 配额暂停位。可选字段——既有消费者不读即不受影响（红线只禁写）。
        queueAhead: queuePositionOf(asCandidate(task), candidates),
        quotaPaused: task.quotaPaused === true,
        // Session cards: every commander attempt with its conversation id.
        // (Named attemptLog — `attempts` is already the numeric count.)
        // V9.11 R2: live attempts carry the exec-activity verb (read-only
        // projection add-on; absent when no tracker is wired).
        attemptLog: task.attemptLog.map(a => ({
          id: a.id,
          n: a.n,
          sessionId: a.sessionId,
          startedAt: a.startedAt,
          endedAt: a.endedAt ?? null,
          outcome: a.outcome ?? null,
          ...(a.outcome === undefined && activityOf !== undefined ? { activity: activityOf(a.sessionId) } : {}),
        })),
        troops: [...task.units.values()].map(u => ({
          childId: u.childId,
          label: u.label,
          unit: u.unitName,
          front: u.front,
          recalled: u.recalled !== undefined,
          settled: u.settled !== undefined,
          lastReport: u.lastReport ?? null,
        })),
        deliverables: task.deliverables.map(d => ({ kind: d.kind, summary: d.summary, detail: d.detail ?? null, ts: d.ts })),
        reports: task.reports.map(r => ({ ts: r.ts, from: r.from, text: r.text, evidence: r.evidence ?? null, testsTrail: r.testsTrail ?? null })),
        comments: task.comments.map(c => ({ ts: c.ts, from: c.from, text: c.text })),
        closedVerdict: task.closedVerdict ?? null,
      }
    })
}

/** A scheduled bounty the 30s tick must act on right now. Pure. */
export interface DueBounty {
  readonly taskId: string
  /** true = open the next round; false = previous round still busy, skip. */
  readonly openRound: boolean
  readonly reason: string
}

/**
 * Which cron bounties are due at `nowMs`? The anchor is the LAST trigger (or
 * task creation), so a long gap collapses into one fire — 错过即跳过, never
 * backfill (the anti-burn rule).
 */
export function dueBounties(stateDir: string, nowMs: number): DueBounty[] {
  const out: DueBounty[] = []
  for (const id of listCampaignIds(stateDir)) {
    const task = loadCampaign(stateDir, id)
    if (task.startedAt === '' || task.schedule === undefined || !task.schedule.enabled) continue
    const anchor = task.schedule.lastTriggeredAt !== undefined ? Date.parse(task.schedule.lastTriggeredAt) : Date.parse(task.startedAt)
    if (!Number.isFinite(anchor)) continue
    try {
      const next = nextRunOf(task.schedule.cron, anchor)
      if (next !== undefined && next <= nowMs) {
        const busy = task.status === 'published' || task.status === 'in_progress' || task.status === 'reported'
        out.push(busy
          ? { taskId: id, openRound: false, reason: `上一轮尚未收官，本次到点跳过、不补跑` }
          : { taskId: id, openRound: true, reason: '到点重开任务令' })
      }
    } catch {
      // Stored cron turned invalid — publish-time validation already guards new ones.
    }
  }
  return out
}

/** The 命令区 projection served to the war map (pure — reusable by tests). */
export function directiveProjection(stateDir: string): Record<string, unknown>[] {
  const directives = loadDirectives(stateDir)
  // V10 战线链身份：一次祖先闭包喂全部命令卡（世代/链根/链长/链色槽）。
  const chains = foldChains(directives)
  return directives.map(d => {
    // V9.2 定时下达：未发（dispatchedAt 空）才报 nextRunAt——发完即常轨命令。
    let nextRunAt: string | null = null
    if (d.schedule !== undefined && d.schedule.dispatchedAt === undefined) {
      try {
        const next = nextRunOf(d.schedule.cron, Date.parse(d.createdAt))
        if (next !== undefined) nextRunAt = new Date(next).toISOString()
      } catch { /* invalid stored cron — projection stays null */ }
    }
    return {
      commandId: d.id,
      text: d.text,
      name: d.name ?? null,
      createdAt: d.createdAt,
      status: d.status,
      // D27 下令来源（旧命令 null=舰长亲手语义；proxy-…=代理舰长席拟令）。
      issuedBy: d.issuedBy ?? null,
      staffSessionId: d.staffSessionId ?? null,
      taskId: d.taskId ?? null,
      cancelledReason: d.cancelledReason ?? null,
      // V5 档位账本：档位/理由/置信度/舰长改档次数（未分诊为 null）。
      grade: d.grade ?? null,
      gradeReason: d.gradeReason ?? null,
      gradeConfidence: d.gradeConfidence ?? null,
      regrades: d.regrades ?? 0,
      // V5-R3 计划态：当前计划文本与判定状态（未呈报为 null）。
      plan: d.plan === undefined ? null : { text: d.plan.text, status: d.plan.status, decidedAt: d.plan.decidedAt ?? null },
      // V9.2 定时下达（未定时为 null）。
      schedule: d.schedule === undefined
        ? null
        : { cron: d.schedule.cron, dispatchedAt: d.schedule.dispatchedAt ?? null, nextRunAt },
      // V10 战线链身份（初代也给 chain 对象——generation=1 客户端免分支）。
      chain: (() => {
        const gen = chains.generationOf.get(d.id) ?? 1
        const rootId = chains.rootByCommand.get(d.id) ?? d.id
        const length = chains.membersOfRoot.get(rootId)?.length ?? 1
        return { generation: gen, rootId, length, hueSlot: chainHueSlot(rootId) }
      })(),
      continuation: d.continuation === undefined ? null : { mode: d.continuation.mode },
      // V17 归档（未入档为 null）：宿主会话已 archiveSession 的账面痕迹。
      archived: d.archived === undefined ? null : { at: d.archived.at, sessions: d.archived.sessions },
      // D23 澄清协议（2026-09-08，只读投影）：挂起/答复态+问答史、任务书五项——
      // 舰长在命令卡能看到大副问了什么、定了什么案（写通道仍只有 composer/答复）。
      // V21.4 选择题式：options 逐问选项（开放问 []，旧日志缺省 undefined→null）。
      clarification: d.clarification === undefined
        ? null
        : {
          questions: d.clarification.questions,
          ...(d.clarification.options !== undefined ? { options: d.clarification.options } : {}),
          round: d.clarification.round,
          status: d.clarification.status,
          answer: d.clarification.answer ?? null,
        },
      // D23 第四刀会议室时间轴（只读投影）：全轮问答史——场所化渲染的数据面。
      clarificationRounds: d.clarificationRounds === undefined
        ? null
        : d.clarificationRounds.map(r => ({
          round: r.round,
          questions: r.questions,
          ...(r.options !== undefined ? { options: r.options } : {}),
          answer: r.answer ?? null,
          requestedAt: r.requestedAt,
        })),
      brief: d.brief === undefined ? null : { goal: d.brief.goal, background: d.brief.background, acceptance: d.brief.acceptance, nonGoals: d.brief.nonGoals, deliverables: d.brief.deliverables },
      // D24 两档制（只读投影）：签发定稿文本 + 待签态——会议室据此渲染可编辑
      // 五项卡与签发/驳回；awaitingSign=呈批件来自任务书的新流程（老 plan 流
      // 程 brief 缺席 → 走旧决策带，互不干扰）。
      briefSigned: d.briefSigned === undefined ? null : { goal: d.briefSigned.goal, background: d.briefSigned.background, acceptance: d.briefSigned.acceptance, nonGoals: d.briefSigned.nonGoals, deliverables: d.briefSigned.deliverables },
      awaitingSign: d.plan?.status === 'pending' && d.brief !== undefined,
    }
  })
}

/**
 * D26 舰队全况 digest（纯读盘组装）：经理人「报战况」的紧凑底料（工单附页/
 * /bridge/digest 端点共用）。四段封顶——pendingDecisions（collectInbox 语义的
 * 服务端化：plan 待签优先于 talking 澄清；reported=待验收；failed=待重试）+
 * commands（活跃命令摘要）+ tasks（活跃任务含最新战报节选）+ stats。token
 * 友好：标题/战报截断、条目封顶，绝不给全量板。
 */
export interface BridgeDigest {
  generatedAt: string
  pendingDecisions: Array<{ kind: 'clarify' | 'sign' | 'review' | 'retry'; refId: string; title: string; since: string }>
  commands: Array<{ commandId: string; status: string; grade: string | null; title: string }>
  tasks: Array<{ taskId: string; title: string; status: string; attempts: number; latestReport: string | null }>
  stats: { commands: number; tasks: number; inProgress: number; reported: number; failed: number }
}

export function bridgeDigest(stateDir: string, now = new Date()): BridgeDigest {
  const clip = (s: string, n: number): string => {
    const t = s.replaceAll('\n', ' ').trim()
    return t.length > n ? `${t.slice(0, n)}…` : t
  }
  const directives = loadDirectives(stateDir)
  const pendingDecisions: BridgeDigest['pendingDecisions'] = []
  for (const d of directives) {
    if (d.status === 'approved' || d.status === 'cancelled') continue
    if (d.plan?.status === 'pending') pendingDecisions.push({ kind: 'sign', refId: d.id, title: clip(d.text, 80), since: d.createdAt })
    else if (d.status === 'talking' || d.clarification?.status === 'pending') pendingDecisions.push({ kind: 'clarify', refId: d.id, title: clip(d.text, 80), since: d.createdAt })
  }
  const tasks = listCampaignIds(stateDir).map(id => loadCampaign(stateDir, id)).filter(t => t.startedAt !== '')
  for (const t of tasks) {
    if (t.status === 'reported') {
      const last = t.reports.length > 0 ? t.reports[t.reports.length - 1]!.ts : t.startedAt
      pendingDecisions.push({ kind: 'review', refId: t.campaignId, title: clip(t.title ?? t.intent, 80), since: last })
    }
    if (t.status === 'failed') {
      pendingDecisions.push({ kind: 'retry', refId: t.campaignId, title: clip(t.title ?? t.intent, 80), since: t.startedAt })
    }
  }
  pendingDecisions.sort((a, b) => (a.since < b.since ? -1 : 1))
  const activeCmds = directives
    .filter(d => d.status !== 'approved' && d.status !== 'cancelled')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8)
    .map(d => ({ commandId: d.id, status: d.status, grade: d.grade ?? null, title: clip(d.text, 60) }))
  const activeTasks = tasks
    .filter(t => t.status !== 'closed')
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 8)
    .map(t => ({
      taskId: t.campaignId, title: clip(t.title ?? t.intent, 60), status: t.status, attempts: t.attempts,
      latestReport: t.reports.length > 0 ? clip(t.reports[t.reports.length - 1]!.text, 200) : null,
    }))
  return {
    generatedAt: now.toISOString(),
    pendingDecisions,
    commands: activeCmds,
    tasks: activeTasks,
    stats: {
      commands: directives.length,
      tasks: tasks.length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      reported: tasks.filter(t => t.status === 'reported').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    },
  }
}

/** D28 知识面：账本切片条目（代理舰长「百事通」数据底料）。只读派生——
 * 账本为源，本切片不另立账（摘要 clip 100，字段从事件常见载荷宽选取）。 */
export interface LedgerEntry { kind: 'directive' | 'task'; type: string; ts: string; id: string; summary: string }

const LEDGER_SUMMARY_FIELDS = ['text', 'goal', 'note', 'verdict', 'reason', 'title', 'status', 'cron', 'intent', 'report'] as const

function ledgerSummarize(e: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of LEDGER_SUMMARY_FIELDS) {
    const v = e[key]
    if (typeof v === 'string' && v !== '') parts.push(v)
  }
  const q = e['questions']
  if (Array.isArray(q)) parts.push(q.filter((x): x is string => typeof x === 'string').join('；'))
  const t = parts.join(' · ').replaceAll('\n', ' ').trim()
  return t.length > 100 ? `${t.slice(0, 100)}…` : t
}

function ledgerDirectiveEntries(stateDir: string): LedgerEntry[] {
  return readDirectiveEvents(stateDir).map(e => {
    const rec = e as unknown as Record<string, unknown>
    return { kind: 'directive' as const, type: String(rec['type'] ?? ''), ts: String(rec['ts'] ?? ''), id: String(rec['directiveId'] ?? ''), summary: ledgerSummarize(rec) }
  })
}

function ledgerTaskEntries(stateDir: string): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const taskId of listCampaignIds(stateDir)) {
    for (const e of readEvents(stateDir, taskId)) {
      const rec = e as unknown as Record<string, unknown>
      out.push({ kind: 'task', type: String(rec['type'] ?? ''), ts: String(rec['ts'] ?? ''), id: taskId, summary: ledgerSummarize(rec) })
    }
  }
  return out
}

/** D28 知识面·提示词切片：directive 事件尾 30 + 跨任务 task 事件尾 30，按时间
 * 升序合并（近事全通，token 封顶可控——两尾各管各的，互不挤占）。 */
export function ledgerSlice(stateDir: string, directiveCap = 30, taskCap = 30): LedgerEntry[] {
  return [...ledgerDirectiveEntries(stateDir).slice(-directiveCap), ...ledgerTaskEntries(stateDir).slice(-taskCap)]
    .sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

/**
 * B1-件② 单命令追踪投影（纯，只读——板是读投影红线内的调试面）：命令摘要 +
 * 该命令的原始 directive 事件时间线 + 关联任务（复用板投影：attemptLog /
 * queueAhead / quotaPaused 全在）+ 其原始 campaign 事件 + 引信/征召视角。
 * 缺参 400；未知命令 404。
 */
export function traceProjection(
  stateDir: string,
  commandId: string,
  conscription?: { spawned: readonly string[]; skips: Readonly<Record<string, string>> },
): { ok: false; code: 400 | 404; error: string } | { ok: true; command: Record<string, unknown>; timeline: { directive: unknown[]; campaign: unknown[] }; task: Record<string, unknown> | null; fuse: { pendingRelay: boolean; scheduledPending: boolean }; conscription: { spawned: readonly string[]; skips: Readonly<Record<string, string>>; spawnedForTask: boolean; skipReasonForTask: string | null } | null } {
  if (commandId === '') return { ok: false, code: 400, error: '缺少 commandId（用法：/warroom/api/trace?commandId=<命令号>）。' }
  const d = loadDirectives(stateDir).find(x => x.id === commandId)
  if (d === undefined) return { ok: false, code: 404, error: `命令 ${clipForError(commandId)} 不存在。` } // C4（插件仓回流）：入参反射截断
  const campaignEvents = d.taskId !== undefined ? readEvents(stateDir, d.taskId) : []
  const task = d.taskId !== undefined
    ? (boardProjection(stateDir) as Array<Record<string, unknown>>).find(t => t.taskId === d.taskId) ?? null
    : null
  return {
    ok: true,
    command: {
      id: d.id, text: d.text, name: d.name ?? null, createdAt: d.createdAt, status: d.status,
      staffSessionId: d.staffSessionId ?? null, taskId: d.taskId ?? null,
      grade: d.grade ?? null, gradeReason: d.gradeReason ?? null,
      plan: d.plan === undefined ? null : { status: d.plan.status, text: d.plan.text },
      schedule: d.schedule === undefined ? null : { cron: d.schedule.cron, dispatchedAt: d.schedule.dispatchedAt ?? null },
      continuation: d.continuation === undefined ? null : { mode: d.continuation.mode, parentId: d.continuation.parentId },
      cancelledReason: d.cancelledReason ?? null,
    },
    timeline: {
      directive: readDirectiveEvents(stateDir).filter(e => e.directiveId === commandId),
      campaign: campaignEvents,
    },
    task,
    // 引信视角：draft 且未到点的定时令是引信可见的待转达量。
    fuse: {
      pendingRelay: pendingDirectives([d]).length > 0,
      scheduledPending: d.schedule !== undefined && d.schedule.dispatchedAt === undefined,
    },
    conscription: conscription === undefined ? null : {
      spawned: conscription.spawned,
      skips: conscription.skips,
      spawnedForTask: d.taskId !== undefined && conscription.spawned.includes(d.taskId),
      skipReasonForTask: (d.taskId !== undefined ? conscription.skips[d.taskId] : undefined) ?? null,
    },
  }
}

/**
 * Register `/warroom` routes on the web server.
 * @returns the registration disposer.
 */
export function registerDashboard(webServer: RouteRegistry, deps: DashboardDeps): () => void {
  const handler = async (req: unknown, res: unknown): Promise<void> => {
    const r = req as ReqFace
    const w = res as ResFace
    const pathname = new URL(r.url ?? '/', 'http://local').pathname
    const send = (code: number, body: unknown): void => {
      w.statusCode = code // C1（插件仓回流）：状态码真实写入（真 ServerResponse 赋值即生效）
      w.setHeader?.('content-type', 'application/json; charset=utf-8')
      w.end(JSON.stringify(body))
    }
    try {
      if (r.method === 'GET' && pathname === '/warroom/api/loop-config' && deps.loopConfig !== undefined) {
        send(200, { ok: true, ...deps.loopConfig.get() })
        return
      } else if (r.method === 'POST' && pathname === '/warroom/api/loop-config' && deps.loopConfig !== undefined) {
        const raw = JSON.parse(await readBody(r) || '{}') as { model?: unknown; baseUrl?: unknown; apiKey?: unknown }
        const patch: { model?: string; baseUrl?: string; apiKey?: string } = {}
        if (typeof raw.model === 'string') patch.model = raw.model.trim()
        if (typeof raw.baseUrl === 'string') patch.baseUrl = raw.baseUrl.trim().replace(/\/+$/, '')
        if (typeof raw.apiKey === 'string') patch.apiKey = raw.apiKey.trim()
        send(200, { ok: true, saved: deps.loopConfig.save(patch) })
        return
      } else if (r.method === 'POST' && pathname === '/warroom/api/loop-test' && deps.loopConfig !== undefined) {
        // P1 修（D33 critique A 八轮）：body 可携所见字段覆盖（未保存先测）——
        // 空 body=测已存配置。
        const raw = JSON.parse(await readBody(r) || '{}') as { baseUrl?: unknown; apiKey?: unknown }
        const overrides: { baseUrl?: string; apiKey?: string } = {}
        if (typeof raw.baseUrl === 'string') overrides.baseUrl = raw.baseUrl
        if (typeof raw.apiKey === 'string') overrides.apiKey = raw.apiKey
        send(200, { ok: true, probe: await deps.loopConfig.test(overrides) })
        return
      } else if (r.method === 'GET' && pathname === '/warroom/api/board') {
        send(200, {
          ok: true,
          active: deps.store.get().active,
          warRoot: deps.warRoot,
          hqSessionId: deps.store.get().hqSessionId ?? null,
          revision: boardRevision(deps.stateDir, deps.activity?.salt()),
          // D26 舰桥频道（旗 ON 面才有此字段）：客户端据此决定默认脸面=聊天窗。
          // D27：bridge 面带代理舰长在役/授权态——聊天窗降级与授权钮的数据源。
          ...(deps.bridgeEnabled === true ? {
            bridge: {
              enabled: true,
              proxy: deps.bridgeProxy?.proxy() ?? true,
              verdictAuthorized: deps.bridgeProxy?.proxyVerdict() ?? false,
            },
          } : {}),
          commands: directiveProjection(deps.stateDir),
          tasks: boardProjection(deps.stateDir, deps.activity?.snapshot.bind(deps.activity)),
          threads: loadAttachedThreads(deps.stateDir).map(t => ({ sessionId: t.sessionId, note: t.note, attachedAt: t.attachedAt })),
          roster: deps.roster().units.map(u => ({ name: u.name, label: u.label, description: u.description, sandboxMode: u.sandboxMode, source: u.source })),
          rosterErrors: deps.roster().errors,
          planets: loadPlanets(deps.stateDir),
        })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/host-workspaces') {
        // V18 HQ 点击弹窗数据源：宿主 registry 全量工作区（只读）。
        let workspaces: Array<{ workspaceId: string; path: string; title: string; sessionCount: number }> | null = null
        if (deps.listWorkspaces !== undefined) workspaces = await deps.listWorkspaces()
        else if (deps.localWorkspaces !== undefined) workspaces = deps.localWorkspaces()
        if (workspaces === null) {
          send(501, { ok: false, error: '工作区清单暂不可用（宿主面与独立派生均缺席）。' })
          return
        }
        send(200, { ok: true, workspaces })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/workspace/file') {
        // V19 战报可读性：产物板内预览（只读端点）。双重限界见 workspaceFileGuardError；
        // 大小封顶 512KB；首 1KB 含 NUL 判二进制（板面不渲染，指路「打开所在文件夹」）。
        const q = new URL(r.url ?? '/', 'http://local').searchParams
        const ws = q.get('ws') ?? ''
        const name = q.get('name') ?? ''
        const guardErr = workspaceFileGuardError(deps.warRoot, ws, name)
        if (guardErr !== null) { send(403, { ok: false, error: guardErr }); return }
        const file = resolve(join(resolve(ws), name))
        try {
          const st = statSync(file)
          if (!st.isFile()) { send(404, { ok: false, error: '不是文件（可能是目录）' }); return }
          if (st.size > 512 * 1024) { send(413, { ok: false, error: '文件超过 512KB，请用「打开所在文件夹」查看' }); return }
          const content = readFileSync(file, 'utf8')
          const binary = content.slice(0, 1024).includes('\0')
          send(200, { ok: true, path: file, name, size: st.size, binary, content: binary ? '' : content })
        } catch {
          send(404, { ok: false, error: '文件不存在或不可读' })
        }
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/workspace/reveal') {
        // V19 战报可读性：本机资源管理器落到产物所在目录（jump-TUI 同款本机 spawn
        // 先例；不开任何写通道——账本零改动）。限界与 file 端点同一守卫。
        const body = await readJsonBody(r) as { ws?: unknown; name?: unknown }
        const ws = typeof body.ws === 'string' ? body.ws : ''
        const name = typeof body.name === 'string' ? body.name : ''
        const guardErr = workspaceFileGuardError(deps.warRoot, ws, name === '' ? 'x' : name)
        if (guardErr !== null && name === '') {
          // 无 name=直接开工作区目录：仍须在 war_root 内，走只校验 ws 的简化守卫。
          if (ws.trim() === '') { send(403, { ok: false, error: '缺少工作区参数' }); return }
          const root = resolve(deps.warRoot), wsAbs = resolve(ws)
          if (!(wsAbs === root || wsAbs.startsWith(root + sep))) { send(403, { ok: false, error: '该工作区不在 war_root 管辖内，拒绝访问' }); return }
        } else if (guardErr !== null) { send(403, { ok: false, error: guardErr }); return }
        const target = name === '' ? resolve(ws) : resolve(join(resolve(ws), name))
        let dir = target
        try { if (statSync(target).isFile()) dir = join(target, '..') } catch { /* 目标缺席也允许开目录（资源管理器自己给反馈） */ }
        const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        try {
          const p = spawn(opener, [dir], { detached: true, stdio: 'ignore' })
          p.unref()
          send(200, { ok: true, dir })
        } catch (err) {
          send(500, { ok: false, error: `打开目录失败：${err instanceof Error ? err.message : String(err)}` })
        }
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/planets') {
        // V18 注册工作区为星球：闸=磁盘真实目录（定案：星球不得是「不存在
        // 文件夹的行星」）；宿主 registry 收编 best-effort（幂等 create）。
        const body = await readJsonBody(r) as { path?: unknown; title?: unknown }
        const path = typeof body.path === 'string' ? body.path.trim() : ''
        const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : null
        if (path === '') { send(400, { ok: false, error: '缺少工作区路径。' }); return }
        let isDir = false
        try { isDir = statSync(path).isDirectory() } catch { isDir = false }
        if (!isDir) { send(400, { ok: false, error: `不是真实目录：${path}` }); return }
        let hostTitle: string | null = title
        if (deps.registerHostWorkspace !== undefined) {
          const r2 = await deps.registerHostWorkspace(path)
          if (r2.ok && r2.title !== undefined) hostTitle = hostTitle ?? r2.title
        }
        const planets = registerPlanet(deps.stateDir, path, hostTitle)
        send(200, { ok: true, planets })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/commands') {
        // The 命令区 + button: create a draft command card; the command fuse
        // relays it into the staff conversation within 15s. V9.2: optional
        // cron = 定时下达（到点 tick 补 dispatched 后引信才取；一次性）。
        // V10: 可选 continuesFrom = 战线续接——父命令必须存在，续接模式按
        // 其当时状态冻结（嫁接是历史不是开关）；推导失败给明确拒绝理由。
        const body = await readJsonBody(r) as { text?: unknown; cron?: unknown; continuesFrom?: unknown; name?: unknown }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        // V15 战线命名（可选，≤24 字；舰长下达时给，不填=命令原文当战线名）。
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 24) : ''
        if (text === '') {
          send(400, { ok: false, error: '命令内容为空：请用一句大白话写下舰长的意图。' })
          return
        }
        if (text.length > 2000) {
          send(400, { ok: false, error: '命令太长（>2000 字）：请拆成多道命令分别下达。' })
          return
        }
        let cron: string | undefined
        if (body.cron !== undefined && body.cron !== null && body.cron !== '') {
          if (typeof body.cron !== 'string') {
            send(400, { ok: false, error: 'cron 必须是字符串（5 段：分 时 日 月 周，如 "0 9 * * *"）。' })
            return
          }
          try {
            // C9（插件仓回流）：可满足性升级——'0 9 30 2 *'（2 月 30 日）类
            // 可解析但永不到点的表达式同样拒收：合法入库后每次板请求/每轮 tick
            // 都要烧满 5 年游走 CPU，且任务令永不触发、无任何报错。段落校验
            //（4 段→400）不变——assertCronUsable 内部先 parseCron，同抛
            // CronParseError。
            assertCronUsable(body.cron, Date.now())
          } catch (err) {
            send(400, { ok: false, error: err instanceof Error ? err.message : 'cron 表达式不合法。' })
            return
          }
          cron = body.cron.trim()
        }
        let continuesFrom: string | undefined
        let continuationMode: ContinuationMode | undefined
        let pivotTargetSessionId: string | undefined
        if (body.continuesFrom !== undefined && body.continuesFrom !== null && body.continuesFrom !== '') {
          if (typeof body.continuesFrom !== 'string') {
            send(400, { ok: false, error: 'continuesFrom 必须是父命令号字符串。' })
            return
          }
          const parentId = body.continuesFrom.trim()
          const parent = loadDirectives(deps.stateDir).find(d => d.id === parentId)
          if (parent === undefined) {
            send(400, { ok: false, error: `要续接的命令 ${parentId} 不存在。` })
            return
          }
          let taskFace: ContinuationTaskFace | undefined
          if (parent.taskId !== undefined) {
            try {
              const camp = loadCampaign(deps.stateDir, parent.taskId)
              if (camp.startedAt !== '') {
                const recent = [...camp.attemptLog].reverse()
                taskFace = {
                  status: camp.status,
                  lastOutcome: recent.find(a => a.outcome !== undefined)?.outcome,
                  liveAttemptSessionId: recent.find(a => a.endedAt === undefined)?.sessionId,
                }
              }
            } catch { /* 无此任务账本 → taskFace 留空走统一拒绝口径 */ }
          }
          const derived = deriveContinuation(parent, taskFace)
          if ('error' in derived) {
            send(400, { ok: false, error: derived.error })
            return
          }
          continuesFrom = parentId
          continuationMode = derived.mode
          pivotTargetSessionId = derived.targetSessionId
        }
        const commandId = newDirectiveId()
        // D27 下令来源（审计，可选 body 字段——外部调用者自报，如 MCP 客户端
        // 的 agentId；缺省='human' 语义=舰长亲手 composer/聚焦面）。
        const issuedBy = typeof (body as { issuedBy?: unknown }).issuedBy === 'string' ? (body as { issuedBy: string }).issuedBy.trim().slice(0, 64) : ''
        appendDirectiveEvent(deps.stateDir, {
          type: 'directive_created', ts: new Date().toISOString(), directiveId: commandId, text,
          ...(cron !== undefined ? { cron } : {}),
          ...(continuesFrom !== undefined ? { continuesFrom } : {}),
          ...(continuationMode !== undefined ? { continuationMode } : {}),
          ...(name !== '' ? { name } : {}),
          ...(issuedBy !== '' ? { issuedBy } : {}),
        })
        // 定时命令不立即引信——到点 dispatched 后 15s 引信自会接手。
        if (cron === undefined) deps.onCommandCreated?.()
        send(200, {
          ok: true, commandId,
          ...(cron !== undefined ? { scheduled: true } : {}),
          ...(continuationMode !== undefined ? { continuationMode, ...(pivotTargetSessionId !== undefined ? { pivotTargetSessionId } : {}) } : {}),
        })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/threads') {
        // v3 挂载: pin an externally-created session onto the battlefield as
        // an「外部」card. Registry only — never writes into the session.
        const body = await readJsonBody(r) as { sessionId?: unknown; note?: unknown }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        const note = typeof body.note === 'string' ? body.note.trim() : ''
        if (sessionId === '' || sessionId.length > 200) {
          send(400, { ok: false, error: '会话号不能为空（且不超过 200 字符）：请贴入要挂载的 thread 会话号。' })
          return
        }
        if (note.length > 500) {
          send(400, { ok: false, error: '备注太长（>500 字）：一句话说明这个 thread 在干什么即可。' })
          return
        }
        appendThreadEvent(deps.stateDir, { type: 'thread_attached', ts: new Date().toISOString(), sessionId, note })
        send(200, { ok: true, sessionId })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/threads/detach') {
        const body = await readJsonBody(r) as { sessionId?: unknown }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (sessionId === '') {
          send(400, { ok: false, error: '缺少会话号。' })
          return
        }
        appendThreadEvent(deps.stateDir, { type: 'thread_detached', ts: new Date().toISOString(), sessionId })
        send(200, { ok: true, sessionId })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/commands/talking') {
        // Fired by the client when the user opens the staff conversation
        // from a received command card — the card flips to 对话中.
        const body = await readJsonBody(r) as { commandId?: unknown }
        const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
        const directive = loadDirectives(deps.stateDir).find(d => d.id === commandId)
        if (directive === undefined) {
          send(404, { ok: false, error: `命令 ${commandId} 不存在。` })
          return
        }
        if (directive.status === 'received') {
          appendDirectiveEvent(deps.stateDir, { type: 'directive_talking', ts: new Date().toISOString(), directiveId: directive.id })
        }
        send(200, { ok: true, status: directive.status })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/shutdown') {
        // P1-5 优雅停服（CLI stop）：只该从本机来——daemon 本就只听 127.0.0.1。
        if (deps.shutdown === undefined) {
          send(501, { ok: false, error: '停服通道未接线（deps.shutdown 缺席）。' })
          return
        }
        send(200, { ok: true, note: 'stardeck 正在优雅关停（在役执行者先行收割）。' })
        deps.shutdown()
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/commands/answer') {
        // P0-1 板内答复（2026-09-02）：talking 命令的舰长答复经 pi RPC 续跑送进
        // 大副会话。通道实现由 daemon 注入（deps.answerCommand）；缺席=未接线 501。
        const body = await readJsonBody(r) as { commandId?: unknown; text?: unknown; channel?: unknown }
        const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
        // D26：答复来源面入账（'board'|'bridge'，其余值按 board——审计字面受控）。
        const channel = body.channel === 'bridge' ? 'bridge' : 'board'
        if (commandId === '' || text === '') {
          send(400, { ok: false, error: 'commandId 与 text 必填（text ≤2000 字）。' })
          return
        }
        if (deps.answerCommand === undefined) {
          send(501, { ok: false, error: '答复通道未接线（deps.answerCommand 缺席）。' })
          return
        }
        const out = await deps.answerCommand(commandId, text, channel)
        send(out.ok ? 200 : out.error.includes('不存在') ? 404 : 409, out)
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/bridge/messages') {
        // D26 舰桥频道消息流（只读投影；旗 OFF 面 404=与改前等价）。?since= 增量。
        if (deps.bridgeEnabled !== true) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${pathname}` })
          return
        }
        const q = new URL(r.url ?? '/', 'http://local').searchParams
        const since = q.get('since') ?? ''
        let messages = loadBridgeMessages(deps.stateDir)
        if (since !== '') messages = messages.filter(m => m.ts > since)
        send(200, { ok: true, messages: messages.slice(-200), revision: boardRevision(deps.stateDir, deps.activity?.salt()) })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/bridge/messages') {
        // D26 舰长发话入账（写通道本体：账本追加即受理——大副 15s tick 出 chat
        // 工单回话；「实时感」由机械战报+板面刷新承载）。旗 OFF 面 404。
        if (deps.bridgeEnabled !== true) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${pathname}` })
          return
        }
        const body = await readJsonBody(r) as { text?: unknown }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text === '') {
          send(400, { ok: false, error: '消息内容为空：跟经理人说什么，写一句就行。' })
          return
        }
        if (text.length > 8000) {
          send(400, { ok: false, error: '消息太长（>8000 字）：请拆成几条说。' })
          return
        }
        const ts = new Date().toISOString()
        appendBridgeEvent(deps.stateDir, { type: 'bridge_user_message', ts, text })
        // D36-A 发话即应答：入账成功立即 kick 代理舰长一轮（不等 15s 哨位）。
        deps.bridgeKick?.()
        send(200, { ok: true, ts })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/bridge/digest') {
        // D26 舰队全况 digest（经理人的战况底料 + 聊天决策坞的数据面；紧凑封顶）。
        if (deps.bridgeEnabled !== true) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${pathname}` })
          return
        }
        send(200, { ok: true, digest: bridgeDigest(deps.stateDir) })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/ledger') {
        // D28 知识面·只读账本尾查（代理舰长百事通的查证通道，也可被板/外部调用）。
        // scope=directive|task|both（缺省 both）；limit 缺省 50、封顶 200（钳制不报错）。
        const q = new URL(r.url ?? '/', 'http://local').searchParams
        const scopeRaw = q.get('scope') ?? 'both'
        if (scopeRaw !== 'directive' && scopeRaw !== 'task' && scopeRaw !== 'both') {
          send(400, { ok: false, error: 'scope 只认 directive / task / both。' })
          return
        }
        const limitRaw = Number(q.get('limit') ?? '50')
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50
        const entries = scopeRaw === 'directive' ? ledgerDirectiveEntries(deps.stateDir) : scopeRaw === 'task' ? ledgerTaskEntries(deps.stateDir) : [...ledgerDirectiveEntries(deps.stateDir), ...ledgerTaskEntries(deps.stateDir)]
        send(200, { ok: true, scope: scopeRaw, limit, entries: entries.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit) })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/bridge/settings') {
        // D27 定夺授权开关（舰长显式动作）：运行态翻转代理舰长代定夺授权，
        // 不落盘——重启回落默认 OFF（安全缺省）。bridgeProxy 缺席=501。
        if (deps.bridgeEnabled !== true) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'POST'} ${pathname}` })
          return
        }
        if (deps.bridgeProxy === undefined) {
          send(501, { ok: false, error: '该面未接线（daemon 形态才有）——代理舰长授权开关不可用。' })
          return
        }
        const body = await readJsonBody(r) as { proxyVerdict?: unknown }
        if (typeof body.proxyVerdict !== 'boolean') {
          send(400, { ok: false, error: 'proxyVerdict 必须是布尔（true=授权代理舰长代定夺 / false=收回）。' })
          return
        }
        deps.bridgeProxy.setProxyVerdict(body.proxyVerdict)
        send(200, { ok: true, verdictAuthorized: deps.bridgeProxy.proxyVerdict(), note: body.proxyVerdict ? '已授权：代理舰长可代行验收定夺（须呈证据与理由；重启后回落未授权）。' : '已收回：一切定夺重新呈舰长亲手。' })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/commands/regrade') {
        // V5-R2 档位账本（flag staff-triage）：舰长在命令卡上升降档。
        // 旗关 → 404，与改前等价。
        if (deps.flags === undefined || !featureEnabled(deps.flags, 'staff-triage')) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${pathname}` })
          return
        }
        const body = await readJsonBody(r) as { commandId?: unknown; grade?: unknown; reason?: unknown }
        const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
        const grade = typeof body.grade === 'string' ? body.grade.trim() : ''
        const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : '舰长命令卡升降档'
        if (commandId === '') {
          send(400, { ok: false, error: '缺少命令号。' })
          return
        }
        if (grade !== 'L0' && grade !== 'L1' && grade !== 'L2') {
          send(400, { ok: false, error: '档位必须是 L0 / L1 / L2。' })
          return
        }
        const directive = loadDirectives(deps.stateDir).find(d => d.id === commandId)
        if (directive === undefined) {
          send(404, { ok: false, error: `命令 ${commandId} 不存在。` })
          return
        }
        if (directive.status === 'approved' || directive.status === 'cancelled') {
          send(400, { ok: false, error: `命令 ${commandId} 已${directive.status === 'approved' ? '批准出任务' : '取消'}，档位不再变更。` })
          return
        }
        if (directive.grade === undefined) {
          send(400, { ok: false, error: `命令 ${commandId} 尚未分诊——等大副完成第一轮分诊后再升降档。` })
          return
        }
        appendDirectiveEvent(deps.stateDir, { type: 'directive_regraded', ts: new Date().toISOString(), directiveId: commandId, grade, reason })
        send(200, { ok: true, commandId, grade })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/commands/plan') {
        // V5-R3 计划判定（flag staff-plan）：舰长在命令卡上批准/驳回计划草案。
        if (deps.flags === undefined || !featureEnabled(deps.flags, 'staff-plan')) {
          send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${pathname}` })
          return
        }
        const body = await readJsonBody(r) as { commandId?: unknown; decision?: unknown; note?: unknown; brief?: unknown }
        const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
        const decision = typeof body.decision === 'string' ? body.decision.trim() : ''
        const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : undefined
        // D24 签发修改权：approve 可携舰长逐项修改后的任务书五项——签发文本
        // 是发布的唯一依据；未携带=照原稿签发。字段缺/非字符串即 400（不静默）。
        const briefEdited = body.brief !== undefined ? body.brief as Record<string, unknown> : undefined
        const signedBrief = briefEdited === undefined ? undefined : (() => {
          const fields = ['goal', 'background', 'acceptance', 'nonGoals', 'deliverables'] as const
          const out: Record<string, string> = {}
          for (const f of fields) {
            const v = briefEdited[f]
            if (typeof v !== 'string' || v.trim() === '') return undefined
            out[f] = v.trim()
          }
          return out as { goal: string; background: string; acceptance: string; nonGoals: string; deliverables: string }
        })()
        if (briefEdited !== undefined && signedBrief === undefined) {
          send(400, { ok: false, error: '签发修改文本不完整：五项（goal/background/acceptance/nonGoals/deliverables）都要求非空字符串。' })
          return
        }
        if (commandId === '') {
          send(400, { ok: false, error: '缺少命令号。' })
          return
        }
        if (decision !== 'approve' && decision !== 'reject') {
          send(400, { ok: false, error: '判定只接受 approve（批准）或 reject（驳回）。' })
          return
        }
        const directive = loadDirectives(deps.stateDir).find(d => d.id === commandId)
        if (directive === undefined) {
          send(404, { ok: false, error: `命令 ${commandId} 不存在。` })
          return
        }
        if (directive.plan === undefined || directive.plan.status !== 'pending') {
          send(400, { ok: false, error: `命令 ${commandId} 无待批计划（当前：${directive.plan === undefined ? '未呈报' : directive.plan.status}）。` })
          return
        }
        if (decision === 'approve') {
          appendDirectiveEvent(deps.stateDir, { type: 'directive_plan_approved', ts: new Date().toISOString(), directiveId: commandId, ...(note !== undefined ? { note } : {}) })
          // D24 签发：批准即签发，定稿文本入账——舰长修改权绝对化：携修改文本
          // 时无论原稿（brief）在不在都落 brief_signed（发布工单逐字照抄）；
          // 未携修改且原稿在（新流程）→ 照原稿签发；旧 plan 流程无修改 → 不落
          // 签发事件（维持旧发布语义）。原稿 brief 永不覆盖（谈/签两笔审计链）。
          if (signedBrief !== undefined) {
            appendDirectiveEvent(deps.stateDir, { type: 'directive_brief_signed', ts: new Date().toISOString(), directiveId: commandId, ...signedBrief, ...(note !== undefined ? { note } : {}) })
          } else if (directive.brief !== undefined) {
            appendDirectiveEvent(deps.stateDir, { type: 'directive_brief_signed', ts: new Date().toISOString(), directiveId: commandId, goal: directive.brief.goal, background: directive.brief.background, acceptance: directive.brief.acceptance, nonGoals: directive.brief.nonGoals, deliverables: directive.brief.deliverables, ...(note !== undefined ? { note } : {}) })
          }
        } else {
          appendDirectiveEvent(deps.stateDir, { type: 'directive_plan_rejected', ts: new Date().toISOString(), directiveId: commandId, reason: note ?? '舰长驳回，请修订重呈' })
        }
        // K17 判定回推：大副会话在等判定结果——投递 best-effort，失败不阻塞入账
        // （下一次呈报/唤醒还会碰头）。仅在大副会话存在时投。
        if (directive.staffSessionId !== undefined && directive.staffSessionId !== '' && deps.pushToStaff !== undefined) {
          deps.pushToStaff(directive.staffSessionId, decision === 'approve' ? planApprovedNotice(note) : planRejectedNotice(note ?? '请修订重呈'))
        }
        send(200, { ok: true, commandId, decision })
        return
      }
      if (r.method === 'POST' && pathname === '/warroom/api/archive') {
        // V17 归档：链全终局的命令批量 archiveSession 全部相关会话并落
        // directive_archived。三道闸：存在 → 未入档 → 链全终局；扇出逐会话
        // 记账，部分失败如实返回（不假装全成）。
        if (deps.archiveSession === undefined) {
          send(501, { ok: false, error: '宿主归档通道未接入（archiveSession 面缺席）。' })
          return
        }
        const body = await readJsonBody(r) as { commandId?: unknown }
        const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
        if (commandId === '') {
          send(400, { ok: false, error: '缺少命令号。' })
          return
        }
        const directives = loadDirectives(deps.stateDir)
        const directive = directives.find(d => d.id === commandId)
        if (directive === undefined) {
          send(404, { ok: false, error: `命令 ${commandId} 不存在。` })
          return
        }
        // 链全终局闸：链上每条命令要么 cancelled，要么其任务已 closed/failed。
        const chains = foldChains(directives)
        const rootId = chains.rootByCommand.get(commandId) ?? commandId
        const members = chains.membersOfRoot.get(rootId) ?? [commandId]
        const campaigns = new Map(listCampaignIds(deps.stateDir).map(id => [id, loadCampaign(deps.stateDir, id)]))
        const memberTerminal = (m: { status: string; taskId?: string }): boolean => {
          if (m.status === 'cancelled') return true
          if (m.taskId === undefined) return false
          const st = campaigns.get(m.taskId)?.status
          return st === 'closed' || st === 'failed'
        }
        const membersView = members.map(id => directives.find(d => d.id === id)).filter(d => d !== undefined)
        const notTerminal = membersView.filter(m => !memberTerminal(m))
        if (notTerminal.length > 0) {
          send(400, { ok: false, error: `战线未全终局，不可归档（卡在：${notTerminal.map(m => m.id).join('、')}）。` })
          return
        }
        // 会话清单：每条成员的大副会话 + 任务全部尝试会话（外部挂载 thread 不动）。
        const sessions: string[] = []
        for (const m of membersView) {
          if (m.staffSessionId !== undefined) sessions.push(m.staffSessionId)
          if (m.taskId !== undefined) {
            for (const a of campaigns.get(m.taskId)?.attemptLog ?? []) {
              if (a.sessionId !== '') sessions.push(a.sessionId)
            }
          }
        }
        const unique = [...new Set(sessions)]
        // C5（插件仓回流）归档部分失败幂等续档：重入闸只在「已入档会话覆盖全部
        // 相关会话」时拒；未覆盖（部分失败留下的缺口、超时≠宿主失败的账实分离）
        // 时仅对缺失会话补归档，落账 sessions 合并为 [...既往, ...新成功]
        //（fold 的 directive_archived 是后写覆盖语义，天然支持续档）。
        const prior = directive.archived?.sessions ?? []
        if (directive.archived !== undefined && unique.every(s => prior.includes(s))) {
          send(400, { ok: false, error: `命令 ${commandId} 已归档。` })
          return
        }
        const toArchive = unique.filter(s => !prior.includes(s))
        const failed: Array<{ sessionId: string; code: string; message: string }> = []
        const done: string[] = []
        // V17：扇出并行（会话互不依赖；宿主 registry 内部自会串行落盘）——
        // 单 RPC 有 15s 超时界（index 侧），整链最坏 ≈ 一个超时窗而非逐会话累加。
        const results = await Promise.all(toArchive.map(async sessionId => ({ sessionId, r: await deps.archiveSession(sessionId) })))
        for (const { sessionId, r } of results) {
          if (r.ok) done.push(sessionId)
          else failed.push({ sessionId, code: r.code, message: r.message })
        }
        if (toArchive.length > 0 && done.length === 0) {
          send(502, { ok: false, error: '宿主归档全部失败。', failed })
          return
        }
        appendDirectiveEvent(deps.stateDir, { type: 'directive_archived', ts: new Date().toISOString(), directiveId: commandId, sessions: [...new Set([...prior, ...done])] })
        // B1-件⑥ 收官清理：链归档后对成员任务的 auto+repo worktree best-effort
        // 释放（bound/instance/普通目录由 releaseTaskWorkspace 自行判否留置；
        // 成败都落 workspace_released 事件，随响应如实返回）。
        const released: Array<{ taskId: string; path: string; ok: boolean; note: string }> = []
        if (deps.releaseWorkspace !== undefined) {
          for (const m of membersView) {
            if (m.taskId === undefined) continue
            const wsPath = campaigns.get(m.taskId)?.workspacePath
            if (wsPath === undefined) continue
            const r = deps.releaseWorkspace(wsPath)
            appendEvent(deps.stateDir, { type: 'workspace_released', ts: new Date().toISOString(), campaignId: m.taskId, path: wsPath, ok: r.ok, note: r.note })
            released.push({ taskId: m.taskId, path: wsPath, ok: r.ok, note: r.note })
          }
        }
        send(200, { ok: true, commandId, archived: done.length, failed, ...(released.length > 0 ? { released } : {}) })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/host-sessions') {
        // V17 归档核查（只读）：宿主当前会话 id 清单——归档后这些 id 应消失。
        let ids: string[] | null = null
        if (deps.listSessions !== undefined) ids = await deps.listSessions()
        else if (deps.localSessions !== undefined) ids = deps.localSessions()
        if (ids === null) {
          send(501, { ok: false, error: '会话清单未接入（宿主 listSessions 与独立派生 localSessions 均缺席）。' })
          return
        }
        send(200, { ok: true, sessions: ids })
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/trace') {
        // B1-件② 命令追踪（只读调试面）：单命令全事件时间线 + 引信/征召视角。
        const query = new URL(r.url ?? '/', 'http://local').searchParams
        const result = traceProjection(deps.stateDir, (query.get('commandId') ?? '').trim(), deps.conscription?.())
        if (!result.ok) {
          send(result.code, { ok: false, error: result.error })
          return
        }
        send(200, result)
        return
      }
      if (r.method === 'GET' && pathname === '/warroom/api/events') {
        const sse = w as ResFace
        if (typeof sse.write !== 'function') {
          send(501, { ok: false, error: '此连接不支持事件流（SSE）' })
          return
        }
        // C7（插件仓回流）：close 监听**进分支先挂**再做 boardRevision/首发写
        //——旧序有毫秒级窗口，客户端秒断则 1s interval 永久泄漏。
        let watch: ReturnType<typeof setInterval> | undefined
        sse.on?.('close', () => { if (watch !== undefined) clearInterval(watch) })
        sse.setHeader?.('content-type', 'text/event-stream; charset=utf-8')
        sse.setHeader?.('cache-control', 'no-cache')
        sse.setHeader?.('connection', 'keep-alive')
        sse.setHeader?.('x-accel-buffering', 'no')
        let last = boardRevision(deps.stateDir, deps.activity?.salt())
        let lastLiveSeq = -1 // D32 流式：live.seq 水位
        sse.write('retry: 3000\n\n')
        sse.write(`data: ${JSON.stringify({ rev: last })}\n\n`)
        watch = setInterval(() => {
          // C7：回调自查连接死活——close 事件面缺席（半途销毁）也能自清。
          const raw = w as { destroyed?: boolean; writableEnded?: boolean }
          if (raw.destroyed === true || raw.writableEnded === true) {
            if (watch !== undefined) clearInterval(watch)
            return
          }
          try {
            const rev = boardRevision(deps.stateDir, deps.activity?.salt())
            // D32 流式上屏：live.seq 变化即推 {live} 打字机帧（rev 不动也推）；
            // 帧可同时携 rev+live——读投影纪律不破，live 只是会话态不进账本。
            const live = deps.proxyLive?.()
            const liveSeq = live?.seq ?? -1
            if (rev !== last || liveSeq !== lastLiveSeq) {
              const frame: { rev: string; live?: string; liveReasoning?: string; liveTools?: Array<{ label: string; done: boolean; detail?: string }> } = { rev }
              if (liveSeq !== lastLiveSeq && live !== null) {
                lastLiveSeq = liveSeq
                frame.live = live.text // B6：空串也带——客户端据此清打字机（字段缺席=陈旧残留）
                frame.liveReasoning = live.reasoning // D36 思考流（空串也带，同 B6 律）
                if (live.tools.length > 0) frame.liveTools = live.tools // D33 段2：工具步骤 chip（D36 带 detail 摘要）
              }
              last = rev
              sse.write(`data: ${JSON.stringify(frame)}\n\n`)
            } else {
              sse.write(': ping\n\n')
            }
          } catch {
            // Never let a stat hiccup kill the stream.
          }
        }, 1000)
        return
      }
      if (deps.spike !== undefined && pathname === '/warroom/api/v5-spike') {
        // v5 R1 机制验证探针（flag v5-spike）：GET = 宿主面可用性快照；
        // POST {sessionId} = 全链探针；POST {action:'planCard', sessionId}
        // = 切 plan mode + 投呈报提示（评审卡截图用）。旗关则整个路由不存在。
        if (r.method === 'GET') {
          send(200, { ok: true, availability: deps.spike.availability() })
          return
        }
        if (r.method === 'POST') {
          const body = await readJsonBody(r) as { sessionId?: unknown; action?: unknown; text?: unknown }
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
          if (sessionId === '' || sessionId.length > 200) {
            send(400, { ok: false, error: '缺少 sessionId（贴一个活体会话号，≤200 字符）。' })
            return
          }
          if (body.action === 'planCard') {
            send(200, await armPlanCard(deps.spike, sessionId, typeof body.text === 'string' && body.text.trim() !== '' ? body.text.trim() : undefined))
            return
          }
          send(200, await runSpikeProbe(deps.spike, sessionId))
          return
        }
      }
      send(404, { ok: false, error: `路由不存在：${r.method ?? 'GET'} ${clipForError(pathname)}` }) // C4（插件仓回流）：入参反射截断
    } catch (err) {
      // C2/C3（插件仓回流）：请求体类可识别错误按自带状态码出线（413 超限 /
      // 400 坏 JSON）。
      if (err instanceof HttpBodyError) {
        send(err.status, { ok: false, error: err.message })
        return
      }
      send(500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return webServer.register({ kind: 'prefix', path: '/warroom', handler })
}
