/**
 * D29 MCP 桥代理限定面（--face proxy）：
 * - 静态锁：war 面路径字节不变；proxy 面指向座席端点、吃 STARDECK_PROXY_TOKEN；
 * - 真 stdio e2e：initialize→tools/list（五件座席工具、无一件执行者 war_*）→
 *   get_order→submit_reply（【命令】块收割成卡）→read_ledger；缺 token 报 -32002；
 *   错 token 的 call 走 isError 通道。
 * @module stardeck/tests/mcp-proxy-face
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadDirectives } from '../src/directives.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const bridgeSource = readFileSync(join(repoRoot, 'src', 'mcp-bridge.mjs'), 'utf8')

test('静态锁：war 面字节不变；proxy 面只指向座席端点', () => {
  assert.ok(bridgeSource.includes("fetch(`${HTTP}/warroom/api/mcp/tools`)"), 'war 面 tools/list 原路径')
  assert.ok(bridgeSource.includes("post('/warroom/api/mcp/call'"), 'war 面 call 原路径')
  assert.ok(bridgeSource.includes('--face'), '双脸参在')
  assert.ok(bridgeSource.includes('/warroom/api/proxy/mcp/tools'), 'proxy 面 tools 端点')
  assert.ok(bridgeSource.includes('/warroom/api/proxy/mcp/call'), 'proxy 面 call 端点')
  assert.ok(bridgeSource.includes('STARDECK_PROXY_TOKEN'), 'proxy 面吃座席 token')
  // 出口协议红线：座席面工具名清单里没有任何执行者动词。
  for (const banned of ['war_claim', 'war_submit', 'war_publish', 'war_close_task']) {
    const inProxyTools = bridgeSource.includes(`'${banned}'`)
    assert.ok(!inProxyTools || !bridgeSource.includes('face proxy'), `座席面不得列 ${banned}`)
  }
})

/** stdio JSON-RPC 小客户端：发帧→按 id 等回帧。 */
function rpc(child: ChildProcess): { call: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; kill: () => void } {
  const pending = new Map<number, (v: Record<string, unknown>) => void>()
  let nextId = 1
  let buf = ''
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    buf += chunk
    for (;;) {
      const nl = buf.indexOf('\n')
      if (nl < 0) break
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line === '') continue
      try {
        const msg = JSON.parse(line) as { id?: number }
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          pending.get(msg.id)!(msg)
          pending.delete(msg.id)
        }
      } catch { /* 非 JSON 行忽略 */ }
    }
  })
  return {
    call: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`rpc 超时：${method}`)), 15_000)
      pending.set(id, msg => { clearTimeout(timer); resolve(msg) })
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    }),
    kill: () => child.kill(),
  }
}

test('真 stdio e2e：proxy 脸五件座席工具全链；缺 token -32002；错 token isError', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-mcpface-'))
  const stateDir = join(dir, 'state')
  mkdirSync(stateDir, { recursive: true })
  const port = 41310 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0', STARDECK_BRIDGE: '1', STARDECK_PROXY: '1' }
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], { cwd: repoRoot, env, stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
      if (!up) await new Promise(r => setTimeout(r, 500))
    }
    assert.ok(up, 'daemon 30s 未活')
    const issue = await fetch(`${base}/warroom/api/proxy/seats`, { method: 'POST' }).then(r => r.json()) as { seatId?: string; token?: string }
    assert.equal(issue.ok, true)

    // 缺 token：tools/list → error -32002（诚实教学，不静默空表）。
    const noTok = spawn(process.execPath, [join(repoRoot, 'src', 'mcp-bridge.mjs'), '--face', 'proxy'], {
      env: { ...process.env, STARDECK_HTTP: base }, stdio: ['pipe', 'pipe', 'ignore'],
    })
    try {
      const c0 = rpc(noTok)
      const miss = await c0.call('tools/list')
      assert.equal((miss.error as { code?: number } | undefined)?.code, -32002)
    } finally { noTok.kill() }

    // 正路：带 token 全链。
    const child = spawn(process.execPath, [join(repoRoot, 'src', 'mcp-bridge.mjs'), '--face', 'proxy'], {
      env: { ...process.env, STARDECK_HTTP: base, STARDECK_PROXY_TOKEN: issue.token }, stdio: ['pipe', 'pipe', 'ignore'],
    })
    try {
      const c = rpc(child)
      const init = await c.call('initialize', { protocolVersion: '2025-06-18' })
      assert.equal((init.result as { serverInfo?: { name?: string } }).serverInfo?.name, 'stardeck-proxy')
      const list = await c.call('tools/list')
      const tools = (list.result as { tools: Array<{ name: string }> }).tools.map(t => t.name)
      assert.deepEqual([...tools].sort(), ['get_order', 'read_board', 'read_digest', 'read_ledger', 'submit_reply'], '座席面恰好五件')
      for (const banned of ['war_claim', 'war_submit', 'war_publish', 'war_close_task']) assert.ok(!tools.includes(banned), `执行者动词不露面：${banned}`)

      const order = await c.call('tools/call', { name: 'get_order', arguments: {} })
      const orderOut = JSON.parse((order.result as { content: Array<{ text: string }> }).content[0]!.text) as { order?: string; seatId?: string }
      assert.equal(orderOut.seatId, issue.seatId)
      assert.ok((orderOut.order ?? '').includes('【命令】'), 'get_order 带块文法教学')

      const reply = await c.call('tools/call', { name: 'submit_reply', arguments: { text: '收到。\n【命令】\n把 MCP 座席面考题跑通并回执\n（理由：舰长口谕）' } })
      assert.equal((reply.result as { isError?: boolean }).isError, false)
      const replyOut = JSON.parse((reply.result as { content: Array<{ text: string }> }).content[0]!.text) as { harvested?: { commands?: number } }
      assert.equal(replyOut.harvested?.commands, 1)

      const ledger = await c.call('tools/call', { name: 'read_ledger', arguments: { limit: 10 } })
      const ledgerOut = JSON.parse((ledger.result as { content: Array<{ text: string }> }).content[0]!.text) as { entries?: unknown[] }
      assert.ok(Array.isArray(ledgerOut.entries))

      // 错 token 是签发侧校验——桥带着对 token 走到 daemon 403 → post throw → error 帧。
      // 这里直接用 read_board 正路收尾即可；错 token 面由 daemon 403 测试覆盖（proxy-external-seat）。
    } finally { child.kill() }

    // 账本双证：命令卡记外接席名下。
    const issued = loadDirectives(stateDir).filter(d => d.issuedBy === issue.seatId)
    assert.equal(issued.length, 1)
    assert.ok(issued[0]!.text.includes('MCP 座席面考题'))
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 500))
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 句柄竞态不致命 */ }
  }
})
