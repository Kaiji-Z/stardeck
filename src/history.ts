/**
 * 会话历史只读读取器（零 token，方案2 定案 2026-09-02）：板上「任务会话/
 * 执行会话」钮默认弹窗展示原生会话历史——不 resume、不烧模型，直接读各舰队
 * 落在本机盘上的会话存档。四席存储实证（本机 2026-09-02 探针）：
 *   - zcode：`~/.zcode/cli/db/db.sqlite`（message+part 表，data 列 JSON——
 *     无头会话全量入库，38 条消息实测）；
 *   - opencode：`~/.local/share/opencode/opencode.db`（与 zcode 同构的
 *     message+part schema——正文在 part.data，message.data 只有元数据）；
 *   - pi：`~/.pi/agent/sessions/--<cwd 编码>--/<ts>_<uuid>.jsonl`（JSONL 事件
 *     流，type:"message" 行含 role+content；会话号=文件名 uuid 尾段）；
 *   - codex：`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`（JSONL，
 *     type:"response_item" 行 payload.type:"message" 含 role+content）。
 * db 路径可被 STARDECK_ZCODE_DB / STARDECK_OPENCODE_DB 覆盖（测试与非标准
 * 安装位用）。zcode 无 TUI——历史弹窗就是它的会话回看正解；opencode/pi/codex
 * 的弹窗之外另有「在 TUI 中打开」真交互入口（executor 侧跳转面管）。
 * @module stardeck/history
 */
import { DatabaseSync } from 'node:sqlite'
import * as zlib from 'node:zlib'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { piSessionDirFor, dshProjectKey } from './executor.ts'

export interface HistoryPart {
  kind: 'text' | 'reasoning' | 'tool'
  text: string
  /** tool 部件的工具名（Read / war_publish / …）。 */
  tool?: string
}

export interface HistoryMessage {
  role: string
  ts: number | null
  parts: HistoryPart[]
}

export interface SessionHistory {
  executor: string
  sessionId: string
  messages: HistoryMessage[]
}

/** sqlite 型 part.data JSON → 部件（text/reasoning/tool；step-start 等跳过）。 */
function partFromData(data: string): HistoryPart | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as { type?: unknown; text?: unknown; tool?: unknown; state?: { input?: unknown } }
  if (p.type === 'text' && typeof p.text === 'string') return { kind: 'text', text: p.text }
  if (p.type === 'reasoning' && typeof p.text === 'string') return { kind: 'reasoning', text: p.text }
  if (p.type === 'tool' && typeof p.tool === 'string') {
    const input = p.state !== undefined && p.state.input !== undefined ? JSON.stringify(p.state.input) : ''
    return { kind: 'tool', tool: p.tool, text: input.length > 300 ? `${input.slice(0, 300)}…` : input }
  }
  return null
}

/**
 * sqlite 双表行 → 会话消息流（纯；opencode/zcode 共用——两库 message/part
 * 同构）。messages 行须按时间序；parts 按 message_id 归组保序。
 */
export function sqliteHistory(
  messages: ReadonlyArray<{ id: string; ts: number | null; role: string }>,
  parts: ReadonlyArray<{ messageId: string; data: string }>,
): HistoryMessage[] {
  const byMessage = new Map<string, HistoryPart[]>()
  for (const part of parts) {
    const parsed = partFromData(part.data)
    if (parsed === null) continue
    const bucket = byMessage.get(part.messageId)
    if (bucket === undefined) byMessage.set(part.messageId, [parsed])
    else bucket.push(parsed)
  }
  return messages.map(m => ({ role: m.role, ts: m.ts, parts: byMessage.get(m.id) ?? [] }))
}

