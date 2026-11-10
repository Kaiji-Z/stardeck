/**
 * 事件源进水口（D39，v0.9.0 对标 dsh-superagent 的 Source/Trigger 层）：外部
 * 环境（GitHub issue/PR/评论、通用 ingest 注入）→ 确定性准入门（零模型）→
 * 命令卡。一条 append-only JSONL（`<stateDir>/sources.jsonl`，第七账本）承载
 * 三类事件：每枚外部事件的处置记录（trigger_seen——superagent「Trigger 是
 * 审计与幂等单位」的对应物）、轮询游标（cursor——重启不重放）、回写回执
 * （writeback_posted——Channel 写侧审计）。
 *
 * 设计纪律：
 * - **收上下文≠收授权**：订阅扇出（directive_input）不改卡状态、不扩权；
 * - **幂等键=sourceId::externalId**：重启/重放不重复建卡；建卡走确定性
 *   directiveId（同键重放 fold 自然 no-op——双保险）；
 * - **不入 SSE revision**：观察记录经 GET /sources 拉取，轮询不刷板。
 * @module stardeck/sources
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { appendJsonl, appendJsonlBatch } from './jsonl.ts'
import { readJsonlCached } from './fold-cache.ts'
import { appendDirectiveEvent, newDirectiveId, type DirectiveOrigin } from './directives.ts'
import type { CampaignState } from './types.ts'

/** 准入强度：explicit=允许名单内作者的显式请求；inferred=observe/auto 档放行的推断候选。 */
export type SourceStrength = 'explicit' | 'inferred'

/** 处置四态：admitted=建卡 / observed=observe 档只记录 / filtered=拒之门外 /
 *  fanned=订阅扇出（context-only 挂卡，不走准入门——superagent 扇出语义）。 */
export type SourceDisposition = 'admitted' | 'observed' | 'filtered' | 'fanned'

/** 推断候选档位（superagent accept 阶梯）：off=只收名单内 / observe=名单外只
 *  记录「若 auto 会接」/ auto=名单外也建卡。名单内作者任何档都建卡。 */
export type SourceAdmissionMode = 'off' | 'observe' | 'auto'

/** 一枚外部事件（轮询器/ingest 只产这个，写账本统一走 ingestSourceTrigger）。 */
export interface SourceTrigger {
  /** 源实例 id：`github:<owner>/<repo>` | `ingest`。 */
  readonly sourceId: string
  /** 源内唯一 id（幂等键后半）：`issue:12` | `issue:12:comment:34` | `manual:<ts36>`。 */
  readonly externalId: string
  /** manual=ingest 端点未指定 kind 的兜底（人手/脚本注入）。 */
  readonly kind: 'issue' | 'pr' | 'comment' | 'manual'
  /** 源线程键（订阅扇出锚）：`github:<owner>/<repo>#12`。 */
  readonly threadKey: string
  readonly author: string
  /** 事件正文（issue/PR=body；评论=评论体）。 */
  readonly text: string
  /** issue/PR 标题（组卡文用；评论缺省）。 */
  readonly title?: string
  readonly url?: string
  /** 源侧发生时刻（ISO；缺省=观察到的时间）。 */
  readonly occurredAt?: string
}

/** 准入门配置（github/ingest 各一份，config.sources 承载）。 */
export interface SourceGateConfig {
  readonly allow: readonly string[]
  readonly mode: SourceAdmissionMode
}

/** 准入判定（纯函数，零模型）：名单（含 '*' 通配）→ explicit 建卡；名单外按
 *  档位 off→filtered / observe→observed / auto→admitted(inferred)。 */
export function admitTrigger(gate: SourceGateConfig, trigger: Pick<SourceTrigger, 'author'>): { strength: SourceStrength; disposition: SourceDisposition; reason?: string } {
  if (gate.allow.includes(trigger.author) || gate.allow.includes('*')) {
    return { strength: 'explicit', disposition: 'admitted' }
  }
  if (gate.mode === 'auto') return { strength: 'inferred', disposition: 'admitted' }
  if (gate.mode === 'observe') return { strength: 'inferred', disposition: 'observed', reason: '名单外作者，observe 档只记录不建卡' }
  return { strength: 'inferred', disposition: 'filtered', reason: '名单外作者且档位 off' }
}

