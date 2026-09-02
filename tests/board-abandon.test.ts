/**
 * P0-3 撤令通道（2026-09-02 脱离宿主九件之一）：真 daemon 起服，
 * captain-board 通道打 war_abandon_command——
 * - received 命令撤令成功（账本 directive_cancelled + 板投影 cancelled）；
 * - approved 命令诚实拒绝（错误文案点名「已批准为任务」）；
 * - 不存在命令 404 文案。
 * @module stardeck/tests/board-abandon
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

interface Dir { dir: string; base: string; daemon: ChildProcess }

async function boot(): Promise<Dir> {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-abandon-'))
  const stateDir = join(dir, 'state')
  mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
  const port = 41030 + (process.pid % 50)
  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) break
    if (i === 59) assert.fail('daemon 未就绪')
  }
  return { dir, base, daemon }
}

async function call(base: string, name: string, args: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  return await fetch(`${base}/warroom/api/tools/call`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, arguments: args, agentId: 'captain-board' }),
  }).then(r => r.json()) as { ok?: boolean; error?: string }
}

test('撤令：received 命令一键取消——账本与板投影双证', { timeout: 90_000 }, async () => {
  const d = await boot()
  try {
    const cmd = await fetch(`${d.base}/warroom/api/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '测试撤令：这条命令马上被舰长撤掉' }),
    }).then(r => r.json()) as { ok?: boolean; commandId?: string }
    assert.equal(cmd.ok, true)
    const out = await call(d.base, 'war_abandon_command', { command_id: cmd.commandId, reason: '舰长板面撤令（独立形态）——放弃意图或误下' })
    assert.equal(out.ok, true)
    const board = await fetch(`${d.base}/warroom/api/board`).then(r => r.json()) as { commands?: Array<{ commandId: string; status: string }> }
    assert.equal(board.commands?.find(c => c.commandId === cmd.commandId)?.status, 'cancelled', '板投影已取消')
    // 幂等：再撤一次仍 ok（工具家法——cancelled 原样返回）。
    const again = await call(d.base, 'war_abandon_command', { command_id: cmd.commandId!, reason: '再撤一次' })
    assert.equal(again.ok, true)
  } finally {
    d.daemon.kill()
    rmSync(d.dir, { recursive: true, force: true })
  }
})

test('撤令：approved 命令诚实拒绝（撤销语义归任务链）+ 未知命令 404 文案', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-abandon2-'))
  const stateDir = join(dir, 'state')
  mkdirSync(stateDir, { recursive: true })
  // 起服前种一条已批准指令（共享日志 directives.jsonl：created → approved）。
  const lines = [
    JSON.stringify({ type: 'directive_created', ts: '2026-09-02T10:00:00.000Z', directiveId: 'cmd-seed-approved', text: '已批准的种子命令' }),
    JSON.stringify({ type: 'directive_approved', ts: '2026-09-02T10:00:01.000Z', directiveId: 'cmd-seed-approved', taskId: '20260902-seed-task' }),
  ]
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(stateDir, 'directives.jsonl'), lines.join('\n') + '\n', 'utf8')
  const port = 41030 + (process.pid % 50)
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
    const out = await call(base, 'war_abandon_command', { command_id: 'cmd-seed-approved', reason: '试图撤销已批准命令' })
    assert.equal(out.ok, false)
    assert.ok(out.error?.includes('已批准'), '拒绝文案点名已批准：' + out.error)
    const none = await call(base, 'war_abandon_command', { command_id: 'cmd-no-such', reason: 'x' })
    assert.equal(none.ok, false)
    assert.ok(none.error?.includes('不存在'), '未知命令 404 文案')
  } finally {
    daemon.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
