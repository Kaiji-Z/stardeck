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
    // P1 修（critique A 八轮）回归：body 覆盖=测所见不测已存——坏基址覆盖探活必败，
    // 且不落盘（config.json 基址不被覆盖值污染）。
    const t2 = await fetch(`${base}/warroom/api/loop-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'http://127.0.0.1:1' }) }).then(r => r.json()) as { probe: { ok: boolean; error?: string } }
    assert.equal(t2.probe.ok, false, '覆盖坏基址=诚实报败')
    const diskPre = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')) as { loop?: { apiKey?: string } }
    assert.equal(diskPre.loop?.apiKey, 'sk-loop-test', 'key 只落本机 config')
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


test('writeLoopConfig 坏 JSON 拒绝覆盖；readLoopConfig 坏 JSON=空配置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-loopbad-'))
  const cfgPath = join(dir, 'config.json')
  writeFileSync(cfgPath, '{oops', 'utf8')
  const prev = process.env.STARDECK_CONFIG
  process.env.STARDECK_CONFIG = cfgPath
  try {
    assert.equal(readLoopConfig().model, '', '读侧坏 JSON=空配置不炸')
    const w = writeLoopConfig({ model: 'x' })
    assert.equal(w.ok, false, '写侧坏 JSON 拒绝覆盖')
    assert.equal(readFileSync(cfgPath, 'utf8'), '{oops', '原文件字节不动')
  } finally {
    if (prev === undefined) delete process.env.STARDECK_CONFIG
    else process.env.STARDECK_CONFIG = prev
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('mergeLoopEnv 边界：全空不开；仅 model 不开；config key+env 其余=混供给', () => {
  assert.equal(mergeLoopEnv({}, { model: 'm', baseUrl: '', apiKey: '' }).enabled, false, '无 key 不开（旗也救不了）')
  const mixed = mergeLoopEnv({ Z_AI_BASE_URL: 'https://env.base', Z_AI_API_KEY: 'env-key' }, { model: 'cfg-m', baseUrl: '', apiKey: 'cfg-key' })
  assert.equal(mixed.baseUrl, 'https://env.base', '基址回落 env')
  assert.equal(mixed.apiKey, 'cfg-key', 'key 用 config')
  assert.equal(mixed.model, 'cfg-m', '模型用 config')
})

test('mergeLoopEnv 尾斜杠剥除（config 侧基址）', () => {
  const m = mergeLoopEnv({}, { model: '', baseUrl: 'https://x/', apiKey: 'k' })
  assert.equal(m.baseUrl, 'https://x')
})

test('端点缺席面：deps.loopConfig 未注入 → loop-config 路由 404（纯路由语义）', async () => {
  const gate = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
  await new Promise<void>(r => gate.listen(0, '127.0.0.1', r))
  gate.close()
  // 纯路由测：registerDashboard 缺 loopConfig 时三端点直落 404——用真 daemon 起
  // 一个「无 loopConfig deps」形态不可行（daemon 恒注入）；改为直接调 handler 的
  // 单元面：注册到假 registry 捕获 handler，喂假 req/res 断言 404 语义。
  const { registerDashboard } = await import('../src/dashboard.ts')
  let captured: ((req: unknown, res: unknown) => Promise<void>) | undefined
  const fakeReq = (method: string, path: string): unknown => ({ method, url: path, on: () => {}, socket: {} })
  const resWrites: number[] = []
  const fakeRes = (): unknown => ({ statusCode: 0, setHeader: () => {}, end: () => { resWrites.push(1) }, writeHead(c: number) { this.statusCode = c } })
  registerDashboard({ register(route) { captured = route.handler as typeof captured; return () => {} } }, {
    store: { get: () => ({ active: false, hqSessionId: null }), subscribe: () => () => {} },
    stateDir: mkdtempSync(join(tmpdir(), 'sd-routes-')),
    warRoot: '/tmp/w', roster: () => ({ units: [], errors: [] }),
  } as never)
  assert.ok(captured !== undefined, 'handler 捕获')
  const r1 = fakeRes()
  await captured!(fakeReq('GET', '/warroom/api/loop-config'), r1)
  assert.equal((r1 as { statusCode: number }).statusCode, 404, 'loopConfig 缺席 → 404（不 500 不炸）')
  assert.equal(resWrites.length, 1, '恰一次写')
})


test('端点细节甲：未配 key 的 loop-test 诚实报错 + /fleet 初相（env 模型/none 来源）+ baseUrl 尾斜杠剥除', { timeout: 90_000 }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-loopd2-'))
  const port = 41310 + (process.pid % 50)
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STAFF: '0', STARDECK_PROXY_LOOP_MODEL: 'glm-5.3-air' },
    stdio: 'ignore', windowsHide: true,
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${base}/warroom/api/healthz`)).ok) break } catch { /* not up */ }
      await new Promise(r => setTimeout(r, 400))
    }
    const t0 = await fetch(`${base}/warroom/api/loop-test`, { method: 'POST' }).then(r => r.json()) as { probe: { ok: boolean; error?: string } }
    assert.equal(t0.probe.ok, false)
    assert.ok((t0.probe.error ?? '').includes('未配 key'), `诚实错误句：${t0.probe.error}`)
    const f0 = await fetch(`${base}/warroom/api/fleet`).then(r => r.json()) as { loopModel?: string; loopKeySource?: string }
    assert.equal(f0.loopModel, 'glm-5.3-air', '/fleet 初相=env 模型')
    assert.equal(f0.loopKeySource, 'none')
    await fetch(`${base}/warroom/api/loop-config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'http://127.0.0.1:9///' }) })
    const g = await fetch(`${base}/warroom/api/loop-config`).then(r => r.json()) as { baseUrl: string }
    assert.equal(g.baseUrl, 'http://127.0.0.1:9', '端点侧尾斜杠剥除')
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 400))
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('端点细节乙：apiKey trim 入盘 + 清除（空串）后来源回 none', { timeout: 90_000 }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'sd-loopd3-'))
  const port = 41330 + (process.pid % 50)
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STAFF: '0' },
    stdio: 'ignore', windowsHide: true,
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${base}/warroom/api/healthz`)).ok) break } catch { /* not up */ }
      await new Promise(r => setTimeout(r, 400))
    }
    await fetch(`${base}/warroom/api/loop-config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '  sk-trim-me  ' }) })
    const disk = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')) as { loop?: { apiKey?: string } }
    assert.equal(disk.loop?.apiKey, 'sk-trim-me', 'key 入盘前 trim')
    const clear = await fetch(`${base}/warroom/api/loop-config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) }).then(r => r.json()) as { saved: { keySource: string } }
    assert.equal(clear.saved.keySource, 'none', '清除后来源回 none')
    const disk2 = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8')) as { loop?: { apiKey?: string } }
    assert.equal(disk2.loop?.apiKey, '', '盘上 key 已清（空串）')
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 400))
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('纯分支三件：env+cfg 双 key 时硬关仍禁；STARDECK_CONFIG 缺席文件读空；部分 patch 不动其余键', () => {
  assert.equal(mergeLoopEnv({ Z_AI_API_KEY: 'e', STARDECK_PROXY_LOOP: '0' }, { model: '', baseUrl: '', apiKey: 'c' }).enabled, false)
  const prev = process.env.STARDECK_CONFIG
  process.env.STARDECK_CONFIG = join(mkdtempSync(join(tmpdir(), 'sd-nofile-')), 'absent.json')
  try {
    assert.deepEqual(readLoopConfig(), { model: '', baseUrl: '', apiKey: '' }, '文件缺席=空配置')
    writeLoopConfig({ model: 'only-model' })
    writeLoopConfig({ baseUrl: 'https://b' })
    const l = readLoopConfig()
    assert.equal(l.model, 'only-model', '第二次 patch 不动 model')
    assert.equal(l.baseUrl, 'https://b')
  } finally {
    if (prev === undefined) delete process.env.STARDECK_CONFIG
    else process.env.STARDECK_CONFIG = prev
  }
})
