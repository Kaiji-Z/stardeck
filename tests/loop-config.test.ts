/**
 * D33 段3 · 模型配置窗口后端面：
 * - config.loop 段读写往返（STARDECK_CONFIG 隔离；key 只落本机 config 红线域内）；
 * - mergeLoopEnv 优先级（config > env > 无；硬关旗压一切）；
 * - 真 daemon 端点：GET/POST loop-config + loop-test（假网关本地服）+ /fleet
 *   loopModel/loopKeySource 回读；**GET 回执永不包含 key 本体**。
 * @module stardeck/tests/loop-config
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { readLoopConfig, writeLoopConfig } from '../src/config.ts'
import { mergeLoopEnv } from '../src/proxy-loop.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('loop 配置读写往返：loop 段落本机 config、既有键保留、清除 key=空串', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-loopcfg-'))
  const cfgPath = join(dir, 'config.json')
  writeFileSync(cfgPath, `${JSON.stringify({ executor: 'opencode' })}\n`, 'utf8')
  const prev = process.env.STARDECK_CONFIG
  process.env.STARDECK_CONFIG = cfgPath
  try {
    assert.deepEqual(readLoopConfig(), { model: '', baseUrl: '', apiKey: '' }, '无 loop 段=空配置')
    const w1 = writeLoopConfig({ model: 'glm-5.3-flash', baseUrl: 'https://api.x/', apiKey: 'sk-t1' })
    assert.equal(w1.ok, true)
    assert.deepEqual(readLoopConfig(), { model: 'glm-5.3-flash', baseUrl: 'https://api.x/', apiKey: 'sk-t1' })
    const fileBody = JSON.parse(readFileSync(cfgPath, 'utf8')) as { executor?: string; loop?: unknown }
    assert.equal(fileBody.executor, 'opencode', '既有键原样保留')
    assert.ok(fileBody.loop !== undefined, 'loop 段在场')
    const w2 = writeLoopConfig({ apiKey: '' }) // 清除
    assert.equal(w2.ok, true)
    assert.equal(readLoopConfig().apiKey, '', '空串=清除 key')
    assert.equal(readLoopConfig().model, 'glm-5.3-flash', '未 patch 的键不动')
  } finally {
    if (prev === undefined) delete process.env.STARDECK_CONFIG
    else process.env.STARDECK_CONFIG = prev
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('mergeLoopEnv 优先级：config > env；env 回落；硬关旗压一切', () => {
  const env = { Z_AI_BASE_URL: 'https://env.base', Z_AI_API_KEY: 'env-key' }
  const merged = mergeLoopEnv(env, { model: 'cfg-model', baseUrl: 'https://cfg.base', apiKey: 'cfg-key' })
  assert.equal(merged.enabled, true)
  assert.equal(merged.baseUrl, 'https://cfg.base', 'config 基址优先')
  assert.equal(merged.apiKey, 'cfg-key', 'config key 优先')
  assert.equal(merged.model, 'cfg-model')
  const fallback = mergeLoopEnv(env, { model: '', baseUrl: '', apiKey: '' })
  assert.equal(fallback.baseUrl, 'https://env.base', '空 config=env 回落')
  assert.equal(fallback.model, 'glm-5.3', '模型缺省')
  const hardOff = mergeLoopEnv({ ...env, STARDECK_PROXY_LOOP: '0' }, { model: '', baseUrl: 'https://cfg.base', apiKey: 'cfg-key' })
  assert.equal(hardOff.enabled, false, '硬关旗压 config')
})

test('真 daemon：loop-config 三端点 + /fleet 回读 + key 永不出线', { timeout: 90_000 }, async () => {
  // 假网关：/models 探测面（200 {data:[]}）
  const gate = createServer((req, res) => {
    if (req.url === '/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }
    res.writeHead(404); res.end()
  })
  await new Promise<void>(r => gate.listen(0, '127.0.0.1', r))
  const gatePort = (gate.address() as { port: number }).port

  const stateDir = mkdtempSync(join(tmpdir(), 'sd-loopd-'))
  const port = 41290 + (process.pid % 50)
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STAFF: '0', STARDECK_PROXY_LOOP_MODEL: 'glm-5.3-flash' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let errDump = ''
  daemon.stderr?.on('data', d => { errDump += String(d) })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${base}/warroom/api/healthz`)).ok) break } catch { /* not up */ }
      await new Promise(r => setTimeout(r, 400))
    }
    // 初态：env 相位（本测试 env 无 Z_AI_* → none/缺省模型）
    const g0 = await fetch(`${base}/warroom/api/loop-config`).then(r => r.json()) as { model: string; baseUrl: string; keySource: string }
    assert.equal(g0.keySource, 'none', '无 key=none')
    assert.equal(g0.model, 'glm-5.3-flash', 'env 模型（STARDECK_PROXY_LOOP_MODEL）')
    // POST：存 key+模型+假网关基址 → config 相位
    const p1 = await fetch(`${base}/warroom/api/loop-config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-5.3-highspeed', baseUrl: `http://127.0.0.1:${gatePort}`, apiKey: 'sk-loop-test' }) }).then(r => r.json()) as { saved: { ok: boolean; keySource: string; error?: string } }
    assert.equal(p1.saved.ok, true, `save ok（${p1.saved.error ?? ''}）`)
    assert.equal(p1.saved.keySource, 'config', '存 key 后来源=config')
    // GET 回读：模型/基址生效；**回执无 key 本体**
    const g1 = await fetch(`${base}/warroom/api/loop-config`).then(r => r.json()) as Record<string, unknown>
    assert.equal(g1.model, 'glm-5.3-highspeed')
    assert.equal(g1.baseUrl, `http://127.0.0.1:${gatePort}`)
    assert.ok(!JSON.stringify(g1).includes('sk-loop-test'), 'key 本体永不出线')
    // /fleet 回读
    const f1 = await fetch(`${base}/warroom/api/fleet`).then(r => r.json()) as { loopModel?: string; loopKeySource?: string }
    assert.equal(f1.loopModel, 'glm-5.3-highspeed', '/fleet loopModel 回读一致')
    assert.equal(f1.loopKeySource, 'config', '/fleet loopKeySource=config')
    // loop-test：假网关 200 → ok+延迟
    const t1 = await fetch(`${base}/warroom/api/loop-test`, { method: 'POST' }).then(r => r.json()) as { probe: { ok: boolean; latencyMs?: number; error?: string } }
    assert.equal(t1.probe.ok, true, `测试连接过（${t1.probe.error ?? `${t1.probe.latencyMs}ms`}）`)
    assert.ok(typeof t1.probe.latencyMs === 'number')
    // config.json 落盘核验（key 在本机 config 域内）
    const disk = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')) as { loop?: { apiKey?: string } }
    assert.equal(disk.loop?.apiKey, 'sk-loop-test', 'key 只落本机 config')
  } catch (err) {
    console.error('DAEMON_STDERR_DUMP:', errDump.slice(-1500))
    throw err
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 400))
    gate.close()
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5 })
  }
})
