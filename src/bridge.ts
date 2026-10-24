/**
 * 舰桥频道账本（D26，v0.3.0 对话范式）：舰长与经理人（大副正典）的持久对话。
 * 一条 append-only JSONL（`<stateDir>/bridge.jsonl`），fold 出时序消息流——与
 * campaigns/directives/threads 同纪律（只追加、派生态）。频道是舰队全局的：不
 * 分工作区、不分命令，经理人唯一。
 *
 * 三种话轮（D26 定案）：
 * - user_message：舰长发话（聊天窗 POST）；
 * - agent_message：大副回合最终答复**全文**入账（收割双写——【任务书】【澄清】
 *   结构化块照旧解析入 directives，对话与命令两账并行）；agentId/sessionId
 *   记逻辑常驻会话（pi/opencode 席下轮可 resume 续跑）；
 * - system_notice：机械战报（五触发，不跑模型）——dedupKey 以源事件指纹为键，
 *   幂等重放不重复入账。
 *
 * 红线（SPEC .goal/D26 §2）：聊天窗同板是读投影，写只经命令通道；本账本只存
 * 对话事实，不承载任务语义。
 * @module stardeck/bridge
 */

import { join } from 'node:path'
import { appendJsonl, appendJsonlBatch } from './jsonl.ts'
import { readJsonlCached } from './fold-cache.ts'
import { loadDirectives, readDirectiveEvents } from './directives.ts'
import { listCampaignIds, loadCampaign } from './events.ts'

/** 机械战报六种（D26 五触发 + D28 scene：图景渲染未过对账的诚实告知）。 */
export type BridgeNoticeKind = 'reported' | 'clarify' | 'retry' | 'terminal' | 'scheduled' | 'scene'

/** 图景附件（D28 图景面）：代理舰长【图景】块经确定性渲染器产出的 HTML 图页
 * 引用——id 即 GET /warroom/api/artifact/<id> 的路径段；正文 text 仍是给舰长的
 * 话，图页是附页（沙箱 iframe，零脚本）。 */
export interface BridgeArtifact { id: string; title: string }

/** D37 回合计量（随 agent 终答条件 spread 入账——旧消息零迁移）。会话态流式
 *  不入账；这条 meta 是回合事实审计：哪台模型/哪档思考强度/耗时/真实 token。 */
export interface BridgeMessageMeta {
  readonly model: string
  /** ''=自动 | 'fast'=快速 | 'deep'=深度。 */
  readonly effort: string
  readonly elapsedMs: number
  readonly promptTokens?: number
  readonly completionTokens?: number
}

/** The bridge log's entry union (one JSON line each). */
export type BridgeEvent =
  | { type: 'bridge_user_message'; ts: string; text: string }
  | { type: 'bridge_agent_message'; ts: string; text: string; /** 本轮答复涉及的命令号（点穿用）。 */ commandRefs?: string[]; /** 大副 agentId（staff-<ts36>，逻辑常驻键）。 */ agentId?: string; /** 原生会话号（attach-map 捕获；resume 续跑依据）。 */ sessionId?: string; /** 图景附件（D28：渲染器落盘成功时随话轮入账）。 */ artifact?: BridgeArtifact; /** D37 回合计量（内置 loop 终答随账——条件 spread）。 */ meta?: BridgeMessageMeta }
  | { type: 'bridge_system_notice'; ts: string; noticeKind: BridgeNoticeKind; /** 源事件指纹（幂等键：同键不再入账）。 */ dedupKey: string; text: string; /** 点穿引用（commandId/taskId → 板聚焦页/trace）。 */ refs?: Record<string, string> }

/** Fold 后的一条频道消息（渲染面形状）。 */
export interface BridgeMessage {
  readonly kind: 'user' | 'agent' | 'system'
  readonly ts: string
  readonly text: string
  readonly commandRefs?: readonly string[]
  readonly agentId?: string
  readonly sessionId?: string
  readonly noticeKind?: BridgeNoticeKind
  /** 机械战报的幂等键（fold 透传——syncBridgeNotices 去重读消息流即可）。 */
  readonly dedupKey?: string
  readonly refs?: Readonly<Record<string, string>>
  /** 图景附件（D28：agent 话轮可带——聊天窗渲染沙箱 iframe）。 */
  readonly artifact?: BridgeArtifact
  /** D37 回合计量（模型/思考强度/耗时/tokens——消息 meta 行数据源）。 */
  readonly meta?: BridgeMessageMeta
}

function bridgeFile(stateDir: string): string {
  return join(stateDir, 'bridge.jsonl')
}

/** Append one event as a JSON line to the bridge log（经 jsonl.ts 崩断治愈入口）。 */
export function appendBridgeEvent(stateDir: string, event: BridgeEvent): void {
  appendJsonl(bridgeFile(stateDir), event)
}

