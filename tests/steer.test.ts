/**
 * P0-1 steer/答复链（2026-09-02 脱离宿主九件）：
 * - 帧构造纯函数（prompt/steer/follow_up + rpc argv）；
 * - LF 手切帧（\r 容忍、U+2028/29 不切——pi rpc.md 明说 readline 不合规）；
 * - 假 pi RPC stub（真子进程说协议）：startPiRpc 回执关联/agent_settled 收割/超时诚实；
 * - deliverViaRpc follow_up 通道（回执成功 + settled 后进程收割）；
 * - 真 daemon /commands/answer：pi 席续跑投递（stub 收到【舰长答复】帧）+
 *   directive_answered 审计入账 + 非 talking 诚实拒绝 + 非 pi 席诚实拒绝。
 * @module stardeck/tests/steer
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  promptFrame, steerFrame, followUpFrame, piRpcArgv, splitRpcFrames, startPiRpc, deliverViaRpc,
} from '../src/steer.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Windows 收割是异步的——等 exit 事件（上限兜底），再断言/清理。 */
async function waitExit(child: ChildProcess, ms = 3000): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    child.on('exit', () => { clearTimeout(timer); resolve() })
  })
}
function rm(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* Windows 句柄慢放——尽力而为 */ }
}

test('steer：帧构造与 rpc argv（纯）', () => {
  assert.deepEqual(promptFrame('r1', '答复'), { id: 'r1', type: 'prompt', message: '答复' })
  assert.deepEqual(steerFrame('r2', '改令'), { id: 'r2', type: 'steer', message: '改令' })
  assert.deepEqual(followUpFrame('r3', '补充'), { id: 'r3', type: 'follow_up', message: '补充' })
  assert.deepEqual(piRpcArgv({}), ['--mode', 'rpc', '--approve'])
  assert.deepEqual(piRpcArgv({ sessionId: 'sess-9', model: 'glm-5.2' }), ['--mode', 'rpc', '--approve', '--session', 'sess-9', '--model', 'glm-5.2'])
})

test('steer：LF 手切帧——\\r 容忍、U+2028/29 是串内字符不切、余量保留', () => {
  const { lines, rest } = splitRpcFrames('{"a":1}\r\n{"b":""}\n{"c":')
  assert.deepEqual(lines, ['{"a":1}', '{"b":""}'])
  assert.equal(rest, '{"c":')
})

