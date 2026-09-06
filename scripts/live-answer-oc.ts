/**
 * 实弹探针：opencode 席板上答复续跑（P0-1 收尾的真通道判据）。
 *
 * 链路：真 opencode 起一会话（ACK1 应答）→ deliverViaOpencode 以
 * 【舰长答复】文本续跑同会话（问 ACK2）→ sqlite 历史回读断言三件：
 * ①同一 session 内用户消息含答复原文；②assistant 双段（两回合都在）；
 * ③ACK2 字面在场——只有「续跑真成、上下文存续」才答得出。
 *
 * 用法：node --import tsx scripts/live-answer-oc.ts
 * 前置：本机全局 opencode 已装且配好模型（同 live 门）。临时目录自清；
 * 会话本体留在 opencode 库（真会话，标题点名 stardeck 探针）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { detectOpencodeBin } from '../src/executor.ts'
import { deliverViaOpencode } from '../src/steer.ts'
import { opencodeDbPath, readSqliteHistory } from '../src/history.ts'

const token = Math.random().toString(16).slice(2, 10)
const ws = mkdtempSync(join(tmpdir(), 'sd-live-answer-'))
const stateDir = mkdtempSync(join(tmpdir(), 'sd-live-answer-state-'))
const bin = detectOpencodeBin('')

function runOpencode(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: ws, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8') })
    child.stderr?.on('data', (c: Buffer) => { out += c.toString('utf8') })
    child.on('exit', code => resolve({ code, out }))
    child.on('error', reject)
  })
}

try {
  // ① 真会话第一回合：ACK1 应答 + 捕获 sessionID（同 opencodeSessionCapture 判型）。
  const first = await runOpencode([
    'run', '--auto', '--format', 'json', '--dir', ws,
    '--title', `stardeck:live-answer-oc:${token}`,
    `Reply with exactly ACK1-${token} and nothing else.`,
  ])
  if (first.code !== 0) throw new Error(`第一回合退场 code=${String(first.code)}：${first.out.slice(0, 400)}`)
  const m = first.out.match(/"sessionID":"(ses_[A-Za-z0-9]+)"/)
  if (m === null) throw new Error(`stdout 未见 sessionID：${first.out.slice(0, 400)}`)
  const sessionId = m[1]!
  console.log(`① 第一回合 ok：session=${sessionId}`)

  // ② 板上答复通道续跑同会话（settled 等真消化完，15min 上限）。
  const out = await deliverViaOpencode({
    bin, cwd: ws, sessionId,
    message: `【舰长答复】Reply with exactly ACK2-${token} and nothing else.`,
    stateDir,
  })
  if (!out.ok) throw new Error(`续跑受理失败：${out.error ?? '未知'}`)
  const settled = await out.settled
  if (!settled) throw new Error('续跑未在窗口内消化完（settled=false）')
  console.log('② 续跑 ok（settled）')

  // ③ sqlite 历史回读三断言。
  const history = readSqliteHistory(opencodeDbPath(), 'opencode', sessionId)
  const userText = history.messages.filter(x => x.role === 'user').map(x => x.parts.map(p => p.text).join(' ')).join('\n')
  const assistantText = history.messages.filter(x => x.role === 'assistant').map(x => x.parts.map(p => p.text).join(' ')).join('\n')
  if (!userText.includes(`ACK2-${token}`) && !userText.includes('【舰长答复】')) {
    // opencode 可能把 prompt 记为别的 role 形态——宽松口径：答复原文在库里。
    if (!userText.includes('ACK2')) throw new Error(`答复原文未入会话：userText=${userText.slice(0, 200)}`)
  }
  if (!assistantText.includes(`ACK1-${token}`)) throw new Error(`第一回合应答不在同会话（ACK1 缺席）`)
  if (!assistantText.includes(`ACK2-${token}`)) throw new Error(`ACK2 缺席——续跑未真发生或上下文不续（assistantText=${assistantText.slice(0, 300)}）`)
  const turns = history.messages.filter(x => x.role === 'assistant').length
  console.log(`③ 历史回读 ok：同会话 ${String(history.messages.length)} 条消息 / assistant ${String(turns)} 回合，ACK1+ACK2 双证在场`)
  console.log('LIVE-ANSWER-OC PASS')
} finally {
  try { rmSync(ws, { recursive: true, force: true }) } catch { /* Windows 句柄慢放 */ }
  try { rmSync(stateDir, { recursive: true, force: true }) } catch { /* 同上 */ }
}
