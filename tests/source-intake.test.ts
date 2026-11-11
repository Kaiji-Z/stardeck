/**
 * D39 事件源进水口·真 daemon 链路测试（端口底数 60 网格全仓独占——win32
 * 并行串话坑纪律）：ingest 端点（准入×档位/幂等）、/board 投影 origin、
 * GET /sources 视图、订阅扇出 directive_input 上板、舰桥 intake 机械战报
 * （collectBridgeNoticeEvents 单元面）、收官回写 e2e（mock GitHub 服收帖+
 * 幂等不重发）、旗 OFF 面 404（STARDECK_SOURCES=0——字节等价纪律）。
 * @module stardeck/tests/source-intake
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { startDaemon } = await import('../src/daemon.ts')
const { writeSourcesConfig } = await import('../src/config.ts')
const { appendDirectiveEvent, readDirectiveEvents } = await import('../src/directives.ts')
const { fanoutTriggerToDirective } = await import('../src/sources.ts')
const { collectBridgeNoticeEvents, bridgeNoticeKeys, foldBridge } = await import('../src/bridge.ts')

const PORT = 41750 + (process.pid % 50)

function boot(over: Record<string, string | undefined> = {}): { base: string; stateDir: string; close: () => Promise<void> } {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-srcintake-'))
  process.env.STARDECK_CONFIG = join(stateDir, 'config.json')
  process.env.STARDECK_STAFF = '0'
  process.env.STARDECK_SOURCES = '1'
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k]
    else (process.env as Record<string, string>)[k] = v
  }
  const handle = startDaemon({ port: PORT, stateDir })
  return { base: handle.base, stateDir, close: async () => { await handle.close() } }
}

async function waitHealth(base: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/warroom/api/healthz`)).ok) return } catch { }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error('daemon 未就绪')
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() as any }
}

test('ingest 全链路：准入建卡→origin 上板→幂等→observe 不建卡→GET /sources', { timeout: 60_000 }, async () => {
  const env = boot()
  try {
    await waitHealth(env.base)
    // 收窄 ingest 名单（默认 '*' 全显式——测试要验 observe 面）。
    const written = writeSourcesConfig({ ingest: { allow: ['kaiji'], admission: 'observe' } })
    assert.equal(written.ok, true)
    // ① 名单内 → admitted 建卡。
    const r1 = await post(env.base, '/warroom/api/sources/ingest', {
      source: 'ingest', kind: 'issue', author: 'kaiji', text: '把 README 的安装节补全',
      threadKey: 'github:o/r#12', externalId: 'issue:12', url: 'https://github.com/o/r/issues/12',
    })
    assert.equal(r1.status, 200)
    assert.equal(r1.json.ok, true)
    assert.equal(r1.json.disposition, 'admitted')
    assert.match(r1.json.directiveId, /^cmd-src-/, '确定性 id')
    const cardId = r1.json.directiveId as string
    // ② /board 投影：origin 齐装（Mandate-lite 上板）。
    const board = await (await fetch(`${env.base}/warroom/api/board`)).json() as any
    const card = board.commands.find((c: any) => c.commandId === cardId)
    assert.ok(card !== undefined, '卡在板')
    assert.equal(card.origin.source, 'ingest')
    assert.equal(card.origin.threadKey, 'github:o/r#12')
    assert.equal(card.origin.strength, 'explicit')
    assert.equal(card.issuedBy, 'ingest:kaiji')
    // ③ 幂等：同 externalId 再注入=duplicate。
    const r2 = await post(env.base, '/warroom/api/sources/ingest', { source: 'ingest', kind: 'issue', author: 'kaiji', text: 'x', externalId: 'issue:12', threadKey: 'github:o/r#12' })
    assert.equal(r2.json.duplicate, true)
    assert.equal((await (await fetch(`${env.base}/warroom/api/board`)).json() as any).commands.length, 1)
    // ④ 名单外 observe → observed 不建卡（半自主中间档）。
    const r3 = await post(env.base, '/warroom/api/sources/ingest', { source: 'ingest', kind: 'issue', author: 'stranger', text: '路过', externalId: 'issue:13', threadKey: 'github:o/r#13' })
    assert.equal(r3.json.disposition, 'observed')
    assert.equal(r3.json.directiveId, undefined)
    // ⑤ GET /sources：统计+最近处置。
    const view = await (await fetch(`${env.base}/warroom/api/sources`)).json() as any
    assert.equal(view.ok, true)
    assert.equal(view.counts.admitted, 1)
    assert.equal(view.counts.observed, 1)
    assert.ok(Array.isArray(view.recent) && view.recent.length === 2)
    // ⑥ 舰桥 intake 机械战报（单元面——STAFF=0 不跑 syncBridgeNotices，纪律同既有测试）。
    const notices = collectBridgeNoticeEvents(env.stateDir).filter(e => e.type === 'bridge_system_notice' && e.noticeKind === 'intake')
    assert.equal(notices.length, 1, '建卡战报一条（observed 不报）')
    assert.ok(notices[0] !== undefined && notices[0].type === 'bridge_system_notice' && notices[0].text.includes('外部进件已建卡'))
    assert.ok(!bridgeNoticeKeys(foldBridge(notices)).size === false)
    // ⑦ 订阅扇出：同线程评论 → directive_input 上板（context-only）。
    assert.equal(fanoutTriggerToDirective(env.stateDir, {
      sourceId: 'ingest', externalId: 'issue:12:comment:1', kind: 'comment', threadKey: 'github:o/r#12',
      author: 'crew', text: '补充：含桌面壳', url: 'https://github.com/o/r/issues/12#issuecomment-1',
    }, cardId), true)
    const board2 = await (await fetch(`${env.base}/warroom/api/board`)).json() as any
    const card2 = board2.commands.find((c: any) => c.commandId === cardId)
    assert.equal(card2.inputs.length, 1)
    assert.equal(card2.inputs[0].text, '补充：含桌面壳')
    assert.equal(card2.inputs[0].author, 'crew')
    assert.equal(card2.status, 'draft', 'context-only 不改状态')
  } finally {
    await env.close()
    rmSync(env.stateDir, { recursive: true, force: true })
  }
})

test('收官回写 e2e：cancelled 终态→mock GitHub 收帖→幂等不重发', { timeout: 120_000 }, async () => {
  const posted: Array<{ number: number; body: string }> = []
  const mock: Server = createServer((req, res) => {
    const m = /\/repos\/o\/r\/issues\/(\d+)\/comments$/.exec(req.url ?? '')
    if (req.method === 'POST' && m !== null) {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        posted.push({ number: Number(m[1]), body: (JSON.parse(body) as { body: string }).body })
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ html_url: 'https://github.com/o/r/issues/12#c1' }))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('[]')
  })
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', () => r()))
  const address = mock.address()
  if (address === null || typeof address === 'string') throw new Error('mock address')
  const mockBase = `http://127.0.0.1:${address.port}`
  const env = boot()
  try {
    await waitHealth(env.base)
    const w = writeSourcesConfig({ github: { enabled: true, repo: 'o/r', token: 't-test', apiBase: mockBase, allow: ['kaiji'], admission: 'observe', writeback: true, pollSec: 15 } })
    assert.equal(w.ok, true)
    const r = await post(env.base, '/warroom/api/sources/ingest', {
      source: 'github:o/r', kind: 'issue', author: 'kaiji', text: '修一下', threadKey: 'github:o/r#12',
      externalId: 'issue:12', url: 'https://github.com/o/r/issues/12',
    })
    assert.equal(r.json.disposition, 'admitted')
    // 终态：直接写账本（war_abandon_command 的账面效果——扫描器只认账本态）。
    appendDirectiveEvent(env.stateDir, { type: 'directive_cancelled', ts: new Date().toISOString(), directiveId: r.json.directiveId, reason: '需求变了' })
    // 等 sourceTick（15s 哨位）把回写发出去。
    for (let i = 0; i < 40 && posted.length === 0; i++) await new Promise(res => setTimeout(res, 2000))
    assert.equal(posted.length, 1, `回写已发（等待后 posted=${JSON.stringify(posted)}）`)
    assert.equal(posted[0]!.number, 12)
    assert.ok(posted[0]!.body.includes('命令已撤销'), '机械组稿 cancelled 形')
    assert.ok(posted[0]!.body.includes('理由：需求变了'), '撤销理由溯源账本')
    // 幂等：再等一轮 tick 不重发。
    await new Promise(res => setTimeout(res, 17_000))
    assert.equal(posted.length, 1, '终态指纹幂等——不重发')
  } finally {
    await env.close()
    rmSync(env.stateDir, { recursive: true, force: true })
    await new Promise<void>(r => mock.close(() => r()))
  }
})

test('旗 OFF 面：STARDECK_SOURCES=0 → ingest/sources 两端点 404（字节等价纪律）', { timeout: 60_000 }, async () => {
  const env = boot({ STARDECK_SOURCES: '0' })
  try {
    await waitHealth(env.base)
    const ingest = await post(env.base, '/warroom/api/sources/ingest', { source: 'ingest', author: 'x', text: 'y' })
    assert.equal(ingest.status, 404)
    const view = await fetch(`${env.base}/warroom/api/sources`)
    assert.equal(view.status, 404)
    // 板照常（读投影不受旗影响）。
    assert.equal((await fetch(`${env.base}/warroom/api/board`)).status, 200)
  } finally {
    await env.close()
    rmSync(env.stateDir, { recursive: true, force: true })
  }
})