/** 批量追加（一次 write）：机械战报一跳多条时的写级原子。 */
export function appendBridgeEventBatch(stateDir: string, events: ReadonlyArray<BridgeEvent>): void {
  appendJsonlBatch(bridgeFile(stateDir), events)
}

/** Read and parse the bridge log; malformed lines are skipped, not fatal. */
export function readBridgeEvents(stateDir: string): BridgeEvent[] {
  return readJsonlCached(bridgeFile(stateDir), line => JSON.parse(line) as BridgeEvent)
}

/** Fold the log into the message stream. Pure: no filesystem, no clock. */
export function foldBridge(events: ReadonlyArray<BridgeEvent>): BridgeMessage[] {
  const out: BridgeMessage[] = []
  for (const e of events) {
    if (e.type === 'bridge_user_message') out.push({ kind: 'user', ts: e.ts, text: e.text })
    else if (e.type === 'bridge_agent_message') out.push({ kind: 'agent', ts: e.ts, text: e.text, ...(e.commandRefs !== undefined ? { commandRefs: e.commandRefs } : {}), ...(e.agentId !== undefined ? { agentId: e.agentId } : {}), ...(e.sessionId !== undefined ? { sessionId: e.sessionId } : {}), ...(e.artifact !== undefined ? { artifact: e.artifact } : {}), ...(e.meta !== undefined ? { meta: e.meta } : {}) })
    else if (e.type === 'bridge_system_notice') out.push({ kind: 'system', ts: e.ts, text: e.text, noticeKind: e.noticeKind, dedupKey: e.dedupKey, ...(e.refs !== undefined ? { refs: e.refs } : {}) })
  }
  return out
}

/** Load the channel's message stream from disk (read + fold). */
export function loadBridgeMessages(stateDir: string): BridgeMessage[] {
  return foldBridge(readBridgeEvents(stateDir))
}

/**
 * 未答判定（纯）：最后一条经理人话轮之后的全部舰长发话即待答集——daemon
 * staffTick 据此出 chat 工单（有未答即开回合；答复全文入账后自动清空）。
 * 机械战报不算「答」——战报到场不打断等待经理人回话。
 */
export function bridgeUnanswered(messages: ReadonlyArray<BridgeMessage>): BridgeMessage[] {
  const lastAgent = [...messages].reverse().find(m => m.kind === 'agent')
  if (lastAgent === undefined) return messages.filter(m => m.kind === 'user')
  return messages.filter(m => m.kind === 'user' && m.ts > lastAgent.ts)
}

/**
 * 对话史窗口（纯，工单携史兜底）：末 cap 条压成 role+text——全席通用的逻辑
 * 常驻底座（进程不常驻，历史随工单走；重启不失忆——账本即状态）。
 */
/** D37 token 估算（照搬 lookatstudy token-estimate 启发式）：CJK 1.1 token/字、
 *  其他 4 字符/token——上下文占用表的纯函数底座（不引 tokenizer 依赖；与
 *  proxy-loop 同仓零依赖，放账本模块两侧共用）。 */
export function estimateTokens(s: string): number {
  if (s === '') return 0
  let cjk = 0
  for (const ch of s) if (ch.charCodeAt(0) > 0x2e7f) cjk++
  return Math.round(cjk * 1.1 + (s.length - cjk) / 4)
}
export function bridgeHistoryWindow(messages: ReadonlyArray<BridgeMessage>, cap = 24, tokenBudget?: number): Array<{ role: 'you' | 'manager' | 'system'; text: string }> {
  const tail = messages.slice(-cap)
  // D37 历史 token 预算双闸（防长对话撑爆上下文）：从最新往回累计，超预算即停
  // ——宁可失忆旧话，不让组包超窗（lookatstudy 同款「从新往旧装」纪律）。
  if (tokenBudget !== undefined && tokenBudget > 0) {
    const kept: BridgeMessage[] = []
    let used = 0
    for (let i = tail.length - 1; i >= 0; i--) {
      const cost = estimateTokens(tail[i].text)
      if (kept.length > 0 && used + cost > tokenBudget) break // 至少保最新一条
      kept.unshift(tail[i])
      used += cost
    }
    return kept.map(m => ({ role: m.kind === 'user' ? 'you' as const : m.kind === 'agent' ? 'manager' as const : 'system' as const, text: m.text }))
  }
  return tail.map(m => ({ role: m.kind === 'user' ? 'you' as const : m.kind === 'agent' ? 'manager' as const : 'system' as const, text: m.text }))
}

