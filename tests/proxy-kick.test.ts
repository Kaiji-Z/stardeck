/**
 * D36 对抗审查 B 回归钉：bridgeKick（发话即应答）的并发语义。
 * 场景1（防抖吸收连发）：50ms 连发两句——假网关慢流在途窗口内，第二轮 kick
 *   被 proxySpawning 挡+250ms 防抖把两话并进同一轮载荷（chat 请求恰 1 次、
 *   载荷含两句、终答入账 1 条）。
* 场景2（组包锚续跑）：第二句在第一轮组包**之后**到达（防抖窗外）——终答入账
 *   后组包锚（user.ts > packTs）必触发续跑，第二轮载荷携带第二句（chat 恰 2 次）。
 * 无锚时的坑（实弹抓到）：bridgeUnanswered 按「末条=agent」判答，轮中后到的话
 * 被顺带判答=静默吞话。 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// 矩阵 OFF 面（STARDECK_PROXY=0/BRIDGE=0 全套注入）下本文件显式回 ON——本文件
// 测的就是 proxy-ON 面（kick/loop 应答链）；OFF 面的 404 纪律由
// proxy-external-seat.test.ts 显式子进程钉死（connect.test.ts 同款家法）。
process.env.STARDECK_PROXY = '1'
process.env.STARDECK_BRIDGE = '1'

/** 慢流假网关：记录每个请求体，延迟 streamMs 后一次性吐终答。ready 等 listen 完成。 */
function slowGate(streamMs: number): { server: Server; ready: Promise<number>; bodies: () => string[] } {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      if (req.url !== '/chat/completions') { res.writeHead(404); res.end(); return }
      bodies.push(raw)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '收到，一并答。' }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, streamMs)
    })
  })
  const ready = new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
  return { server, ready, bodies: () => bodies }
}

async function withDaemon(gatePort: number, fn: (base: string, stateDir: string) => Promise<void>): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-kick-'))
  const port = 41310 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STATE_DIR: stateDir, STARDECK_WAR_ROOT: join(stateDir, 'tasks'), STARDECK_PORT: String(port), STARDECK_STAFF: '0', Z_AI_API_KEY: 'sk-fake', Z_AI_BASE_URL: `http://127.0.0.1:${gatePort}`, STARDECK_PROXY_LOOP_MODEL: 'fake-m' },
    stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  })
  try {
    for (let i = 0; ; i++) {
      try { const r = await fetch(`${base}/warroom/api/healthz`); if (r.ok) break } catch { /* not up */ }
      if (i > 60) throw new Error('kick 测试 daemon 30s 未活')
      await new Promise(r => setTimeout(r, 500))
    }
    await fn(base, stateDir)
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 400))
    try { rmSync(stateDir, { recursive: true, force: true }) } catch { /* 句柄 */ }
  }
}

async function agentCount(stateDir: string): Promise<number> {
  try {
    return readFileSync(join(stateDir, 'bridge.jsonl'), 'utf8').split(/\r?\n/).filter(l => l.includes('bridge_agent_message')).length
  } catch { return 0 }
}

test('对抗 B1：连发两句——防抖并进同一轮（chat 恰 1 次、载荷双句、无重入）', { timeout: 60_000 }, async () => {
  const gate = slowGate(600)
  try {
    const { ready, bodies } = gate
    await withDaemon(await ready, async (base) => {
      for (const text of ['第一句：报个总况', '第二句：顺手把命令也立了']) {
        await fetch(`${base}/warroom/api/bridge/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
        await new Promise(r => setTimeout(r, 50))
      }
      // 等 6s：一轮慢流 600ms+入账；再宽限 3s——若并发重入，第二轮 chat 会在此现形。
      await new Promise(r => setTimeout(r, 6000))
      assert.equal(bodies().length, 1, `chat 请求恰 1 次（实际 ${bodies().length}——>1=重入/双跑）`)
      assert.ok(bodies()[0]!.includes('第一句') && bodies()[0]!.includes('第二句'), '单轮载荷含两句（防抖吸收连发）')
    })
  } finally { gate.server.close() }
})

test('对抗 B2：第二句轮中后到——组包锚续跑补轮（chat 恰 2 次、第二轮载荷含第二句）', { timeout: 90_000 }, async () => {
  const gate = slowGate(900)
  try {
    const { ready, bodies } = gate
    await withDaemon(await ready, async (base, stateDir) => {
      const send = async (text: string): Promise<void> => { await fetch(`${base}/warroom/api/bridge/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }) }
      await send('甲：先看速览')
      // 防抖 250ms 已过、第一轮已组包在途（900ms 慢流）——600ms 处发第二句=轮中后到。
      await new Promise(r => setTimeout(r, 600))
      await send('乙：这条是轮中后到的')
      let agents = 0
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 500))
        agents = await agentCount(stateDir)
        if (agents >= 2) break
      }
      assert.equal(agents, 2, `两轮终答都入账（实际 ${agents}——<2=组包锚失灵/静默吞话）`)
      assert.equal(bodies().length, 2, `chat 恰 2 次（实际 ${bodies().length}）`)
      assert.ok(bodies()[1]!.includes('乙'), `第二轮载荷含后到话：${(bodies()[1] ?? '').slice(0, 80)}…`)
    })
  } finally { gate.server.close() }
})