/** 读 sqlite 会话库（opencode/zcode 共用查询；readOnly 打开不写 WAL）。 */
export function readSqliteHistory(dbPath: string, executor: string, sessionId: string): SessionHistory {
  if (!existsSync(dbPath)) throw new Error(`会话库不存在：${dbPath}（该舰队可能没在本机跑过）`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const msgRows = db.prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as Array<{ id: string; time_created: number; data: string }>
    if (msgRows.length === 0) throw new Error(`会话 ${sessionId} 在库中无记录（可能在别机跑的，或已被清理）`)
    const partRows = db.prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as Array<{ message_id: string; data: string }>
    const messages = sqliteHistory(
      msgRows.map(r => {
        let role = 'unknown'
        let ts: number | null = r.time_created
        try {
          const d = JSON.parse(r.data) as { role?: unknown; time?: { created?: unknown } }
          if (typeof d.role === 'string') role = d.role
          if (typeof d.time?.created === 'number') ts = d.time.created
        } catch { /* data 损坏退表列值 */ }
        return { id: r.id, ts, role }
      }),
      partRows.map(r => ({ messageId: r.message_id, data: r.data })),
    )
    return { executor, sessionId, messages }
  } finally {
    db.close()
  }
}

/** pi JSONL 事件流 → 会话消息流（纯；type:"message" 行，content 内 text 件）。 */
export function piHistoryFromLines(lines: ReadonlyArray<string>): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const ev = parsed as { type?: unknown; timestamp?: unknown; message?: { role?: unknown; content?: ReadonlyArray<{ type?: unknown; text?: unknown }> } }
    if (ev.type !== 'message' || typeof ev.message?.role !== 'string') continue
    const parts: HistoryPart[] = []
    for (const c of ev.message.content ?? []) {
      if (c.type === 'text' && typeof c.text === 'string') parts.push({ kind: 'text', text: c.text })
    }
    const ts = typeof ev.timestamp === 'string' ? Date.parse(ev.timestamp) : null
    out.push({ role: ev.message.role, ts: Number.isNaN(ts) ? null : ts, parts })
  }
  return out
}

/** 读 pi 会话文件（目录=工作区编码镜像；文件名 <ts>_<会话号>.jsonl）。 */
export function readPiHistory(workspacePath: string, sessionId: string): SessionHistory {
  const dir = piSessionDirFor(workspacePath)
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    throw new Error(`pi 会话目录不存在：${dir}（该工作区没在本机跑过 pi）`)
  }
  const file = entries.find(f => f.endsWith(`_${sessionId}.jsonl`))
  if (file === undefined) throw new Error(`pi 会话 ${sessionId} 的存档文件不在 ${dir}`)
  const lines = readFileSync(join(dir, file), 'utf8').split('\n')
  const messages = piHistoryFromLines(lines)
  if (messages.length === 0) throw new Error(`pi 会话 ${sessionId} 存档里没有消息记录`)
  return { executor: 'pi', sessionId, messages }
}

/** codex rollout JSONL → 会话消息流（纯；response_item 的 message 与 function_call）。 */
export function codexHistoryFromLines(lines: ReadonlyArray<string>): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const ev = parsed as { timestamp?: unknown; payload?: { type?: unknown; role?: unknown; content?: ReadonlyArray<{ type?: unknown; text?: unknown }>; name?: unknown; arguments?: unknown } }
    if (ev.payload === undefined) continue
    const ts = typeof ev.timestamp === 'string' ? Date.parse(ev.timestamp) : null
    if (ev.payload.type === 'message' && typeof ev.payload.role === 'string') {
      const parts: HistoryPart[] = []
      for (const c of ev.payload.content ?? []) {
        if ((c.type === 'input_text' || c.type === 'output_text') && typeof c.text === 'string') parts.push({ kind: 'text', text: c.text })
      }
      out.push({ role: ev.payload.role, ts: Number.isNaN(ts) ? null : ts, parts })
    } else if (ev.payload.type === 'function_call' && typeof ev.payload.name === 'string') {
      const args = typeof ev.payload.arguments === 'string' ? ev.payload.arguments : ''
      out.push({ role: 'tool', ts: Number.isNaN(ts) ? null : ts, parts: [{ kind: 'tool', tool: ev.payload.name, text: args.length > 300 ? `${args.slice(0, 300)}…` : args }] })
    }
  }
  return out
}