/** The source log's entry union (one JSON line each). */
export type SourceEvent =
  | { type: 'source_trigger_seen'; ts: string; sourceId: string; externalId: string; kind: SourceTrigger['kind']; threadKey: string; author: string; url?: string; excerpt: string; strength: SourceStrength; disposition: SourceDisposition; reason?: string; /** admitted/fanned 时的落卡号（确定性 id）。 */ directiveId?: string }
  | { type: 'source_cursor_advanced'; ts: string; sourceId: string; watermark: string }
  | { type: 'source_writeback_posted'; ts: string; sourceId: string; /** 回写幂等键（终态实体指纹）。 */ dedupKey: string; directiveId: string; taskId?: string; url: string; ok: boolean; error?: string }

/** 处置记录（fold 后形状，GET /sources 的 recent 列表项）。 */
export interface SourceSeenRecord {
  readonly ts: string
  readonly sourceId: string
  readonly externalId: string
  readonly kind: SourceTrigger['kind']
  readonly threadKey: string
  readonly author: string
  readonly url?: string
  readonly excerpt: string
  readonly strength: SourceStrength
  readonly disposition: SourceDisposition
  readonly reason?: string
  readonly directiveId?: string
}

/** 回写状态（fold 派生）：attempts 累计、ok=true 即完成；3 连败 dropped 不再队列。 */
export interface SourceWritebackStatus { attempts: number; ok: boolean; url?: string; error?: string; lastAt: string }

export const WRITEBACK_MAX_ATTEMPTS = 3

/** sources.jsonl 的 fold 产物。 */
export interface SourceFold {
  /** sourceId::externalId → 最新处置记录（同键后写覆盖——heal 轮补 directiveId 的载体）。 */
  readonly seen: ReadonlyMap<string, SourceSeenRecord>
  /** sourceId → 最新游标（ISO watermark，重启不重放）。 */
  readonly cursors: ReadonlyMap<string, string>
  /** dedupKey → 回写状态。 */
  readonly writebacks: ReadonlyMap<string, SourceWritebackStatus>
  /** 处置计数（面板统计）。 */
  readonly counts: Readonly<Record<SourceDisposition, number>>
  /** 最近处置（时间序，尾新；面板 recent 列表）。 */
  readonly recent: readonly SourceSeenRecord[]
}

/** recent 列表上限——「最近发生了什么」不是全文档案。 */
const RECENT_CAP = 50

export function foldSources(events: ReadonlyArray<SourceEvent>): SourceFold {
  const seen = new Map<string, SourceSeenRecord>()
  const cursors = new Map<string, string>()
  const writebacks = new Map<string, SourceWritebackStatus>()
  const counts: Record<SourceDisposition, number> = { admitted: 0, observed: 0, filtered: 0, fanned: 0 }
  for (const e of events) {
    if (e.type === 'source_cursor_advanced') {
      cursors.set(e.sourceId, e.watermark)
      continue
    }
    if (e.type === 'source_writeback_posted') {
      const prev = writebacks.get(e.dedupKey)
      writebacks.set(e.dedupKey, {
        attempts: (prev?.attempts ?? 0) + 1,
        ok: e.ok || prev?.ok === true,
        ...(e.ok ? { url: e.url } : (prev?.url !== undefined ? { url: prev.url } : {})),
        ...(!e.ok && e.error !== undefined ? { error: e.error } : (prev?.error !== undefined ? { error: prev.error } : {})),
        lastAt: e.ts,
      })
      continue
    }
    // source_trigger_seen：同键后写覆盖（首记处置 + heal 轮补 directiveId 两条
    // 记录折成最新一面）；计数按键的最终处置归一次（重放/heal 不虚增）。
    const key = sourceKey(e.sourceId, e.externalId)
    const prev = seen.get(key)
    if (prev !== undefined) counts[prev.disposition] -= 1
    counts[e.disposition] += 1
    seen.set(key, {
      ts: e.ts, sourceId: e.sourceId, externalId: e.externalId, kind: e.kind, threadKey: e.threadKey, author: e.author,
      ...(e.url !== undefined ? { url: e.url } : {}), excerpt: e.excerpt, strength: e.strength, disposition: e.disposition,
      ...(e.reason !== undefined ? { reason: e.reason } : {}), ...(e.directiveId !== undefined ? { directiveId: e.directiveId } : {}),
    })
  }
  const recent = [...seen.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).slice(-RECENT_CAP)
  return { seen, cursors, writebacks, counts, recent }
}