/** 假 pi RPC：逐行回 response（按帧的 type/command 回 command 名）+ agent_settled；收到的帧落盘供断言。 */
function writeStub(dir: string): { stubPath: string; framesPath: string } {
  const stubPath = join(dir, 'fake-pi-rpc.mjs')
  const framesPath = join(dir, 'frames.jsonl')
  writeFileSync(stubPath, `import { appendFileSync, readFileSync } from 'node:fs'
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
  return { stubPath, framesPath }
}

test('steer：startPiRpc 真子进程协议往返——回执按 id 关联 + settled 收割', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-steer-'))
  try {
    const { stubPath, framesPath } = writeStub(dir)
    const handle = startPiRpc({ bin: stubPath, argv: piRpcArgv({ sessionId: 'sess-1' }), cwd: dir })
    handle.send(promptFrame('a1', '你好'))
    const out = await handle.awaitResponse('a1', 5000)
    assert.equal(out.ok, true, '回执成功')
    const settled = await handle.awaitSettled(5000)
    assert.equal(settled, true, 'agent_settled 到点')
    const frames = readFileSync(framesPath, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { type: string; message: string })
    assert.equal(frames[0]?.type, 'prompt')
    assert.equal(frames[0]?.message, '你好')
    handle.kill()
    await waitExit(handle.child)
    assert.ok(handle.child.exitCode !== null || handle.child.signalCode !== null, '收割后进程退出（exit 或 signal）')
  } finally {
    rm(dir)
  }
})

test('steer：无响应超时诚实——awaitResponse 带错误文案返回', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-steer2-'))
  try {
    // 沉默 stub：只吃输入永不回。
    const stubPath = join(dir, 'silent-pi.mjs')
    writeFileSync(stubPath, `process.stdin.on('data', () => {})\nprocess.stdin.on('end', () => process.exit(0))\n`, 'utf8')
    const handle = startPiRpc({ bin: stubPath, argv: [], cwd: dir })
    handle.send(promptFrame('t1', 'x'))
    const out = await handle.awaitResponse('t1', 600)
    assert.equal(out.ok, false)
    assert.ok(out.error?.includes('超时'), '超时文案：' + out.error)
    handle.kill()
  } finally {
    rm(dir)
  }
})

test('steer：deliverViaRpc follow_up 通道——受理回执 + settled 后自动收割', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-steer3-'))
  try {
    const { stubPath, framesPath } = writeStub(dir)
    const out = await deliverViaRpc({ bin: stubPath, cwd: dir, sessionId: 'sess-2', message: '【舰长批注】任务 X：补充要求', kind: 'follow_up', responseTimeoutMs: 5000, settledTimeoutMs: 5000 })
    assert.equal(out.ok, true, 'follow_up 受理')
    assert.equal(await out.settled, true, 'settled 到点')
    const frames = readFileSync(framesPath, 'utf8').trim()
    assert.ok(frames.includes('follow_up'), '帧送达 stub')
    assert.ok(frames.includes('【舰长批注】'), '批注文本原样')
  } finally {
    rm(dir)
  }
})

test('答复端点：真 daemon + stub pi——投递成功入账 + 非 talking 拒绝 + 非 pi 席拒绝', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-answer-'))
  const stateDir = join(dir, 'state')
  const ws = join(dir, 'ws')
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
  mkdirSync(ws, { recursive: true })
  const { stubPath, framesPath } = writeStub(dir)
  // 种子：talking 命令（staffSessionId=staff-abc）+ received 命令 + attach 映射（pi 席 + opencode 席两键）。
  const now = new Date().toISOString()
  writeFileSync(join(stateDir, 'directives.jsonl'), [
    JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-talk', text: '??先看方案：体检' }),
    JSON.stringify({ type: 'directive_session_opened', ts: now, directiveId: 'cmd-talk', staffSessionId: 'staff-abc' }),
    JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-talk', staffSessionId: 'staff-abc' }),
    JSON.stringify({ type: 'directive_talking', ts: now, directiveId: 'cmd-talk' }),
    JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-recv', text: '普通命令' }),
    JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-recv', staffSessionId: 'staff-abc' }),
  ].join('\n') + '\n', 'utf8')
  writeFileSync(join(stateDir, 'attach-map.json'), JSON.stringify({
    'staff-abc': { executor: 'pi', sessionId: 'sess-staff-1', workspacePath: ws, capturedAt: now },
    'staff-oc': { executor: 'opencode', sessionId: 'ses_oc_1', workspacePath: ws, capturedAt: now },
  }), 'utf8')
  // cmd-oc：talking 但会话属 opencode 席。
  const fd = readFileSync(join(stateDir, 'directives.jsonl'), 'utf8')
  writeFileSync(join(stateDir, 'directives.jsonl'), fd + [
    JSON.stringify({ type: 'directive_created', ts: now, directiveId: 'cmd-oc', text: '另一条' }),
    JSON.stringify({ type: 'directive_received', ts: now, directiveId: 'cmd-oc', staffSessionId: 'staff-oc' }),
    JSON.stringify({ type: 'directive_talking', ts: now, directiveId: 'cmd-oc' }),
  ].join('\n') + '\n', 'utf8')
  const port = 41150 + (process.pid % 50)
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
    // ① talking + pi 席 → 200 + 审计入账 + stub 收到【舰长答复】帧。
    const ok = await fetch(`${base}/warroom/api/commands/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'cmd-talk', text: '用最轻方案，直接做。' }),
    })
    assert.equal(ok.status, 200)
    const okBody = await ok.json() as { ok?: boolean; note?: string }
    assert.equal(okBody.ok, true)
    await new Promise(r => setTimeout(r, 1200))
    const frames = readFileSync(framesPath, 'utf8')
    assert.ok(frames.includes('【舰长答复】用最轻方案，直接做。'), '答复帧送达（stub pi 收到）')
    assert.ok(frames.includes('war_plan'), '续跑指引在帧内')
    const ledger = readFileSync(join(stateDir, 'directives.jsonl'), 'utf8')
    assert.ok(ledger.includes('directive_answered'), '审计事件入账')
    // ② 非 talking → 409 诚实拒绝。
    const recv = await fetch(`${base}/warroom/api/commands/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'cmd-recv', text: 'x' }),
    })
    const recvBody = await recv.json() as { ok?: boolean; error?: string }
    assert.equal(recv.status, 200, 'dashboard send 家法=恒 200，状态在 body')
    assert.equal(recvBody.ok, false)
    assert.ok(recvBody.error?.includes('不是追问中'))
    // ③ 非 pi 席 → 409 诚实拒绝（通道现只支持 pi）。
    const oc = await fetch(`${base}/warroom/api/commands/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'cmd-oc', text: 'x' }),
    })
    const ocBody = await oc.json() as { ok?: boolean; error?: string }
    assert.equal(ocBody.ok, false)
    assert.ok(ocBody.error?.includes('pi'))
    // ④ 未知命令 → 404。
    const none = await fetch(`${base}/warroom/api/commands/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'cmd-nope', text: 'x' }),
    })
    const noneBody = await none.json() as { ok?: boolean; error?: string }
    assert.equal(noneBody.ok, false)
    assert.ok(noneBody.error?.includes('不存在'))
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 500))
    rm(dir)
  }
})
