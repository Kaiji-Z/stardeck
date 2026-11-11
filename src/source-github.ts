/**
 * GitHub 事件源轮询器（D39-A 第一个内建源）：REST 轮询 issues（含 PR）与
 * issue 评论，只产 SourceTrigger 不写账本（写账本统一走 sources.ts 的
 * ingestSourceTrigger/fanoutTriggerToDirective 收口——applyProxyReply 单源纪律）。
 *
 * 家法：
 * - **重启不重放**：游标=已见事件的 max(updated_at)，随 sources.jsonl 走；
 *   首跑无游标=以当下为基线（不倒灌整个仓的历史——第一次连接只收新事件）；
 * - **零新依赖**：node 全局 fetch；apiBase 可指 GHES/本地 mock（测试确定性）；
 * - **限页防洪水**：每轮至多 2 页 issues（50/页）+ 2 页评论（100/页），升序
 *   消化——游标只推进到本轮实际读到的最旧一端之后，积压下轮接着啃，不在一
 *   轮里爆管也不丢事件（desc+封顶会让第 3 页以后的旧事件 updated_at 恒小于
 *   游标而被 since 永久排除——洪峰静默丢失）。
 * @module stardeck/source-github
 */

import type { SourceTrigger } from './sources.ts'

/** GitHub REST 条目的结构切片（够用就好，不引类型依赖）。 */
interface GhIssue {
  number: number
  title?: string
  body?: string | null
  html_url?: string
  updated_at?: string
  state?: string
  user?: { login?: string } | null
  pull_request?: unknown
}

interface GhComment {
  id: number
  body?: string | null
  html_url?: string
  updated_at?: string
  user?: { login?: string } | null
  issue_url?: string
}

export interface GithubPollArgs {
  apiBase: string
  repo: string
  token: string
  /** 上轮游标（ISO）。缺省=首跑基线（只收当下之后的新事件）。 */
  watermark?: string
  /** 订阅线程键（D39-C：有活卡的 threadKey 才拉评论——无订阅不拉评论省配额）。 */
  subscribedThreadKeys?: readonly string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface GithubPollResult {
  triggers: SourceTrigger[]
  /** 本轮新游标（有事件=max updated_at；无事件=原游标不变）。 */
  watermark: string
  error?: string
}

function threadKeyOf(repo: string, number: number): string {
  return `github:${repo}#${number}`
}

/** issue_url（…/repos/o/r/issues/12）→ issue 号；解析失败=undefined。 */
function issueNumberFromUrl(url: string | undefined): number | undefined {
  if (url === undefined) return undefined
  const m = /\/issues\/(\d+)$/.exec(url)
  return m !== null ? Number(m[1]) : undefined
}

async function ghFetch(fetchImpl: typeof fetch, url: string, token: string, timeoutMs: number): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, json: await res.json() as unknown }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 轮询一轮：issues（含 PR，state=open，since=watermark）+ 订阅线程的评论。
 * 触发器按 occurredAt 升序返回（时间序入账）。错误不抛——Result 带 error，
 * 调用方下轮重试（游标不进=不丢事件）。
 */