/** 既有机械战报的幂等键集（syncBridgeNotices 去重用）。 */
export function bridgeNoticeKeys(messages: ReadonlyArray<BridgeMessage>): Set<string> {
  const keys = new Set<string>()
  for (const m of messages) if (m.kind === 'system' && m.dedupKey !== undefined) keys.add(m.dedupKey)
  return keys
}

/** 战报文本上限：标题+败因合起来的机械摘要就该一眼读完，长文在聚焦页。 */
const NOTICE_CLIP = 120
function clip(s: string): string {
  const t = s.replaceAll('\n', ' ').trim()
  return t.length > NOTICE_CLIP ? `${t.slice(0, NOTICE_CLIP)}…` : t
}

/**
 * 机械战报收集（读盘，非纯）：扫 directives/campaigns 账本产出候选 notice 事件，
 * dedupKey=源事件指纹（type:id:ts / 状态指纹），调用方对既有键去重后批量入账。
 * 五触发：reported（交证待验收）/ clarify（澄清挂起）/ retry（失败待重试）/
 * terminal（收官/成任务/取消）/ scheduled（定时令到点派发）。
 */
export function collectBridgeNoticeEvents(stateDir: string, now = new Date()): BridgeEvent[] {
  const ts = now.toISOString()
  const out: BridgeEvent[] = []
  const directives = loadDirectives(stateDir)
  for (const e of readDirectiveEvents(stateDir)) {
    if (e.type === 'directive_clarification_requested') {
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'clarify', dedupKey: `clarify:${e.directiveId}:${e.ts}`, text: `经理人有问题要你定：命令「${clip(directives.find(d => d.id === e.directiveId)?.text ?? e.directiveId)}」挂起澄清——答复后他会带着答案定案。`, refs: { commandId: e.directiveId } })
    }
    if (e.type === 'directive_dispatched') {
      const d = directives.find(x => x.id === e.directiveId)
      if (d?.schedule !== undefined) out.push({ type: 'bridge_system_notice', ts, noticeKind: 'scheduled', dedupKey: `scheduled:${e.directiveId}:${e.ts}`, text: `定时令到点派发：「${clip(d.text)}」。`, refs: { commandId: e.directiveId } })
    }
    if (e.type === 'directive_approved') {
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'terminal', dedupKey: `approved:${e.directiveId}:${e.ts}`, text: `命令已成任务发布，外勤即将应征（任务 ${e.taskId}）。`, refs: { commandId: e.directiveId, taskId: e.taskId } })
    }
    if (e.type === 'directive_cancelled') {
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'terminal', dedupKey: `cancelled:${e.directiveId}:${e.ts}`, text: `命令已撤销：${clip(e.reason)}。`, refs: { commandId: e.directiveId } })
    }
  }
  for (const id of listCampaignIds(stateDir)) {
    const t = loadCampaign(stateDir, id)
    if (t.startedAt === '') continue
    const title = t.title ?? t.intent
    if (t.status === 'reported') {
      const stamp = t.reports.length > 0 ? t.reports[t.reports.length - 1]!.ts : String(t.attempts)
      const last = t.reports.length > 0 ? t.reports[t.reports.length - 1]!.text : ''
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'reported', dedupKey: `reported:${id}:${stamp}`, text: `任务交证待你验收：「${clip(title)}」${last !== '' ? `——${clip(last)}` : ''}（证据链在聚焦页，点开核验后再定夺）。`, refs: { taskId: id } })
    }
    if (t.status === 'failed') {
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'retry', dedupKey: `failed:${id}:${t.attempts}`, text: `任务失败待你定夺：「${clip(title)}」——${clip(t.lastError ?? '无败因记录')}（第 ${t.attempts} 次尝试）。`, refs: { taskId: id } })
    }
    if (t.status === 'closed') {
      out.push({ type: 'bridge_system_notice', ts, noticeKind: 'terminal', dedupKey: `closed:${id}`, text: `收官：「${clip(title)}」${t.closedVerdict !== undefined ? `，判定：${clip(t.closedVerdict)}` : ''}。`, refs: { taskId: id } })
    }
  }
  return out
}

/**
 * 机械战报同步（daemon tick 调用）：收集 → 对既有 dedupKey 去重 → 批量入账。
 * 幂等：同源事件指纹永只报一次；返回入账条数（0=无新事）。
 */
export function syncBridgeNotices(stateDir: string, now = new Date()): number {
  const existing = bridgeNoticeKeys(loadBridgeMessages(stateDir))
  const fresh = collectBridgeNoticeEvents(stateDir, now).filter(e => e.type === 'bridge_system_notice' && !existing.has(e.dedupKey))
  if (fresh.length === 0) return 0
  appendBridgeEventBatch(stateDir, fresh)
  return fresh.length
}
