/**
 * attach-map backfill（P1-6，2026-09-02 脱离宿主九件）：会话捕获功能之前的
 * 老会话在弹窗里只剩诚实 404——用**自家日志**反查补齐：
 * - 键源：directives 的 staffSessionId（staff-<id>）+ campaigns 的 taskId；
 * - 反查料：stateDir/logs/ 下的执行者/大副日志（spawnLogged 全量落盘）——
 *   首个会话号行钩（opencode `"sessionID":"ses_…"` / zcode `"sessionId":"sess_…"`
 *   / claude `"session_id":"<uuid>"`）即该轮的原生会话；
 * - 纪律：只补缺失键，绝不覆盖既有映射；无日志/无会话号的键如实跳过。
 * @module stardeck/backfill
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadDirectives } from './directives.ts'
import { listCampaignIds, loadCampaign } from './events.ts'
import { readAttachMap, writeAttachMapEntry, type AttachEntry } from './executor.ts'

/** 日志文本里的首个原生会话号（三席模式判型：ses_=opencode / sess_=zcode / 裸 uuid=claude）。 */
export function sessionIdFromLog(text: string): { sessionId: string; executor: string } | null {
  const oc = text.match(/"sessionID":"(ses_[A-Za-z0-9]+)"/)
  if (oc !== null) return { sessionId: oc[1]!, executor: 'opencode' }
  const zc = text.match(/"sessionId":"(sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/)
  if (zc !== null) return { sessionId: zc[1]!, executor: 'zcode' }
  const cl = text.match(/"session_id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/)
  if (cl !== null) return { sessionId: cl[1]!, executor: 'claude' }
  return null
}

export interface BackfillPlanItem extends AttachEntry {
  key: string
  sourceLog: string
}

/** 反查计划（纯读）：缺失键 × 日志证据 → 待补条目。不写盘。 */
export function backfillPlan(stateDir: string): BackfillPlanItem[] {
  const logDir = join(stateDir, 'logs')
  const existing = readAttachMap(stateDir)
  const out: BackfillPlanItem[] = []
  const candidates: Array<{ key: string; workspacePath: string; logPrefix: string }> = []
  // ① staff 键：directives 的 staffSessionId（工作区=stateDir/staff——贴身大副的常驻工位）。
  for (const d of loadDirectives(stateDir)) {
    if (d.staffSessionId !== undefined && d.staffSessionId !== null) {
      candidates.push({ key: d.staffSessionId, workspacePath: join(stateDir, 'staff'), logPrefix: `staff-${d.staffSessionId}.log` })
    }
  }
  // ② 任务键：campaign 的 taskId（工作区=任务自己的工作区）。
  for (const id of listCampaignIds(stateDir)) {
    const c = loadCampaign(stateDir, id)
    if (c.startedAt !== '' && c.workspacePath !== undefined && c.workspacePath !== '') {
      candidates.push({ key: id, workspacePath: c.workspacePath, logPrefix: `executor-` })
    }
  }
  if (!existsSync(logDir)) return out
  const logs = readdirSync(logDir)
  const seen = new Set<string>()
  for (const cand of candidates) {
    if (existing[cand.key] !== undefined || seen.has(cand.key)) continue
    seen.add(cand.key)
    // 任务键的日志名是 executor-oc-<taskId>-<ts36>.log（agentId 前缀 oc-<taskId>-）。
    const hits = cand.logPrefix.endsWith('.log')
      ? (logs.includes(cand.logPrefix) ? [cand.logPrefix] : [])
      : logs.filter(n => n.startsWith(cand.logPrefix) && n.includes(`-${cand.key}-`))
    for (const name of hits) {
      const path = join(logDir, name)
      try {
        const found = sessionIdFromLog(readFileSync(path, 'utf8'))
        if (found === null) continue
        const capturedAt = new Date(statSync(path).mtimeMs).toISOString()
        out.push({ key: cand.key, executor: found.executor, sessionId: found.sessionId, workspacePath: cand.workspacePath, capturedAt, sourceLog: name })
        break // 一轮一映射：首中即锁（与捕获时的首中语义一致）。
      } catch { /* 日志读不了——跳过这个候选 */ }
    }
  }
  return out
}

/** 执行补齐（daemon 启动时调用）：只补缺失、不覆盖；返回补了几键。 */
export function backfillAttachMap(stateDir: string): { added: number; items: BackfillPlanItem[] } {
  const plan = backfillPlan(stateDir)
  for (const item of plan) {
    writeAttachMapEntry(stateDir, item.key, { executor: item.executor, sessionId: item.sessionId, workspacePath: item.workspacePath, capturedAt: item.capturedAt })
  }
  return { added: plan.length, items: plan }
}