export async function pollGithub(args: GithubPollArgs): Promise<GithubPollResult> {
  const fetchImpl = args.fetchImpl ?? fetch
  const timeoutMs = args.timeoutMs ?? 15_000
  const base = args.apiBase.replace(/\/+$/, '')
  const since = args.watermark
  const triggers: SourceTrigger[] = []
  let cursor = args.watermark ?? ''

  // ① issues+PR（每轮至多 2 页——增量轮询的常态是 0-1 页）。升序=从 since 起
  // 由旧到新：封顶时游标停在末页末项，未读的新积压 updated_at > 游标，下轮
  // 接着收（desc 会把没读到的旧事件永久关在 since 门外）。
  for (let page = 1; page <= 2; page++) {
    const q = new URLSearchParams({ state: 'open', sort: 'updated', direction: 'asc', per_page: '50', ...(page > 1 ? { page: String(page) } : {}), ...(since !== '' ? { since } : {}) })
    const out = await ghFetch(fetchImpl, `${base}/repos/${args.repo}/issues?${q.toString()}`, args.token, timeoutMs)
    if (!out.ok) return { triggers: [], watermark: cursor, error: `issues 轮询失败：${out.error}` }
    const items = Array.isArray(out.json) ? out.json as GhIssue[] : []
    if (items.length === 0) break
    for (const it of items) {
      const author = it.user?.login ?? 'unknown'
      const kind = it.pull_request !== undefined ? 'pr' : 'issue'
      triggers.push({
        sourceId: `github:${args.repo}`,
        externalId: `issue:${it.number}`,
        kind,
        threadKey: threadKeyOf(args.repo, it.number),
        author,
        text: it.body ?? '',
        ...(it.title !== undefined ? { title: it.title } : {}),
        ...(it.html_url !== undefined ? { url: it.html_url } : {}),
        ...(it.updated_at !== undefined ? { occurredAt: it.updated_at } : {}),
      })
      if ((it.updated_at ?? '') > cursor) cursor = it.updated_at ?? ''
    }
    if (items.length < 50) break
  }

  // ② 订阅线程的评论（D39-C：只拉有活卡线程——无订阅跳过省配额）。
  const subscribed = args.subscribedThreadKeys ?? []
  if (subscribed.length > 0) {
    const q = new URLSearchParams({ sort: 'updated', direction: 'asc', per_page: '100', ...(since !== '' ? { since } : {}) })
    for (let page = 1; page <= 2; page++) {
      const pq = new URLSearchParams(q)
      if (page > 1) pq.set('page', String(page))
      const out = await ghFetch(fetchImpl, `${base}/repos/${args.repo}/issues/comments?${pq.toString()}`, args.token, timeoutMs)
      if (!out.ok) {
        // 评论拉取失败不拖垮整轮——issues 已到手照常入账，错误带回给调用方记健康。
        return { triggers, watermark: cursor, error: `comments 轮询失败：${out.error}` }
      }
      const items = Array.isArray(out.json) ? out.json as GhComment[] : []
      if (items.length === 0) break
      for (const c of items) {
        const n = issueNumberFromUrl(c.issue_url)
        if (n === undefined) continue
        const threadKey = threadKeyOf(args.repo, n)
        if (!subscribed.includes(threadKey)) continue
        triggers.push({
          sourceId: `github:${args.repo}`,
          externalId: `issue:${n}:comment:${c.id}`,
          kind: 'comment',
          threadKey,
          author: c.user?.login ?? 'unknown',
          text: c.body ?? '',
          ...(c.html_url !== undefined ? { url: c.html_url } : {}),
          ...(c.updated_at !== undefined ? { occurredAt: c.updated_at } : {}),
        })
        if ((c.updated_at ?? '') > cursor) cursor = c.updated_at ?? ''
      }
      if (items.length < 100) break
    }
  }

  triggers.sort((a, b) => (a.occurredAt ?? '') < (b.occurredAt ?? '') ? -1 : (a.occurredAt ?? '') > (b.occurredAt ?? '') ? 1 : 0)
  return { triggers, watermark: cursor }
}

/** 回帖（D39-D Channel 写侧）：POST issue comment → 201 即成。url=回帖地址。 */
export async function postGithubComment(args: {
  apiBase: string
  repo: string
  token: string
  issueNumber: number
  body: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const timeoutMs = args.timeoutMs ?? 15_000
  const base = args.apiBase.replace(/\/+$/, '')
  try {
    const res = await fetchImpl(`${base}/repos/${args.repo}/issues/${args.issueNumber}/comments`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${args.token}`, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify({ body: args.body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const json = await res.json() as { html_url?: string }
    return { ok: true, url: json.html_url ?? '' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** threadKey（github:owner/repo#12）→ issue 号；解析失败=undefined。 */
export function issueNumberFromThreadKey(threadKey: string): number | undefined {
  const m = /^github:[^#]+#(\d+)$/.exec(threadKey)
  return m !== null ? Number(m[1]) : undefined
}
