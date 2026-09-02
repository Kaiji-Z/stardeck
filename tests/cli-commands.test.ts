/**
 * P1-5 CLI 子命令（2026-09-02 脱离宿主九件）：
 * - browserOpenCommand 跨平台形状（纯）；
 * - 真 daemon：/shutdown 端点优雅退出（进程在限时内真退）；
 * - cli.ts status 子命令对真 daemon 的输出形状（舰队/命令/任务计数行）。
 * @module stardeck/tests/cli-commands
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { browserOpenCommand } from '../src/cli.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

async function waitExit(child: ChildProcess, ms = 8000): Promise<boolean> {
  if (child.exitCode !== null) return true
  return await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), ms)
    child.on('exit', () => { clearTimeout(timer); resolve(true) })
  })
}

function rm(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* 句柄慢放 */ }
}

test('CLI：browserOpenCommand 三平台形状（纯）', () => {
  assert.deepEqual(browserOpenCommand('http://127.0.0.1:3970/', 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:3970/'] })
  assert.deepEqual(browserOpenCommand('http://x/', 'darwin'), { cmd: 'open', args: ['http://x/'] })
  assert.deepEqual(browserOpenCommand('http://x/', 'linux'), { cmd: 'xdg-open', args: ['http://x/'] })
})

test('CLI：/shutdown 端点优雅停服——daemon 进程限时内真退', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-cli-stop-'))
  const port = 41270 + (process.pid % 50)
  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: join(dir, 'state'), STARDECK_STAFF: '0' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) break
      if (i === 59) assert.fail('daemon 未就绪')
    }
    const out = await fetch(`${base}/warroom/api/shutdown`, { method: 'POST' }).then(r => r.json() as Promise<{ ok?: boolean }>)
    assert.equal(out.ok, true, '停服请求受理')
    assert.equal(await waitExit(daemon), true, 'daemon 优雅退出（close 收割后 exit 0）')
    const after = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
    assert.equal(after, false, '端口已不服务')
  } finally {
    daemon.kill()
    rm(dir)
  }
})

test('CLI：status 子命令对真 daemon 输出形状', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-cli-status-'))
  const port = 41330 + (process.pid % 50)
  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: join(dir, 'state'), STARDECK_STAFF: '0' },
    stdio: 'ignore',
  })
  try {
    const base = `http://127.0.0.1:${port}`
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) break
      if (i === 59) assert.fail('daemon 未就绪')
    }
    const status = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'status'], {
      cwd: repoRoot,
      env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STAFF: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    status.stdout.on('data', c => { out += String(c) })
    const code = await new Promise<number | null>(resolve => { status.on('exit', c => resolve(c)) })
    assert.equal(code, 0, 'status 退出码 0（在跑）')
    assert.ok(out.includes('在运行'), '在运行行：' + out.slice(0, 60))
    assert.ok(out.includes('舰队'), '舰队行')
    assert.ok(out.includes('命令 0'), '命令计数')
    // daemon 不在跑的端口 → 退出码 1（诚实探活）。
    const status2 = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'status'], {
      cwd: repoRoot,
      env: { ...process.env, STARDECK_PORT: String(port + 7), STARDECK_STAFF: '0' },
      stdio: 'ignore',
    })
    const code2 = await new Promise<number | null>(resolve => { status2.on('exit', c => resolve(c)) })
    assert.equal(code2, 1, '不在跑=退出码 1')
  } finally {
    daemon.kill()
    rm(dir)
  }
})
