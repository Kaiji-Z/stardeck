/**
 * P0-2 舰队绑定落盘（2026-09-02 脱离宿主九件之一）：
 * - persistFleetBinding 纯函数面：合并保留既有键 / 坏 JSON 拒绝覆盖（文件字节不动）；
 * - 真 daemon 重启往返：POST /fleet 绑 pi → 杀进程重启（同 STARDECK_CONFIG）→
 *   GET /fleet 仍报 pi——绑定不再随 daemon 重启回落。
 * @module stardeck/tests/fleet-persist
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { persistFleetBinding } from '../src/config.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function withIsolatedConfig<T>(fn: (cfgPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-fleetpersist-'))
  const prev = process.env.STARDECK_CONFIG
  process.env.STARDECK_CONFIG = join(dir, 'config.json')
  try {
    return fn(process.env.STARDECK_CONFIG)
  } finally {
    if (prev === undefined) delete process.env.STARDECK_CONFIG
    else process.env.STARDECK_CONFIG = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

test('落盘：合并保留既有键，executor+model 写入，重启读面同源', () => {
  withIsolatedConfig(cfgPath => {
    writeFileSync(cfgPath, JSON.stringify({ port: 3991, staff: false, executor: 'opencode' }), 'utf8')
    const out = persistFleetBinding('pi', 'glm-5.2')
    assert.equal(out.ok, true)
    const after = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>
    assert.equal(after.executor, 'pi')
    assert.equal(after.model, 'glm-5.2')
    assert.equal(after.port, 3991, '既有键保留（port 不丢）')
    assert.equal(after.staff, false, '既有键保留（staff 不丢）')
  })
})

test('落盘：坏 JSON 拒绝覆盖——文件字节不动，回执可警示', () => {
  withIsolatedConfig(cfgPath => {
    const garbage = '{broken json！！'
    writeFileSync(cfgPath, garbage, 'utf8')
    const out = persistFleetBinding('pi', '')
    assert.equal(out.ok, false)
    assert.ok(out.error.includes('拒绝覆盖'))
    assert.equal(readFileSync(cfgPath, 'utf8'), garbage, '坏文件原样保留')
  })
})

test('落盘：真 daemon 重启往返——绑定 pi 重启后仍在', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-fleetrestart-'))
  const cfgPath = join(dir, 'config.json')
  const stateDir = join(dir, 'state')
  const port = 40910 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, STARDECK_CONFIG: cfgPath, STARDECK_STATE_DIR: stateDir, STARDECK_PORT: String(port), STARDECK_STAFF: '0' }
  const startDaemon = (): ChildProcess =>
    spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], { cwd: repoRoot, env, stdio: 'ignore' })
  const waitUp = async (): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) return
    }
    assert.fail('daemon 未就绪（60×500ms）')
  }
  const stopDaemon = async (d: ChildProcess): Promise<void> => {
    d.kill()
    await new Promise<void>(resolve => { d.on('exit', () => resolve()); setTimeout(resolve, 3000) })
  }
  try {
    const d1 = startDaemon()
    await waitUp()
    const bind = await fetch(`${base}/warroom/api/fleet`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executor: 'pi', model: '' }),
    }).then(r => r.json()) as { ok?: boolean; warning?: string; active?: { executor?: string } }
    assert.equal(bind.ok, true)
    assert.equal(bind.active?.executor, 'pi')
    assert.equal(bind.warning, undefined, '好配置文件下落盘成功，无警示')
    await stopDaemon(d1)
    // 重启（同 config 同 stateDir）——绑定应从配置文件回来。
    const d2 = startDaemon()
    await waitUp()
    const after = await fetch(`${base}/warroom/api/fleet`).then(r => r.json()) as { active?: { executor?: string; model?: string } }
    assert.equal(after.active?.executor, 'pi', '重启后绑定保持（P0-2 核心）')
    await stopDaemon(d2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