function sourcesFile(stateDir: string): string {
  return join(stateDir, 'sources.jsonl')
}

export function appendSourceEvents(stateDir: string, events: ReadonlyArray<SourceEvent>): void {
  appendJsonlBatch(sourcesFile(stateDir), events)
}

export function readSourceEvents(stateDir: string): SourceEvent[] {
  return readJsonlCached(sourcesFile(stateDir), line => JSON.parse(line) as SourceEvent)
}

export function loadSourceFold(stateDir: string): SourceFold {
  return foldSources(readSourceEvents(stateDir))
}

/** 幂等键。 */
export function sourceKey(sourceId: string, externalId: string): string {
  return `${sourceId}::${externalId}`
}

/** 确定性命令号：`cmd-src-<hash10>`——同源同事件重放得到同一 id，fold 对已
 *  存在 id 的 directive_created 天然 no-op（双保险：seen 去重之外的崩溃窗自愈）。
 *  与时间基 id（cmd-YYYYMMDD-…）中段不同形，永不碰撞。 */
export function deterministicDirectiveId(sourceId: string, externalId: string): string {
  const h = createHash('sha1').update(sourceKey(sourceId, externalId)).digest('hex').slice(0, 10)
  return `cmd-src-${h}`
}

/** 处置记录的摘要上限（「一眼扫过」的量，全文在源侧）。 */
const EXCERPT_CLIP = 160
function excerptOf(text: string): string {
  const t = text.replaceAll('\n', ' ').trim()
  return t.length > EXCERPT_CLIP ? `${t.slice(0, EXCERPT_CLIP)}…` : t
}

/** 组卡文上限：issue 正文截 1500 字——过长正文在源侧，卡是入口不是档案。 */
const TRIGGER_BODY_CLIP = 1500
function clipBody(text: string): string {
  const t = text.trim()
  return t.length > TRIGGER_BODY_CLIP ? `${t.slice(0, TRIGGER_BODY_CLIP)}…\n（正文过长已截断，全文见来源链接）` : t
}

/** 组卡文：`[GitHub issue #12] 标题\n正文\n(@作者 · url)`——大副分诊/澄清协议
 *  的输入面（issue 模糊文本天然喂 D23 成熟度评估）。 */
export function composeTriggerText(trigger: SourceTrigger): string {
  const label = trigger.kind === 'pr' ? 'pull request' : trigger.kind === 'comment' ? '评论' : 'issue'
  const head = trigger.title !== undefined && trigger.title.trim() !== ''
    ? `[${trigger.sourceId} ${label}] ${trigger.title.trim()}`
    : `[${trigger.sourceId} ${label}]`
  const body = clipBody(trigger.text)
  const tail = `(@${trigger.author}${trigger.url !== undefined ? ` · ${trigger.url}` : ''})`
  return body === '' ? `${head}\n${tail}` : `${head}\n\n${body}\n\n${tail}`
}

/** origin 构造（Mandate-lite，随 created 冻结）。 */
export function originOf(trigger: SourceTrigger, strength: SourceStrength, observedAt: string): DirectiveOrigin {
  return {
    source: trigger.sourceId.startsWith('github:') ? 'github' : 'ingest',
    kind: trigger.kind,
    ...(trigger.url !== undefined ? { url: trigger.url } : {}),
    ...(trigger.author !== undefined ? { author: trigger.author } : {}),
    ...(trigger.threadKey !== undefined ? { threadKey: trigger.threadKey } : {}),
    strength,
    observedAt,
  }
}

/** 单源入账收口（daemon 唯一写口——轮询器/ingest 端点都汇到这里）：
 * ①seen 幂等查重（已处置过→duplicate）②准入门③admitted 建卡（确定性 id，
 *  双保险自愈）④处置+游标写级原子入账。返回给端点回执。 */