/** 读 codex 会话存档（rollout-<ts>-<会话号>.jsonl；sessions 树递归找）。 */
export function readCodexHistory(sessionId: string): SessionHistory {
  const root = join(homedir(), '.codex', 'sessions')
  let files: string[] = []
  try {
    files = readdirSync(root, { recursive: true }).map(String)
  } catch {
    throw new Error(`codex 会话目录不存在：${root}（本机没跑过 codex）`)
  }
  const file = files.find(f => f.includes(sessionId) && f.endsWith('.jsonl'))
  if (file === undefined) throw new Error(`codex 会话 ${sessionId} 的存档不在 ${root}`)
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const messages = codexHistoryFromLines(lines)
  if (messages.length === 0) throw new Error(`codex 会话 ${sessionId} 存档里没有消息记录`)
  return { executor: 'codex', sessionId, messages }
}

/** opencode 会话库候选路径（按序探测；P2-9 平台探测 2026-09-02）：
 *  XDG 位在 Linux/Windows（Git Bash HOME）实证；macOS 落 Library/Application Support。
 *  env（STARDECK_OPENCODE_DB）恒最高优。 */
export function opencodeDbCandidates(home: string): string[] {
  return [
    join(home, '.local', 'share', 'opencode', 'opencode.db'),
    join(home, 'Library', 'Application Support', 'opencode', 'opencode.db'),
  ]
}

/** 探测 opencode 会话库：env 覆盖 > 首个存在的候选 > 首候选（缺席时报错文案带路径）。 */
export function opencodeDbPath(): string {
  if (process.env.STARDECK_OPENCODE_DB !== undefined && process.env.STARDECK_OPENCODE_DB !== '') return process.env.STARDECK_OPENCODE_DB
  const candidates = opencodeDbCandidates(homedir())
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c
    } catch { /* 不存在——试下一候选 */ }
  }
  return candidates[0]!
}

/** zcode 会话库默认位（env 可覆盖）。 */
export function zcodeDbPath(): string {
  return process.env.STARDECK_ZCODE_DB ?? join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

/** claude rollout JSONL → 会话消息流（纯；user/assistant 行的 message.content
 * 字符串或部件数组——text 件入流、tool_use 件成工具部件；queue-operation 等
 * 杂件跳过）。 */
export function claudeHistoryFromLines(lines: ReadonlyArray<string>): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const ev = parsed as { timestamp?: unknown; type?: unknown; message?: { role?: unknown; content?: unknown } }
    if (ev.type !== 'user' && ev.type !== 'assistant') continue
    if (typeof ev.message?.role !== 'string') continue
    const parts: HistoryPart[] = []
    const content = ev.message.content
    if (typeof content === 'string') {
      parts.push({ kind: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const c of content as Array<{ type?: unknown; text?: unknown; name?: unknown; input?: unknown }>) {
        if (c.type === 'text' && typeof c.text === 'string') parts.push({ kind: 'text', text: c.text })
        else if (c.type === 'tool_use' && typeof c.name === 'string') {
          const input = c.input !== undefined ? JSON.stringify(c.input) : ''
          parts.push({ kind: 'tool', tool: c.name, text: input.length > 300 ? `${input.slice(0, 300)}…` : input })
        }
      }
    }
    const ts = typeof ev.timestamp === 'string' ? Date.parse(ev.timestamp) : null
    out.push({ role: ev.message.role, ts: Number.isNaN(ts) ? null : ts, parts })
  }
  return out
}

/** 读 claude 会话存档（~/.claude/projects/<cwd 编码>/<会话号>.jsonl——编码
 * 目录含驱动器小写等历史变体，直接递归扫 <会话号>.jsonl 兜住全部形态）。 */
export function readClaudeHistory(sessionId: string, root = join(homedir(), '.claude', 'projects')): SessionHistory {
  let files: string[] = []
  try {
    files = readdirSync(root, { recursive: true }).map(String)
  } catch {
    throw new Error(`claude 会话目录不存在：${root}（本机没跑过 claude）`)
  }
  const file = files.find(f => f.endsWith(`${sessionId}.jsonl`))
  if (file === undefined) throw new Error(`claude 会话 ${sessionId} 的存档不在 ${root}`)
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const messages = claudeHistoryFromLines(lines)
  if (messages.length === 0) throw new Error(`claude 会话 ${sessionId} 存档里没有消息记录`)
  return { executor: 'claude', sessionId, messages }
}

