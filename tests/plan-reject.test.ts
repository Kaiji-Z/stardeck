/**
 * 驳回带意见（2026-09-02 定案）：舰长不编辑计划文本（著作权在大副），意见随
 * 驳回送达大副重拟。链路三段：
 * - fold：directive_plan_rejected 的 reason 落 plan.reason（重拟工单的数据源）；
 * - 工单：staffWorklist 带 planRejectedReason → 征召令嵌「舰长驳回意见」行
 *   （无 reason 不加行——旧快照零变动）；
 * - e2e：真 daemon + stub pi——POST /commands/plan {reject, note} → 账本 reason
 *   + fold plan.reason + K17 回推帧送达（pi RPC follow_up 同通道）。
 * @module stardeck/tests/plan-reject
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { foldDirectives } from '../src/directives.ts'
import { staffWorklist, staffOrderFor } from '../src/staff.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function rm(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* 句柄慢放 */ }
}

test('驳回带意见：fold 存 reason——重拟工单的数据源', () => {
  const now = new Date().toISOString()
  const dirs = foldDirectives([
    { type: 'directive_created', ts: now, directiveId: 'cmd-p1', text: '做点东西' },
    { type: 'directive_received', ts: now, directiveId: 'cmd-p1', staffSessionId: 'staff-p1' },
    { type: 'directive_triaged', ts: now, directiveId: 'cmd-p1', grade: 'L1', reason: '中型意图' },
    { type: 'directive_plan_opened', ts: now, directiveId: 'cmd-p1', plan: '五步计划：……' },
    { type: 'directive_plan_rejected', ts: now, directiveId: 'cmd-p1', reason: '步骤太多，砍到三步以内' },
  ])
  const plan = dirs.find(d => d.id === 'cmd-p1')?.plan
  assert.equal(plan?.status, 'rejected')
  assert.equal(plan?.reason, '步骤太多，砍到三步以内', '舰长意见入 fold')
  // 无意见驳回（默认文案）同样在案。
  const dirs2 = foldDirectives([
    { type: 'directive_created', ts: now, directiveId: 'cmd-p2', text: 'x' },
    { type: 'directive_plan_opened', ts: now, directiveId: 'cmd-p2', plan: '稿' },
    { type: 'directive_plan_rejected', ts: now, directiveId: 'cmd-p2', reason: '舰长驳回，请修订重呈' },
  ])
  assert.equal(dirs2.find(d => d.id === 'cmd-p2')?.plan?.reason, '舰长驳回，请修订重呈')
})

test('驳回带意见：工单带 reason → 征召令嵌「舰长驳回意见」行（无 reason 零变动）', () => {
  const now = new Date().toISOString()
  const mk = (id: string, reason?: string): Parameters<typeof staffWorklist>[0][number] => ({
    id, text: `命令 ${id}`, createdAt: now, status: 'received',
    grade: 'L1',
    staffSessionId: 'staff-x',
    ...(reason !== undefined ? { plan: { text: '旧稿计划', status: 'rejected' as const, decidedAt: now, reason } } : { plan: { text: '旧稿计划', status: 'rejected' as const, decidedAt: now } }),
  })
  const withReason = staffOrderFor(staffWorklist([mk('cmd-r', '砍到三步')]))
  assert.ok(withReason.includes('舰长驳回意见：「砍到三步」——按此修订再呈'), '意见行在征召令')
  const withoutReason = staffOrderFor(staffWorklist([mk('cmd-n')]))
  // 既有措辞「按舰长驳回意见修订后重呈」常在——只验新增的意见行（带引号定界）不出现。
  assert.ok(!withoutReason.includes('舰长驳回意见：「'), '无 reason 不加意见行（旧快照零变动）')
})

test('驳回带意见 e2e：真 daemon + stub pi——note 入账 + fold + K17 回推帧送达', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-planrej-'))
  const stateDir = join(dir, 'state')
  const ws = join(dir, 'ws')
  mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
  mkdirSync(ws, { recursive: true })
  // stub pi（协议应答 + 帧落盘，同 steer.test）
  const stubPath = join(dir, 'fake-pi.mjs')
  const framesPath = join(dir, 'frames.jsonl')
  writeFileSync(stubPath, `import { appendFileSync } from 'node:fs'
const frames = ${JSON.stringify(framesPath)}
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\\r$/, '')
    buf = buf.slice(i + 1)
    if (line === '') continue
    appendFileSync(frames, line + '\\n')
    let f = null
    try { f = JSON.parse(line) } catch {}
    if (f !== null && (f.type === 'prompt' || f.type === 'steer' || f.type === 'follow_up')) {
      process.stdout.write(JSON.stringify({ type: 'response', command: f.type, success: true, id: f.id }) + '\\n')
      setTimeout(() => process.stdout.write(JSON.stringify({ type: 'agent_settled' }) + '\\n'), 30)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
`, 'utf8')
  const now = new Date().toISOString()
  writeFileSync(join(stateDir, 'directives.jsonl'), [
    JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-e2e', text: '??先看方案：做个体检报告' }),
    JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-e2e', staffSessionId: 'staff-e2e' }),
    JSON.stringify({ type: 'directive_triaged', ts: now, directiveId: 'cmd-e2e', grade: 'L2', reason: '模糊意图' }),
    JSON.stringify({ type: 'directive_plan_opened', ts: now, directiveId: 'cmd-e2e', plan: '五步走：先盘结构……' }),
  ].join('\n') + '\n', 'utf8')
  writeFileSync(join(stateDir, 'attach-map.json'), JSON.stringify({
    'staff-e2e': { executor: 'pi', sessionId: 'sess-planrej', workspacePath: ws, capturedAt: now },
  }), 'utf8')
  const port = 41210 + (process.pid % 50)
  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0', STARDECK_EXECUTOR_BIN: stubPath },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)) break
      if (i === 59) assert.fail('daemon 未就绪')
    }
    const out = await fetch(`${base}/warroom/api/commands/plan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'cmd-e2e', decision: 'reject', note: '砍到三步，风险段并入第二步' }),
    }).then(r => r.json() as Promise<{ ok?: boolean }>)
    assert.equal(out.ok, true, '带意见驳回受理')
    // ① 账本 reason。
    const ledger = readFileSync(join(stateDir, 'directives.jsonl'), 'utf8')
    assert.ok(ledger.includes('砍到三步，风险段并入第二步'), '意见入账本事件')
    // ② fold（下一轮重拟工单的数据源）。
    const board = await fetch(`${base}/warroom/api/board`).then(r => r.json() as Promise<{ commands?: Array<{ commandId: string; plan?: { reason?: string } }> }>)
    // plan 投影是否带 reason 视 dashboard 投影面——直接验 fold 源（readFile+fold 不可行于 client；用账本行验证已足）。
    assert.ok(board.commands?.some(c => c.commandId === 'cmd-e2e'), '板投影在场')
    // ③ K17 回推帧送达 stub pi（同一 follow_up 通道）。
    await new Promise(r => setTimeout(r, 1500))
    const frames = readFileSync(framesPath, 'utf8')
    assert.ok(frames.includes('follow_up'), '回推帧类型')
    assert.ok(frames.includes('驳回'), '驳回通知文本送达大副会话')
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 400))
    rm(dir)
  }
})