export function ingestSourceTrigger(
  stateDir: string,
  gate: SourceGateConfig,
  trigger: SourceTrigger,
  now: Date = new Date(),
): { duplicate: true } | { duplicate: false; verdict: ReturnType<typeof admitTrigger>; directiveId?: string } {
  const fold = loadSourceFold(stateDir)
  const key = sourceKey(trigger.sourceId, trigger.externalId)
  if (fold.seen.has(key)) return { duplicate: true }
  const verdict = admitTrigger(gate, trigger)
  const ts = now.toISOString()
  let directiveId: string | undefined
  if (verdict.disposition === 'admitted') {
    directiveId = deterministicDirectiveId(trigger.sourceId, trigger.externalId)
    appendDirectiveEvent(stateDir, {
      type: 'directive_created', ts, directiveId, text: composeTriggerText(trigger),
      issuedBy: `${trigger.sourceId.startsWith('github:') ? 'github' : 'ingest'}:${trigger.author}`,
      origin: originOf(trigger, verdict.strength, ts),
    })
  }
  appendSourceEvents(stateDir, [{
    type: 'source_trigger_seen', ts, sourceId: trigger.sourceId, externalId: trigger.externalId, kind: trigger.kind,
    threadKey: trigger.threadKey, author: trigger.author, ...(trigger.url !== undefined ? { url: trigger.url } : {}),
    excerpt: excerptOf(trigger.title !== undefined && trigger.title.trim() !== '' ? `${trigger.title.trim()}——${trigger.text}` : trigger.text),
    strength: verdict.strength, disposition: verdict.disposition, ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
    ...(directiveId !== undefined ? { directiveId } : {}),
  }])
  return { duplicate: false, verdict, ...(directiveId !== undefined ? { directiveId } : {}) }
}

/** 孤儿建卡自愈（崩溃窗：directive 已建但 seen 未落——确定性 id 使重放 no-op，
 *  这里只补记 seen 使幂等键闭合；daemon sourceTick 每轮扫一遍，无孤儿即空转）。 */
export function healOrphanAdmissions(stateDir: string, now: Date = new Date()): number {
  const fold = loadSourceFold(stateDir)
  const events: SourceEvent[] = []
  for (const record of fold.seen.values()) {
    if (record.disposition !== 'admitted' || record.directiveId !== undefined) continue
    const directiveId = deterministicDirectiveId(record.sourceId, record.externalId)
    events.push({ type: 'source_trigger_seen', ts: now.toISOString(), sourceId: record.sourceId, externalId: record.externalId, kind: record.kind, threadKey: record.threadKey, author: record.author, ...(record.url !== undefined ? { url: record.url } : {}), excerpt: record.excerpt, strength: record.strength, disposition: record.disposition, ...(record.reason !== undefined ? { reason: record.reason } : {}), directiveId })
  }
  if (events.length === 0) return 0
  appendSourceEvents(stateDir, events)
  return events.length
}

// ---------- D39-C 订阅扇出 ----------

/** 订阅表（fold 派生，不建新存储——诚实状态）：非终态卡（draft/received/
 *  talking）的 threadKey → directiveId。approved/cancelled 不订阅（终态卡不吃
 *  新件；superagent「ended Ticket 保订阅可复活」暂不引入——复活走续接令）。 */
export function subscriptionIndex(directives: ReadonlyArray<{ id: string; status: string; origin?: Readonly<DirectiveOrigin> }>): Map<string, string> {
  const out = new Map<string, string>()
  for (const d of directives) {
    if (d.status === 'approved' || d.status === 'cancelled') continue
    const threadKey = d.origin?.threadKey
    if (threadKey !== undefined && threadKey !== '') out.set(threadKey, d.id)
  }
  return out
}

/** 扇出收口：源线程新评论 → directive_input（context-only）+ seen 记录
 *  （disposition='fanned'，幂等键同源）。终态守卫由调用方（订阅表）保证，
 *  这里再判一次 directive 在场。 */
export function fanoutTriggerToDirective(
  stateDir: string,
  trigger: SourceTrigger,
  directiveId: string,
  now: Date = new Date(),
): boolean {
  const fold = loadSourceFold(stateDir)
  const key = sourceKey(trigger.sourceId, trigger.externalId)
  if (fold.seen.has(key)) return false
  const ts = now.toISOString()
  const gate = { strength: 'explicit' as const, disposition: 'fanned' as const }
  appendDirectiveEvent(stateDir, { type: 'directive_input', ts, directiveId, text: clipBody(trigger.text), ...(trigger.author !== undefined ? { author: trigger.author } : {}), ...(trigger.url !== undefined ? { url: trigger.url } : {}) })
  appendSourceEvents(stateDir, [{
    type: 'source_trigger_seen', ts, sourceId: trigger.sourceId, externalId: trigger.externalId, kind: trigger.kind,
    threadKey: trigger.threadKey, author: trigger.author, ...(trigger.url !== undefined ? { url: trigger.url } : {}),
    excerpt: excerptOf(trigger.text), strength: gate.strength, disposition: gate.disposition, directiveId,
  }])
  return true
}

