/**
 * D39 GitHub 源轮询器测试（本地 mock HTTP 服当 apiBase——零真外联确定性）：
 * issues+PR 形状转换（pull_request 字段分野）、评论只取订阅线程、游标推进、
 * 错误不抛带回执、回帖 POST 形状。ingest/writeback 的端到端在
 * source-intake.test.ts（真 daemon 链路）。
 * @module stardeck/tests/source-github
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'

const { pollGithub, postGithubComment, issueNumberFromThreadKey } = await import('../src/source-github.ts')

interface MockState { issuesHits: number; commentHits: number; posted: Array<{ number: number; body: string }> }

/** mock GitHub：/issues 与 /issues/comments 各回固定清单；/issues/N/comments 收帖。 */
async function mockGithub(issues: unknown[], comments: unknown[]): Promise<{ server: Server; base: string; state: MockState }> {
  const state: MockState = { issuesHits: 0, commentHits: 0, posted: [] }
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && url.startsWith('/repos/o/r/issues?')) {
      state.issuesHits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(issues))
      return
    }
    if (req.method === 'GET' && url.startsWith('/repos/o/r/issues/comments?')) {
      state.commentHits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(comments))
      return
    }
    const m = /\/repos\/o\/r\/issues\/(\d+)\/comments$/.exec(url)
    if (req.method === 'POST' && m !== null) {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        state.posted.push({ number: Number(m[1]), body: (JSON.parse(body) as { body: string }).body })
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ html_url: `https://github.com/o/r/issues/${m[1]}#comment-new` }))
      })
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock address')
  return { server, base: `http://127.0.0.1:${address.port}`, state }
}

const ISSUE_12 = { number: 12, title: '登录 500', body: '复现：…', html_url: 'https://github.com/o/r/issues/12', updated_at: '2026-11-10T01:00:00Z', state: 'open', user: { login: 'alice' } }
const PR_13 = { number: 13, title: '修登录', body: '', html_url: 'https://github.com/o/r/pull/13', updated_at: '2026-11-10T01:30:00Z', state: 'open', user: { login: 'bob' }, pull_request: {} }
const COMMENT_ON_12 = { id: 3401, body: '补充：只在水星时段', html_url: 'https://github.com/o/r/issues/12#issuecomment-3401', updated_at: '2026-11-10T02:00:00Z', user: { login: 'carol' }, issue_url: 'https://api.github.com/repos/o/r/issues/12' }
const COMMENT_ON_99 = { id: 3402, body: '别的线程', html_url: 'https://github.com/o/r/issues/99#issuecomment-3402', updated_at: '2026-11-10T02:10:00Z', user: { login: 'dave' }, issue_url: 'https://api.github.com/repos/o/r/issues/99' }

test('轮询：issue/PR 分野 + 订阅线程评论过滤 + 游标推进到 max(updated_at)', async () => {
  const mock = await mockGithub([ISSUE_12, PR_13], [COMMENT_ON_12, COMMENT_ON_99])
  try {
    const out = await pollGithub({
      apiBase: mock.base, repo: 'o/r', token: 't-test', watermark: '2026-11-10T00:00:00Z',
      subscribedThreadKeys: ['github:o/r#12'],
    })
    assert.equal(out.error, undefined)
    assert.equal(out.triggers.length, 3, 'issue+pr+订阅评论')
    const kinds = out.triggers.map(t => `${t.kind}:${t.externalId}`).sort()
    assert.deepEqual(kinds, ['comment:issue:12:comment:3401', 'issue:issue:12', 'pr:issue:13'])
    // PR 分野靠 pull_request 字段。
    const pr = out.triggers.find(t => t.kind === 'pr')!
    assert.equal(pr.author, 'bob')
    assert.equal(pr.threadKey, 'github:o/r#13')
    // 订阅外线程（#99）的评论被滤。
    assert.ok(!out.triggers.some(t => t.externalId.includes('3402')))
    // 时间序（occurredAt 升序）。
    assert.deepEqual(out.triggers.map(t => t.occurredAt), [...out.triggers.map(t => t.occurredAt)].sort())
    // 游标=max(updated_at of 已入账触发器)——**不含被滤评论**（02:10 的 #99）：
    // 晚订阅安全（卡后建时该评论仍会被 since=02:00 再次带回并入账；GitHub
    // since 语义=>=，等值边也回）。代价=被滤评论每轮多带一次、客户端滤掉，可接受。
    assert.equal(out.watermark, '2026-11-10T02:00:00Z')
    // 时间序断言的补：issue 12 的 threadKey。
    assert.equal(out.triggers.find(t => t.externalId === 'issue:12')?.threadKey, 'github:o/r#12')
  } finally {
    await new Promise<void>(resolve => mock.server.close(() => resolve()))
  }
})

test('轮询：无订阅不拉评论（省配额）；HTTP 错误不抛带回执', async () => {
  const mock = await mockGithub([ISSUE_12], [COMMENT_ON_12])
  try {
    const out = await pollGithub({ apiBase: mock.base, repo: 'o/r', token: 't', watermark: '2026-11-10T00:00:00Z', subscribedThreadKeys: [] })
    assert.equal(mock.state.commentHits, 0, '无订阅零评论请求')
    assert.equal(out.triggers.length, 1)
  } finally { await new Promise<void>(r => mock.server.close(() => r())) }
  // 错误面：404 服务。
  const bad = await mockGithub([], [])
  await new Promise<void>(r => bad.server.close(() => r()))
  // 端口已关——fetch 抛 → Result 带 error 不抛出。
  const out2 = await pollGithub({ apiBase: bad.base, repo: 'o/r', token: 't', watermark: 'x' })
  assert.notEqual(out2.error, undefined, '错误带回执')
  assert.deepEqual(out2.triggers, [], '零触发器')
  assert.equal(out2.watermark, 'x', '游标不动（下轮重试不丢事件）')
})

test('回帖：POST 形状与回执；threadKey 解析', async () => {
  const mock = await mockGithub([], [])
  try {
    const out = await postGithubComment({ apiBase: mock.base, repo: 'o/r', token: 't', issueNumber: 12, body: '【stardeck 战报】任务收官。' })
    assert.equal(out.ok, true)
    assert.match(out.url, /issues\/12#comment-new/)
    assert.deepEqual(mock.state.posted, [{ number: 12, body: '【stardeck 战报】任务收官。' }])
  } finally { await new Promise<void>(r => mock.server.close(() => r())) }
  assert.equal(issueNumberFromThreadKey('github:o/r#12'), 12)
  assert.equal(issueNumberFromThreadKey('github:o/r#notnum'), undefined)
  assert.equal(issueNumberFromThreadKey('ingest:manual'), undefined)
})
