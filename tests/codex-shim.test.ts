/**
 * V19.13 codex Responses→chat 垫片：翻译纯函数（请求/应答双面）+ 回环服务器
 * 集成（stub 上游）。协议形状按 codex rust-v0.153.4 源码钉死（见
 * src/codex-shim.ts 头注证据行）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import {
  chatChoiceToResponseItems, chatResponseToSse, codexShimProviderArgs,
  responsesRequestToChat, sseFrame, startCodexShim,
} from '../src/codex-shim.ts'

test('responsesRequestToChat：instructions→system / 双向消息 / 工具调用对偶 / 悬空 tool 消息丢弃', () => {
  const out = responsesRequestToChat({
    model: 'glm-5.2',
    instructions: '你是外勤小队',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '看板有几件事？' }] },
      { type: 'reasoning', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我去查。' }] },
      { type: 'function_call', name: 'war_board', arguments: '{}', call_id: 'call_1' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"tasks":3}' },
      { type: 'function_call_output', call_id: 'call_ghost', output: '孤儿输出' },
      { type: 'local_shell_call', call_id: 'call_2', action: { command: ['ls'] } },
      { type: 'function_call_output', call_id: 'call_2', output: [{ type: 'output_text', text: 'a.txt' }] },
    ],
    tools: [
      { type: 'function', name: 'war_board', description: '看板', strict: false, parameters: { type: 'object', properties: {} } },
      { type: 'web_search', external_web_access: true },
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
  })
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.body.model, 'glm-5.2')
  assert.deepEqual(out.body.tool_choice, 'auto')
  assert.equal(out.body.parallel_tool_calls, false)
  assert.deepEqual(out.body.tools, [{ type: 'function', function: { name: 'war_board', description: '看板', parameters: { type: 'object', properties: {} } } }], '只映射 function 面')
  const msgs = out.body.messages as Record<string, unknown>[]
  assert.equal(msgs[0]?.role, 'system')
  assert.equal(msgs[0]?.content, '你是外勤小队')
  assert.deepEqual(msgs[1], { role: 'user', content: '看板有几件事？' })
  assert.deepEqual(msgs.slice(2, 4), [
    { role: 'assistant', content: '我去查。' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'war_board', arguments: '{}' } }] },
  ])
  assert.deepEqual(msgs[4], { role: 'tool', tool_call_id: 'call_1', content: '{"tasks":3}' }, '输出串原样')
  assert.equal(JSON.stringify(msgs).includes('call_ghost'), false, '悬空 tool 消息丢弃')
  assert.deepEqual(msgs[5], { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'shell', arguments: '{"command":["ls"]}' } }] }, 'local_shell 合成 tool_call')
  assert.deepEqual(msgs[6], { role: 'tool', tool_call_id: 'call_2', content: 'a.txt' }, '结构化输出数组拉平')
})

test('responsesRequestToChat：缺 model 拒译', () => {
  const out = responsesRequestToChat({ input: [] })
  assert.equal(out.ok, false)
})

test('chatChoiceToResponseItems + chatResponseToSse：文本件/tool_call 件/usage 与 end_turn 映射', () => {
  const items = chatChoiceToResponseItems({
    message: {
      content: '甲板清点完毕',
      tool_calls: [{ id: 'tc_9', type: 'function', function: { name: 'war_claim', arguments: '{"task_id":"t1"}' } }],
    },
  })
  assert.deepEqual(items, [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '甲板清点完毕' }] },
    { type: 'function_call', name: 'war_claim', arguments: '{"task_id":"t1"}', call_id: 'tc_9' },
  ])
  const sse = chatResponseToSse({
    id: 'chatcmpl-1',
    choices: [{ message: { content: '收到' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
  })
  const types = [...sse.matchAll(/^event: (.+)$/gm)].map(m => m[1])
  assert.deepEqual(types, ['response.created', 'response.output_item.done', 'response.completed'], 'created→done→completed 闭合')
  assert.ok(sse.includes('event: response.completed'))
  assert.ok(sse.includes('"input_tokens":11'))
  assert.ok(sse.includes('"total_tokens":13'))
  assert.ok(sse.includes('"end_turn":true'))
  assert.ok(sse.includes('"text":"收到"'))
})

test('sseFrame：event 行与 data 行同型（data JSON 自带 type）', () => {
  const frame = sseFrame('response.created', { response: { id: 'x' } })
  assert.equal(frame, 'event: response.created\ndata: {"type":"response.created","response":{"id":"x"}}\n\n')
})

test('startCodexShim：回环全链——stub 上游 + SSE 应答 / compact 404 / 上游 502 中继', async () => {
  // stub 上游：收到的 chat 体落盘断言（key 只在本进程内存——这里经闭包校验）。
  const dir = mkdtempSync(join(tmpdir(), 'codex-shim-'))
  const seen: { auth: string; body: Record<string, unknown> }[] = []
  const upstream: Server = createServer((req, res) => {
    const parts: Buffer[] = []
    req.on('data', c => parts.push(c))
    req.on('end', () => {
      seen.push({ auth: String(req.headers.authorization ?? ''), body: JSON.parse(Buffer.concat(parts).toString('utf8')) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'up-1', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }))
    })
  })
  await new Promise<void>(r => { upstream.listen(0, '127.0.0.1', () => r()) })
  const upstreamPort = (upstream.address() as { port: number }).port
  const shim = await startCodexShim({ port: 0, upstream: `http://127.0.0.1:${upstreamPort}`, apiKey: 'sk-test' })
  try {
    // ① /v1/responses 全链（codex url_for_path 拼形=base+responses）。
    const res = await fetch(`http://127.0.0.1:${shim.port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.2', instructions: 'brief', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] }),
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const sse = await res.text()
    assert.ok(sse.includes('"text":"OK"'))
    assert.ok(sse.includes('"input_tokens":5'))
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.auth, 'Bearer sk-test', 'key 由垫片注入上游请求')
    assert.equal((seen[0]!.body.messages as unknown[]).length, 2, 'system+user 两消息')
    // ② compact 面：诚实 404。
    const compact = await fetch(`http://127.0.0.1:${shim.port}/v1/responses/compact`, { method: 'POST', body: '{}' })
    assert.equal(compact.status, 404)
    // ③ 上游炸：502 中继（codex 走自家重试面）。
    const badUpstream: Server = createServer((_req, res) => { res.writeHead(500); res.end('boom') })
    await new Promise<void>(r => { badUpstream.listen(0, '127.0.0.1', () => r()) })
    const badPort = (badUpstream.address() as { port: number }).port
    const shim2 = await startCodexShim({ port: 0, upstream: `http://127.0.0.1:${badPort}`, apiKey: 'sk-x' })
    try {
      const res2 = await fetch(`http://127.0.0.1:${shim2.port}/responses`, { method: 'POST', body: JSON.stringify({ model: 'm', input: [] }) })
      assert.equal(res2.status, 502)
      assert.match(await res2.text(), /500/)
    } finally {
      await new Promise<void>(r => badUpstream.close(() => r()))
      await shim2.close()
    }
  } finally {
    await shim.close()
    await new Promise<void>(r => upstream.close(() => r()))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('codexShimProviderArgs：provider 定义五旗（base_url 去尾斜杠）', () => {
  assert.deepEqual(codexShimProviderArgs('http://127.0.0.1:3975/v1/'), [
    '-c', 'model_provider=stardeck_shim',
    '-c', 'model_providers.stardeck_shim.name="stardeck shim"',
    '-c', 'model_providers.stardeck_shim.base_url="http://127.0.0.1:3975/v1"',
    '-c', 'model_providers.stardeck_shim.wire_api="responses"',
    '-c', 'model_providers.stardeck_shim.requires_openai_auth=false',
  ])
})
