/**
 * pi RPC 客户端（P0-1 板内答复/中途投递，2026-09-02 脱离宿主九件）：
 * - 协议：JSONL over stdio，LF 分帧（\r 容忍）——**不用 Node readline**（它还会
 *   切 U+2028/2029，pi rpc.md 明说不合规）；帧与回执实证自
 *   `@earendil-works/pi-coding-agent` docs/rpc.md（本机 0.x 实装在档）。
 * - 帧三件：prompt（新指令）/ steer（运行中插令）/ follow_up（跑完再投）；
 *   回执 `{"type":"response","command":…,"success":bool,"id":…}`（带 id 关联）。
 * - 空闲判定：`agent_settled` 事件（无自动重试/压缩/队列残留）——收割时机。
 * - 答复=**续跑**（`--session <id>` + prompt 帧）：大副已退场的一次性会话由此
 *   复活并带着舰长答复继续走出口协议；注入=同一进程 steer 帧（真·中途投递）。
 * 进程面纪律同 executor.spawnCli：JS 入口经 process.execPath（win32 免 .cmd 垫片）。
 * @module stardeck/steer
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface RpcFrame { id: string; type: 'prompt' | 'steer' | 'follow_up'; message: string }

export function promptFrame(id: string, message: string): RpcFrame {
  return { id, type: 'prompt', message }
}

export function steerFrame(id: string, message: string): RpcFrame {
  return { id, type: 'steer', message }
}

export function followUpFrame(id: string, message: string): RpcFrame {
  return { id, type: 'follow_up', message }
}

/** RPC 行（回执/事件通用宽松形状）。 */
export interface RpcLine {
  type?: string
  command?: string
  success?: boolean
  id?: string
  errorMessage?: string
  error?: { message?: string } | string
  data?: { sessionId?: string; sessionFile?: string; [k: string]: unknown }
}

/** argv 构造（纯，测试管辖）：rpc 模式 + 续跑会话 + 模型 + 免批（信项目内扩展）。 */
export function piRpcArgv(args: { sessionId?: string; model?: string }): string[] {
  return [
    '--mode', 'rpc', '--approve',
    ...(args.sessionId !== undefined && args.sessionId !== '' ? ['--session', args.sessionId] : []),
    ...(args.model !== undefined && args.model !== '' ? ['--model', args.model] : []),
  ]
}

/** 缓冲增量切帧：LF 单一分隔（\r 容忍；U+2028/2029 是 JSON 串内合法字符不切）。 */
export function splitRpcFrames(buffer: string): { lines: string[]; rest: string } {
  const out: string[] = []
  let rest = ''
  let start = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === '\n') {
      let line = buffer.slice(start, i)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line !== '') out.push(line)
      start = i + 1
    }
  }
  rest = buffer.slice(start)
  return { lines: out, rest }
}

interface Pending { resolve: (v: { ok: boolean; error?: string; data?: RpcLine['data'] }) => void; timer: NodeJS.Timeout }

export interface PiRpcHandle {
  readonly child: ChildProcess
  /** 发送任意协议行（帧构造器产物或 get_state 等查询行——都带 id 关联）。 */
  send(frame: { id: string; type: string; message?: string; [k: string]: unknown }): void
  awaitResponse(id: string, timeoutMs: number): Promise<{ ok: boolean; error?: string; data?: RpcLine['data'] }>
  awaitSettled(timeoutMs: number): Promise<boolean>
  kill(): void
}

/** 起 pi RPC 进程：JS 入口经 execPath（同 spawnCli 家法），stdout 手切帧。 */
export function startPiRpc(args: { bin: string; argv: string[]; cwd: string; env?: NodeJS.ProcessEnv }): PiRpcHandle {
  const isJs = /\.(js|mjs|cjs)$/.test(args.bin)
  const child = isJs
    ? spawn(process.execPath, [args.bin, ...args.argv], { cwd: args.cwd, env: args.env, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(args.bin, args.argv, { cwd: args.cwd, env: args.env, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map<string, Pending>()
  const eventCbs: Array<(line: RpcLine) => void> = []
  let settledResolvers: Array<(v: boolean) => void> = []
  let settled = false
  let buf = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const { lines, rest } = splitRpcFrames(buf + chunk.toString('utf8'))
    buf = rest
    for (const line of lines) {
      let parsed: RpcLine
      try { parsed = JSON.parse(line) as RpcLine } catch { continue }
      if (parsed.type === 'response' && parsed.id !== undefined && pending.has(parsed.id)) {
        const p = pending.get(parsed.id)!
        pending.delete(parsed.id)
        clearTimeout(p.timer)
        const errText = typeof parsed.error === 'string'
          ? parsed.error
          : parsed.error?.message ?? parsed.errorMessage
        p.resolve({ ok: parsed.success === true, ...(errText !== undefined ? { error: errText } : {}), ...(parsed.data !== undefined ? { data: parsed.data } : {}) })
        continue
      }
      if (parsed.type === 'agent_settled') {
        settled = true
        for (const r of settledResolvers) r(true)
        settledResolvers = []
        continue
      }
      for (const cb of eventCbs) cb(parsed)
    }
  })
  child.stderr?.on('data', () => { /* pi 诊断面——不进协议流 */ })
  const kill = (): void => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'RPC 进程已退出' }) }
    pending.clear()
    for (const r of settledResolvers) r(false)
    settledResolvers = []
    if (child.exitCode === null) child.kill()
  }
  child.on('exit', kill)
  return {
    child,
    send(frame: RpcFrame): void {
      child.stdin?.write(`${JSON.stringify(frame)}\n`)
    },
    awaitResponse(id: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, error: `RPC 回执超时（${timeoutMs}ms）——pi 未响应 id=${id}` })
        }, timeoutMs)
        pending.set(id, { resolve, timer })
      })
    },
    awaitSettled(timeoutMs: number): Promise<boolean> {
      if (settled) return Promise.resolve(true)
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          settledResolvers = settledResolvers.filter(r => r !== resolve)
          resolve(false)
        }, timeoutMs)
        const wrapped = (v: boolean): void => { clearTimeout(timer); resolve(v) }
        settledResolvers.push(wrapped)
      })
    },
    kill,
  }
}