// ---------- D39-D 收官回写（Channel 写侧） ----------

/** 回写幂等键（终态实体指纹——每实体每终态至多一次，3 连败 dropped）。 */
export function writebackKeyClosed(taskId: string): string { return `wb:closed:${taskId}` }
export function writebackKeyFailed(taskId: string): string { return `wb:failed:${taskId}` }
export function writebackKeyCancelled(directiveId: string): string { return `wb:cancelled:${directiveId}` }

/** 回写是否还该尝试：未成、未弃（attempts<MAX）。 */
export function writebackPending(status: SourceWritebackStatus | undefined): boolean {
  if (status === undefined) return true
  return !status.ok && status.attempts < WRITEBACK_MAX_ATTEMPTS
}

/** 内部路径消毒：工作区绝对路径不外发（对外发布面纪律）。 */
function scrubPaths(text: string, task: CampaignState | undefined): string {
  let out = text
  if (task?.workspacePath !== undefined && task.workspacePath !== '') out = out.replaceAll(task.workspacePath, '<工作区>')
  return out
}

function clipFor(s: string, max: number): string {
  const t = s.replaceAll('\n', ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 机械组稿（不经模型——对外发布安全设计）：结论先行/只指路/给下一步（战报
 *  =最终答复正典）。三类终态：closed（收官）/ failed（失败）/ cancelled（撤销）。 */
export function composeWritebackBody(
  shape: 'closed' | 'failed' | 'cancelled',
  directive: { text: string; origin?: Readonly<DirectiveOrigin>; cancelledReason?: string },
  task: CampaignState | undefined,
): string {
  const lines: string[] = []
  const title = task?.title ?? directive.text.split('\n')[0] ?? ''
  if (shape === 'cancelled') {
    lines.push('【stardeck 战报】命令已撤销。')
    lines.push(`命令：${clipFor(title, 120)}`)
    if (directive.cancelledReason !== undefined && directive.cancelledReason.trim() !== '') lines.push(`理由：${clipFor(directive.cancelledReason, 160)}`)
    return lines.join('\n')
  }
  if (shape === 'failed') {
    lines.push('【stardeck 战报】任务失败（重试已用尽）。')
    lines.push(`任务：${clipFor(title, 120)}`)
    lines.push(`败因：${clipFor(task?.lastError ?? '无败因记录', 200)}`)
    lines.push('下一步：如需再战，在本贴追加说明即可（stardeck 会作为新进件处理）。')
    return lines.join('\n')
  }
  const lastReport = task !== undefined && task.reports.length > 0 ? task.reports[task.reports.length - 1] : undefined
  lines.push('【stardeck 战报】任务收官。')
  lines.push(`任务：${clipFor(title, 120)}`)
  lines.push(`判定：${clipFor(task?.closedVerdict ?? '', 160)}`)
  if (lastReport !== undefined && lastReport.text !== '') lines.push(`报告摘要：${clipFor(scrubPaths(lastReport.text, task), 400)}`)
  const loot = (task?.deliverables ?? []).slice(-8)
  if (loot.length > 0) {
    lines.push('交付物：')
    for (const d of loot) lines.push(`- ${clipFor(d.summary, 120)}`)
  }
  if (lastReport?.evidence !== undefined) {
    const ev = lastReport.evidence
    const checks = ev.checks.length > 0 ? `${ev.checks.filter(c => c.passed).length}/${ev.checks.length}` : '—'
    const tests = ev.tests !== undefined ? ` · 测试「${clipFor(ev.tests.command, 80)}」退出码 ${ev.tests.exitCode}` : ''
    lines.push(`证据（KillCredit 机械核验）：验收判据 ${checks} 通过${tests}`)
  }
  lines.push('下一步：如需继续，在本贴追加说明即可（stardeck 会作为新进件处理）。')
  return lines.join('\n')
}

/** 新命令号兜底（导出给需要时间基 id 的调用方；源卡走确定性 id）。 */
export { newDirectiveId }
