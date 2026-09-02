/**
 * P1-6 attach-map backfill（2026-09-02 脱离宿主九件）：
 * - sessionIdFromLog 三席模式判型（纯）；
 * - backfillPlan：种子日志反查——staff 键（staff-<id>.log）+ 任务键
 *   （executor-oc-<taskId>-*.log），只出缺失键；
 * - backfillAttachMap 只补不覆盖（既有映射原样）；
 * - 真 daemon 启动集成：种子老日志起服 → /attach/entries 对老键返回非 null。
 * @module stardeck/tests/backfill
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { sessionIdFromLog, backfillPlan, backfillAttachMap } from '../src/backfill.ts'
import { readAttachMap } from '../src/executor.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function rm(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* 句柄慢放 */ }
}

test('backfill：日志会话号三席判型（纯）', () => {
  assert.deepEqual(sessionIdFromLog('{"sessionID":"ses_abc123"}'), { sessionId: 'ses_abc123', executor: 'opencode' })
  assert.deepEqual(sessionIdFromLog('{"sessionId":"sess_8e51c269-b9f2-4758-8083-835bb6804318"}'), { sessionId: 'sess_8e51c269-b9f2-4758-8083-835bb6804318', executor: 'zcode' })
  assert.deepEqual(sessionIdFromLog('{"session_id":"8e51c269-b9f2-4758-8083-835bb6804318"}'), { sessionId: '8e51c269-b9f2-4758-8083-835bb6804318', executor: 'claude' })
  assert.equal(sessionIdFromLog('没有任何会话号的日志'), null)
})

test('backfill：staff 键 + 任务键反查，只出缺失键；补齐不覆盖既有', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-backfill-'))
  try {
    const stateDir = join(dir, 'state')
    mkdirSync(join(stateDir, 'logs'), { recursive: true })
    mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
    const now = new Date().toISOString()
    // 种子：talking 命令（staff 键）+ 已发布任务（taskId 键）+ 各自老日志。
    writeFileSync(join(stateDir, 'directives.jsonl'), [
      JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-b', text: '老命令' }),
      JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-b', staffSessionId: 'staff-old1' }),
      JSON.stringify({ type: 'directive_talking', ts: now, directiveId: 'cmd-b' }),
    ].join('\n') + '\n', 'utf8')
    writeFileSync(join(stateDir, 'campaigns', '20260902-oldtask.jsonl'), [
      JSON.stringify({ type: 'task_created', ts: now, campaignId: '20260902-oldtask', title: '老任务', brief: '做', acceptance: '过', priority: 'normal', quality: 'standard' }),
      JSON.stringify({ type: 'task_published', ts: now, campaignId: '20260902-oldtask', workspacePath: join(dir, 'ws-oldtask') }),
    ].join('\n') + '\n', 'utf8')
    writeFileSync(join(stateDir, 'logs', 'staff-staff-old1.log'), '{"type":"step_start","sessionID":"ses_oldstaff999"}\n', 'utf8')
    writeFileSync(join(stateDir, 'logs', 'executor-oc-20260902-oldtask-zzz123.log'), '{"sessionId":"sess_aa11bb22-cc33-dd44-ee55-ff6677889900"}\n', 'utf8')
    const plan = backfillPlan(stateDir)
    const keys = plan.map(p => p.key).sort()
    assert.deepEqual(keys, ['20260902-oldtask', 'staff-old1'], '两键都在计划里')
    const staffHit = plan.find(p => p.key === 'staff-old1')!
    assert.equal(staffHit.executor, 'opencode')
    assert.equal(staffHit.sessionId, 'ses_oldstaff999')
    assert.equal(staffHit.workspacePath, join(stateDir, 'staff'), 'staff 工位=stateDir/staff')
    // 执行补齐 + 不覆盖：预置一个既有键，补齐后原样。
    writeFileSync(join(stateDir, 'attach-map.json'), JSON.stringify({
      'staff-old1': { executor: 'pi', sessionId: 'sess-existing', workspacePath: '/keep', capturedAt: now },
    }), 'utf8')
    const plan2 = backfillPlan(stateDir)
    assert.ok(!plan2.some(p => p.key === 'staff-old1'), '既有键不再进计划')
    const done = backfillAttachMap(stateDir)
    assert.equal(done.added, plan2.length)
    const map = readAttachMap(stateDir)
    assert.equal(map['staff-old1']?.sessionId, 'sess-existing', '既有映射不被覆盖')
    assert.equal(map['20260902-oldtask']?.executor, 'zcode', '任务键补齐（zcode 判型）')
  } finally {
    rm(dir)
  }
})

test('backfill：真 daemon 启动集成——老键经启动补齐后 /attach/entries 非 null', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-backfill-live-'))
  const stateDir = join(dir, 'state')
  mkdirSync(join(stateDir, 'logs'), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(join(stateDir, 'directives.jsonl'), [
    JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-c', text: '又一条老命令' }),
    JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-c', staffSessionId: 'staff-mtjpzz' }),
    JSON.stringify({ type: 'directive_talking', ts: now, directiveId: 'cmd-c' }),
  ].join('\n') + '\n', 'utf8')
  writeFileSync(join(stateDir, 'logs', 'staff-staff-mtjpzz.log'), '{"type":"step_start","sessionID":"ses_backfilled1"}\n', 'utf8')
  const port = 40970 + (process.pid % 50)
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
    const entries = await fetch(`${base}/warroom/api/attach/entries`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskIds: ['staff-mtjpzz'] }),
    }).then(r => r.json() as Promise<{ ok?: boolean; entries?: Record<string, { executor?: string; sessionId?: string } | null> }>)
    assert.equal(entries.ok, true)
    const hit = entries.entries?.['staff-mtjpzz']
    assert.ok(hit !== null && hit !== undefined, '老键已补（backfill 启动钩子生效）')
    assert.equal(hit?.executor, 'opencode')
    assert.equal(hit?.sessionId, 'ses_backfilled1')
  } finally {
    daemon.kill()
    rm(dir)
  }
})

test('P2-9：opencode 库候选优先序（XDG 先于 macOS Library；纯）', async () => {
  const { opencodeDbCandidates } = await import('../src/history.ts')
  const c = opencodeDbCandidates('/home/x')
  assert.equal(c[0], join('/home/x', '.local', 'share', 'opencode', 'opencode.db'), 'XDG 位第一（Linux/Windows 实证）')
  assert.equal(c[1], join('/home/x', 'Library', 'Application Support', 'opencode', 'opencode.db'), 'macOS 位第二')
  assert.equal(c.length, 2)
})