/** 一次性投递（答复/转达共用）：起 RPC 续跑会话 → 投帧 → 等回执（受理即返回）；
 *  settled（消化完）以 Promise 附带返回——调用方据此清「在途」守卫/收割进程。 */
export async function deliverViaRpc(args: {
  bin: string
  cwd: string
  sessionId?: string
  model?: string
  message: string
  kind: 'prompt' | 'follow_up'
  env?: NodeJS.ProcessEnv
  responseTimeoutMs?: number
  settledTimeoutMs?: number
}): Promise<{ ok: boolean; error?: string; settled: Promise<boolean> }> {
  const handle = startPiRpc({ bin: args.bin, argv: piRpcArgv({ sessionId: args.sessionId, model: args.model }), cwd: args.cwd, env: args.env })
  const id = `stardeck-${Date.now().toString(36)}`
  // 给进程一口起跑时间再投帧（stdin 立即可写，但慢启动下首帧可能被吞——重试一次）。
  await new Promise(r => setTimeout(r, 400))
  const frame = args.kind === 'prompt' ? promptFrame(id, args.message) : followUpFrame(id, args.message)
  handle.send(frame)
  const out = await handle.awaitResponse(id, args.responseTimeoutMs ?? 30_000)
  if (!out.ok) {
    handle.kill()
    return { ...out, settled: Promise.resolve(false) }
  }
  // 回执成功≠跑完：等 settled 再收割（防僵尸）；上限到点也收（诚实放弃等待）。
  const settled = handle.awaitSettled(args.settledTimeoutMs ?? 15 * 60_000).then(done => { handle.kill(); return done })
  return { ...out, settled }
}

/** opencode 席答复续跑的 argv（纯）：`run --auto --format json --dir <cwd> -s <会话> [model] <答复>`。
 * 与 spawnHeadlessOpencode 同款无头框定（--auto/--format json），差异=续跑既有会话
 * （-s）、不设新标题。工作区 opencode.json 的 stardeck 桥自原次 spawn 已在——
 * 续跑进程加载同一项目配置，war_* 全量可用（agentId 是不透明标签，daemon
 * tools/call 不校验注册表活体，免重注入）。 */
export function opencodeAnswerArgv(args: { cwd: string; sessionId: string; model?: string; message: string }): string[] {
  return [
    'run', ...(args.model !== undefined && args.model !== '' ? ['--model', args.model] : []),
    '--auto', '--format', 'json', '--dir', args.cwd,
    '-s', args.sessionId,
    args.message,
  ]
}

/** opencode 席一次性答复投递（P0-1 收尾：大副默认席的续跑通道）。受理语义=
 * 续跑进程活过观察窗（grace 内非零即退=会话号失效/参数被拒，如实败）；活过
 * 即受理成立，settled=进程退场（code 0=消化完），上限到点 kill 诚实放弃等待
 * （pi 同款 15min）。日志落 stateDir/logs/staff-answer-<sessionId>.log 供翻阅。 */
export async function deliverViaOpencode(args: {
  bin: string
  cwd: string
  sessionId: string
  model?: string
  message: string
  stateDir: string
  graceMs?: number
  settledTimeoutMs?: number
}): Promise<{ ok: boolean; error?: string; settled: Promise<boolean> }> {
  const logDir = join(args.stateDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `staff-answer-${args.sessionId}.log`)
  // JS 入口经 execPath（同 startPiRpc 家法：win32 免 .cmd 垫片；测试 stub=.mjs 也走这条）。
  const isJs = /\.(js|mjs|cjs)$/.test(args.bin)
  const argv = opencodeAnswerArgv({ cwd: args.cwd, sessionId: args.sessionId, model: args.model, message: args.message })
  const child = isJs
    ? spawn(process.execPath, [args.bin, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], cwd: args.cwd, windowsHide: true })
    : spawn(args.bin, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd: args.cwd, windowsHide: true })
  const log = createWriteStream(logPath, { flags: 'a' })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  const exited = new Promise<number | null>(resolve => {
    child.on('exit', c => { log.close(); resolve(c) })
    child.on('error', () => { log.close(); resolve(-1) })
  })
  const early = await Promise.race([
    exited.then(code => ({ kind: 'exit' as const, code })),
    new Promise<{ kind: 'timeout' }>(r => { setTimeout(() => r({ kind: 'timeout' }), args.graceMs ?? 5000) }),
  ])
  if (early.kind === 'exit') {
    return early.code === 0
      ? { ok: true, settled: Promise.resolve(true) }
      : { ok: false, error: `续跑进程即退（code ${String(early.code)}）——会话号失效或参数被拒；日志 ${logPath}`, settled: Promise.resolve(false) }
  }
  const cap = setTimeout(() => { child.kill() }, args.settledTimeoutMs ?? 15 * 60_000)
  const settled = exited.then(code => code === 0)
  void settled.then(() => { clearTimeout(cap) })
  return { ok: true, settled }
}
