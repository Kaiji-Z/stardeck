/**
 * Watchdog 哨兵判据（D39-B，纯函数零时钟零文件系统）：巡检对「活着但卡住」
 * 的执行者判定——superagent Watchdog 的机械对应物（不用模型判进展，用活性
 * 信号：日志 mtime 是执行者 CLI 流式输出的代理——流式期间日志恒热）。
 *
 * 判据（双窗与）：ageMs>ageMin（claim 起算的总龄期）&& silenceMs>silenceMin
 * （日志静默窗）。已旗不重复记旗（fold 清旗由活性/结算事件驱动——见 events.ts）。
 * enforce 档由 daemon 侧旗决定（kill 后走既有失联回收路径，本模块只出判据）。
 * @module stardeck/watchdog
 */

import type { CampaignState } from './types.ts'

export interface WatchdogConfig {
  /** 记旗总闸（STARDECK_WATCHDOG，默认 true——纯观察零破坏）。 */
  enabled: boolean
  /** enforce 升级档（STARDECK_WATCHDOG_ENFORCE，默认 false——kill+记败重派）。 */
  enforce: boolean
  /** 日志静默窗（分钟，默认 20）。 */
  silenceMin: number
  /** attempt 龄期窗（分钟，默认 45——claim 起算）。 */
  ageMin: number
}

/** 巡检侧的活会话快照（daemon 从 registry + 文件系统取，本模块不做 IO）。 */
export interface WatchdogSessionFace {
  readonly taskId: string
  readonly agentId: string
  /** 会话日志 mtime（epoch ms；缺省=0——日志不可读按最深静默处理，宁可记旗）。 */
  readonly logMtimeMs: number
  /** 会话起跑时刻（epoch ms）。 */
  readonly startedAtMs: number
}

export interface WatchdogFlag {
  readonly taskId: string
  readonly agentId: string
  readonly reason: string
  readonly silenceMs: number
  readonly ageMs: number
}

/** 纯判定：in_progress 任务 × 活会话 × 双超窗 × 未记旗 → 记旗清单。
 *  调用方（patrolTick）负责落 task_watchdog_flagged 事件与 enforce kill。 */
export function watchdogVerdict(
  tasks: ReadonlyArray<Pick<CampaignState, 'campaignId' | 'status' | 'watchdog' | 'attemptLog' | 'startedAt'>>,
  sessions: ReadonlyArray<WatchdogSessionFace>,
  nowMs: number,
  cfg: WatchdogConfig,
): WatchdogFlag[] {
  if (!cfg.enabled) return []
  const silenceMs = cfg.silenceMin * 60_000
  const ageMs = cfg.ageMin * 60_000
  const out: WatchdogFlag[] = []
  for (const session of sessions) {
    const task = tasks.find(t => t.campaignId === session.taskId)
    if (task === undefined || task.status !== 'in_progress') continue
    if (task.watchdog !== undefined) continue // 已旗不重复（清旗靠活性/结算事件）
    // 龄期锚：当前 attempt 的领取时刻（更精准）；无 attempt 记录回退任务创建时刻。
    const attemptStart = task.attemptLog.length > 0 ? task.attemptLog[task.attemptLog.length - 1]!.startedAt : task.startedAt
    const anchorMs = Date.parse(attemptStart)
    const age = Number.isFinite(anchorMs) ? nowMs - anchorMs : nowMs - session.startedAtMs
    const silence = nowMs - session.logMtimeMs
    if (age <= ageMs || silence <= silenceMs) continue
    out.push({
      taskId: session.taskId,
      agentId: session.agentId,
      reason: `执行者疑似卡住：龄期 ${Math.round(age / 60_000)} 分钟、日志静默 ${Math.round(silence / 60_000)} 分钟（Watchdog 双超窗）`,
      silenceMs: silence,
      ageMs: age,
    })
  }
  return out
}