/** dsh 会话存档多帧 zstd 解码（纯）：逐帧 zstdDecompressSync + 帧魔数
 * （28 B5 2F FD）步进拼接。Node <23.8 无 zstd 面时给诚实错误。 */
export function dshDecodeZstdFrames(buf: Buffer): string {
  const dec = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync
  if (dec === undefined) throw new Error('本机 Node 无 zstd 解压面（需 Node ≥23.8/24）——dsh 会话存档（.jsonl.zstd）读不了')
  const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
  const frames: Buffer[] = []
  let off = 0
  while (off < buf.length) {
    let part: Buffer
    try {
      part = dec(buf.subarray(off))
    } catch {
      break // 帧损坏/残尾：保已解码前段
    }
    if (part.length === 0) break
    frames.push(part)
    const next = buf.subarray(off + 4).indexOf(MAGIC)
    if (next < 0) break
    off += 4 + next
  }
  return Buffer.concat(frames).toString('utf8')
}

/** dsh session.jsonl 事件行 → 会话消息流（纯）：user/message 与
 * assistant/message（后者载荷嵌 data.message；reasoning/text 分部件）。 */
export function dshHistoryFromLines(lines: ReadonlyArray<string>): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const ev = parsed as { type?: unknown; time?: unknown; data?: { content?: ReadonlyArray<{ type?: unknown; text?: unknown }>; role?: unknown; message?: { role?: unknown; content?: ReadonlyArray<{ type?: unknown; text?: unknown }> } } }
    const ts = typeof ev.time === 'number' ? ev.time : null
    const partsOf = (content: ReadonlyArray<{ type?: unknown; text?: unknown }>): HistoryPart[] => {
      const parts: HistoryPart[] = []
      for (const c of content) {
        if (c.type === 'text' && typeof c.text === 'string') parts.push({ kind: 'text', text: c.text })
        else if (c.type === 'reasoning' && typeof c.text === 'string') parts.push({ kind: 'reasoning', text: c.text })
      }
      return parts
    }
    if (ev.type === 'user/message' && ev.data !== undefined && Array.isArray(ev.data.content)) {
      out.push({ role: 'user', ts, parts: partsOf(ev.data.content) })
    } else if (ev.type === 'assistant/message' && ev.data?.message !== undefined && Array.isArray(ev.data.message.content)) {
      out.push({ role: 'assistant', ts, parts: partsOf(ev.data.message.content) })
    }
  }
  return out
}

/** 读 dsh 会话存档（~/.dsh/sessions/<projectKey(cwd)>/session-<id>/
 * session.jsonl.zstd——目录键=dsh format.ts projectKey，executor.ts 复刻）。 */
export function readDshHistory(sessionId: string, workspacePath: string, root = join(homedir(), '.dsh', 'sessions')): SessionHistory {
  const id = sessionId.startsWith('session-') ? sessionId : `session-${sessionId}`
  const file = join(root, dshProjectKey(workspacePath), id, 'session.jsonl.zstd')
  if (!existsSync(file)) throw new Error(`dsh 会话存档不在 ${file}`)
  const messages = dshHistoryFromLines(dshDecodeZstdFrames(readFileSync(file)).split('\n'))
  if (messages.length === 0) throw new Error(`dsh 会话 ${sessionId} 存档里没有消息记录`)
  return { executor: 'dsh', sessionId: id, messages }
}

/** 各席分发：按 attach 映射的 executor 读对应存档（全只读、零 token）。 */
export function readSessionHistory(executor: string, sessionId: string, workspacePath: string): SessionHistory {
  if (executor === 'zcode') return readSqliteHistory(zcodeDbPath(), 'zcode', sessionId)
  if (executor === 'pi') return readPiHistory(workspacePath, sessionId)
  if (executor === 'codex') return readCodexHistory(sessionId)
  if (executor === 'claude') return readClaudeHistory(sessionId)
  if (executor === 'dsh') return readDshHistory(sessionId, workspacePath)
  return readSqliteHistory(opencodeDbPath(), 'opencode', sessionId)
}
