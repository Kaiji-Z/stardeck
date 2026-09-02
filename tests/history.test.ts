/**
 * 会话历史只读读取器（src/history.ts，方案2·二段：零 token 板内弹窗）的
 * 确定性回归：sqlite 双表解析（纯）/ pi·codex JSONL 解析（纯）/ 真 sqlite 库
 * 读写往返（node:sqlite 建 message+part 同构 schema——opencode/zcode 共用查
 * 询的实证）/ pi 会话文件定位（<ts>_<uuid>.jsonl 尾段匹配）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { sqliteHistory, readSqliteHistory, piHistoryFromLines, readPiHistory, codexHistoryFromLines, claudeHistoryFromLines, readClaudeHistory } from '../src/history.ts'
import { piSessionDirFor } from '../src/executor.ts'

test('sqliteHistory（纯）：text/reasoning/tool 入流、step-start 等杂件跳过、按消息归组', () => {
  const out = sqliteHistory(
    [
      { id: 'm1', ts: 1, role: 'user' },
      { id: 'm2', ts: 2, role: 'assistant' },
    ],
    [
      { messageId: 'm1', data: JSON.stringify({ type: 'text', text: 'Mission: read brief' }) },
      { messageId: 'm1', data: JSON.stringify({ type: 'step-start' }) },
      { messageId: 'm2', data: JSON.stringify({ type: 'reasoning', text: '先读简报' }) },
      { messageId: 'm2', data: JSON.stringify({ type: 'tool', tool: 'war_claim', state: { input: { task_id: 't-1' } } }) },
      { messageId: 'm2', data: JSON.stringify({ type: 'text', text: '已领取' }) },
      { messageId: 'm9', data: JSON.stringify({ type: 'text', text: '孤儿部件（无主消息）' }) },
    ],
  )
  assert.equal(out.length, 2)
  assert.equal(out[0]!.role, 'user')
  assert.deepEqual(out[0]!.parts, [{ kind: 'text', text: 'Mission: read brief' }])
  assert.equal(out[1]!.parts.length, 3)
  assert.equal(out[1]!.parts[0]!.kind, 'reasoning')
  assert.equal(out[1]!.parts[1]!.tool, 'war_claim')
  assert.equal(out[1]!.parts[1]!.text, '{"task_id":"t-1"}')
  assert.equal(out[1]!.parts[2]!.text, '已领取')
})

test('piHistoryFromLines（纯）：message 行入流（role+text 件），杂事件跳过', () => {
  const lines = [
    JSON.stringify({ type: 'session', version: 3, id: 'u-1' }),
    JSON.stringify({ type: 'message', timestamp: '2026-09-02T08:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Mission: …' }] } }),
    JSON.stringify({ type: 'message', timestamp: '2026-09-02T08:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '干完了' }, { type: 'other' }] } }),
    '不是 JSON',
  ]
  const out = piHistoryFromLines(lines)
  assert.equal(out.length, 2)
  assert.equal(out[0]!.role, 'user')
  assert.equal(out[0]!.parts.length, 1)
  assert.equal(out[1]!.parts[0]!.text, '干完了')
  assert.equal(out[1]!.ts, Date.parse('2026-09-02T08:00:05.000Z'))
})

test('codexHistoryFromLines（纯）：response_item 的 message 与 function_call 入流', () => {
  const lines = [
    JSON.stringify({ timestamp: '2026-09-01T03:39:48.862Z', type: 'session_meta', payload: { id: 'x' } }),
    JSON.stringify({ timestamp: '2026-09-01T03:39:53.863Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修 README' }] } }),
    JSON.stringify({ timestamp: '2026-09-01T03:40:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}' } }),
  ]
  const out = codexHistoryFromLines(lines)
  assert.equal(out.length, 2)
  assert.equal(out[0]!.role, 'user')
  assert.equal(out[0]!.parts[0]!.text, '修 README')
  assert.equal(out[1]!.role, 'tool')
  assert.equal(out[1]!.parts[0]!.tool, 'shell')
})

test('readSqliteHistory：真 sqlite 库往返（node:sqlite 建 opencode/zcode 同构 schema）', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-history-'))
  t.after(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) })
  const db = new DatabaseSync(join(dir, 'probe.db'))
  db.exec('CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)')
  db.exec('CREATE TABLE part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)')
  const insMsg = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
  const insPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
  insMsg.run('m1', 'ses_probe', 100, 100, JSON.stringify({ role: 'user', time: { created: 100 } }))
  insMsg.run('m2', 'ses_probe', 200, 200, JSON.stringify({ role: 'assistant', time: { created: 200 } }))
  insMsg.run('m3', 'ses_other', 300, 300, JSON.stringify({ role: 'user' }))
  insPart.run('p1', 'm1', 'ses_probe', 101, 101, JSON.stringify({ type: 'text', text: '接令' }))
  insPart.run('p2', 'm2', 'ses_probe', 201, 201, JSON.stringify({ type: 'text', text: '发布完成' }))
  db.close()
  const out = readSqliteHistory(join(dir, 'probe.db'), 'opencode', 'ses_probe')
  assert.equal(out.executor, 'opencode')
  assert.equal(out.messages.length, 2)
  assert.equal(out.messages[0]!.role, 'user')
  assert.equal(out.messages[1]!.parts[0]!.text, '发布完成')
  // 无记录/库不在——诚实错误。
  assert.throws(() => readSqliteHistory(join(dir, 'probe.db'), 'opencode', 'ses_none'), /无记录/)
  assert.throws(() => readSqliteHistory(join(dir, 'absent.db'), 'opencode', 'ses_probe'), /不存在/)
})

test('readPiHistory：目录编码定位 <ts>_<会话号>.jsonl 尾段匹配', t => {
  const ws = mkdtempSync(join(tmpdir(), 'stardeck-piws-'))
  t.after(() => { rmSync(ws, { recursive: true, force: true, maxRetries: 3 }) })
  // pi 会话目录=工作区全路径编码（piSessionDirFor），测试经同函数构造。
  const dir = piSessionDirFor(ws)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '2026-09-02T08-00-00-000Z_11111111-2222-3333-4444-555555555555.jsonl'), [
    JSON.stringify({ type: 'session', id: 'x' }),
    JSON.stringify({ type: 'message', timestamp: '2026-09-02T08:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '交证完成' }] } }),
  ].join('\n'), 'utf8')
  const out = readPiHistory(ws, '11111111-2222-3333-4444-555555555555')
  assert.equal(out.executor, 'pi')
  assert.equal(out.messages.length, 1)
  assert.equal(out.messages[0]!.parts[0]!.text, '交证完成')
  assert.throws(() => readPiHistory(ws, 'no-such-id'), /存档文件不在/)
})

test('claudeHistoryFromLines（纯）：user/assistant 行入流（content 字符串或部件数组），杂件跳过', () => {
  const lines = [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: 'x', content: 'noise' }),
    JSON.stringify({ type: 'user', timestamp: '2026-09-02T10:29:45.482Z', message: { role: 'user', content: 'Mission: read brief' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-09-02T10:29:46.000Z', message: { role: 'assistant', content: [
      { type: 'text', text: 'Claimed the task.' },
      { type: 'tool_use', name: 'war_claim', input: { task_id: 't-1' } },
    ] } }),
  ]
  const out = claudeHistoryFromLines(lines)
  assert.equal(out.length, 2)
  assert.equal(out[0]!.role, 'user')
  assert.equal(out[0]!.parts[0]!.text, 'Mission: read brief')
  assert.equal(out[1]!.parts.length, 2)
  assert.equal(out[1]!.parts[1]!.tool, 'war_claim')
  assert.ok(out[1]!.parts[1]!.text.includes('t-1'))
})

test('readClaudeHistory：projects 树递归扫 <会话号>.jsonl（驱动器大小写变体兜住）', t => {
  const root = mkdtempSync(join(tmpdir(), 'stardeck-claude-'))
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3 }) })
  const proj = join(root, 'd--users-tester-AppData-Local-Temp-x')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, '2ea857bd-dd82-4f1a-9c3d-1a2b3c4d5e6f.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: '2026-09-02T10:29:45.482Z', message: { role: 'user', content: 'Reply with exactly: OK' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-09-02T10:29:46.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] } }),
  ].join('\n'), 'utf8')
  const out = readClaudeHistory('2ea857bd-dd82-4f1a-9c3d-1a2b3c4d5e6f', root)
  assert.equal(out.executor, 'claude')
  assert.equal(out.messages.length, 2)
  assert.equal(out.messages[1]!.parts[0]!.text, 'OK')
  assert.throws(() => readClaudeHistory('no-such-id', root), /存档不在/)
})
