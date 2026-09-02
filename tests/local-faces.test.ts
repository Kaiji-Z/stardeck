/**
 * P1-7 host-sessions/host-workspaces 独立形态派生（2026-09-02 脱离宿主九件）：
 * 真 daemon（无宿主面）——GET host-sessions 200 且含 attach-map 键（V17 归档
 * 核查复活）；host-workspaces 200 且列 war_root 目录。
 * @module stardeck/tests/local-faces
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('独立派生：host-sessions 含 attach-map 会话号 + host-workspaces 列 war_root', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-localfaces-'))
  const stateDir = join(dir, 'state')
  const warRoot = join(stateDir, 'tasks')
  mkdirSync(join(warRoot, '20260902-ws1'), { recursive: true })
  mkdirSync(join(warRoot, '20260902-ws2'), { recursive: true })
  writeFileSync(join(stateDir, 'attach-map.json'), JSON.stringify({
    '20260902-ws1': { executor: 'opencode', sessionId: 'ses_localface1', workspacePath: join(warRoot, '20260902-ws1'), capturedAt: new Date().toISOString() },
    'staff-old': { executor: 'zcode', sessionId: 'sess_localface2', workspacePath: join(stateDir, 'staff'), capturedAt: new Date().toISOString() },
  }), 'utf8')
  const port = 41090 + (process.pid % 50)
  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) break
      if (i === 59) assert.fail('daemon 未就绪')
    }
    const sessions = await fetch(`${base}/warroom/api/host-sessions`).then(r => r.json() as Promise<{ ok?: boolean; sessions?: string[] }>)
    assert.equal(sessions.ok, true, '独立形态不再 501')
    assert.ok(sessions.sessions?.includes('ses_localface1'), 'attach-map 会话号在场：' + JSON.stringify(sessions.sessions))
    assert.ok(sessions.sessions?.includes('sess_localface2'))
    // host-workspaces 在独立形态保持缺席（501 语义）——HQ 弹窗手动注册区正解：
    // war_root 扫描派生会顶掉手动区（内部任务目录≠用户工作区，2026-09-02 用户实抓后撤）。
    const wsRes = await fetch(`${base}/warroom/api/host-workspaces`)
    const wsBody = await wsRes.json() as { ok?: boolean }
    assert.equal(wsBody.ok, false, '独立形态不派生工作区清单——HQ 手动注册区回归')
  } finally {
    daemon.kill()
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* 句柄慢放 */ }
  }
})
