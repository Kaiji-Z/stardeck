/**
 * D29 内置代理舰长 loop（ai SDK）：
 * - 旗面解析（纯）：三件齐才 enabled；基址去尾斜杠；模型可覆写。
 * - runProxyLoop 对手写 OpenAI 兼容 SSE 服全链：纯文本轮（终答/步数/流式回调）+
 *   工具轮（read_digest 被调、tool 结果回传第二轮、reads 闭包接住）。
 * - 确定性：无网络、无真 key（本机起 http server 扮兼容端点）。
 * @module stardeck/tests/proxy-loop
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import { proxyLoopEnvOf, runProxyLoop } from '../src/proxy-loop.ts'

test('旗面解析（纯）：key 齐即默认开（D32 翻默认）、0 显式关；尾斜杠剥掉；模型可覆写', () => {
  assert.equal(proxyLoopEnvOf({}).enabled, false, '无 key 不开')
  assert.equal(proxyLoopEnvOf({ STARDECK_PROXY_LOOP: '1' }).enabled, false, '无 key 不开（旗也救不了）')
  assert.equal(proxyLoopEnvOf({ Z_AI_BASE_URL: 'https://x', Z_AI_API_KEY: 'k' }).enabled, true, 'key 齐即默认开（无需旗）')
  assert.equal(proxyLoopEnvOf({ STARDECK_PROXY_LOOP: '0', Z_AI_BASE_URL: 'https://x', Z_AI_API_KEY: 'k' }).enabled, false, '0 显式关（回落舰队席）')
  const on = proxyLoopEnvOf({ Z_AI_BASE_URL: 'https://x/', Z_AI_API_KEY: ' k ', STARDECK_PROXY_LOOP_MODEL: 'glm-5.3-air' })
  assert.equal(on.baseUrl, 'https://x', '尾斜杠剥掉')
  assert.equal(on.apiKey, 'k', 'key trim')
  assert.equal(on.model, 'glm-5.3-air', '模型可覆写')
  assert.equal(proxyLoopEnvOf({ STARDECK_PROXY_LOOP: '1', Z_AI_BASE_URL: 'https://x', Z_AI_API_KEY: 'k' }).model, 'glm-5.3', '缺省 glm-5.3')
})

/** 手写 OpenAI 兼容 SSE 服：按脚本逐请求应答，收录请求体供断言。 */
function scriptedSseServer(script: Array<(body: Record<string, unknown>) => { chunks: string[]; finish: string | null }>): Promise<{ server: Server; url: Promise<string>; bodies: Promise<Array<Record<string, unknown>>> }> {
  const bodies: Array<Record<string, unknown>> = []
  let reqNo = 0
  let resolveBodies: (v: Array<Record<string, unknown>>) => void = () => {}
  const bodiesP = new Promise<Array<Record<string, unknown>>>(r => { resolveBodies = r })
  let resolveUrl: (v: string) => void = () => {}
  const urlP = new Promise<string>(r => { resolveUrl = r })
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}') as Record<string, unknown>)
      const step = script[Math.min(reqNo, script.length - 1)]!
      reqNo++
      resolveBodies(bodies)
      resolveUrl(`http://127.0.0.1:${(req.socket.localPort ?? 0)}`)
      const { chunks, finish } = step(bodies[bodies.length - 1]!)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const c of chunks) {
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'glm-test', choices: [{ index: 0, delta: c, finish_reason: null }] })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'glm-test', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  server.listen(0, '127.0.0.1', () => resolveUrl(`http://127.0.0.1:${(server.address() as { port: number }).port}`))
  return { server, url: urlP, bodies: bodiesP }
}

test('runProxyLoop：纯文本轮——终答/步数/流式回调/鉴权头与模型串', { timeout: 30_000 }, async () => {
  const { server, url, bodies } = scriptedSseServer([
    () => ({ chunks: [{ role: 'assistant', content: '收到，' }, { content: '马上拟令。' }], finish: 'stop' }),
  ])
  try {
    const deltas: string[] = []
    const out = await runProxyLoop('舰长：给我讲讲现状', { enabled: true, baseUrl: await url, apiKey: 'sk-test', model: 'glm-test-9' }, {
      reads: { board: async () => ({}), digest: async () => ({}), ledger: async () => ([]) },
      onTextDelta: d => deltas.push(d),
    })
    assert.equal(out.text, '收到，马上拟令。')
    assert.equal(out.steps, 1)
    assert.equal(out.toolCalls, 0)
    assert.deepEqual(deltas.join(''), '收到，马上拟令。', '流式回调拼回全文')
    const body = (await bodies)[0]!
    assert.equal(body.model, 'glm-test-9', '模型串透传')
    assert.ok(JSON.stringify(body.messages).includes('舰长：给我讲讲现状'), 'order 进消息')
  } finally {
    server.close()
  }
})

test('runProxyLoop：工具轮——read_digest 被调、tool 结果回传、二轮出终答', { timeout: 30_000 }, async () => {
  let digestRead = 0
  const { server, url } = scriptedSseServer([
    () => ({ chunks: [{ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_digest', arguments: '' } }] }], finish: 'tool_calls' }),
    () => ({ chunks: [{ content: '待签 1 件。' }, { content: '已拟令。' }], finish: 'stop' }),
  ])
  try {
    const out = await runProxyLoop('舰长：有什么要我签的？', { enabled: true, baseUrl: await url, apiKey: 'sk-test', model: 'glm-test-9' }, {
      reads: {
        board: async () => ({}),
        digest: async () => { digestRead++; return { sign: 1 } },
        ledger: async () => ([]),
      },
    })
    assert.equal(out.text, '待签 1 件。已拟令。')
    assert.equal(out.steps, 2, '两步（工具步+终答步）')
    assert.equal(out.toolCalls, 1)
    assert.equal(digestRead, 1, 'reads 闭包被调一次')
  } finally {
    server.close()
  }
})


/** D33 段2：onToolStep 双相回调——tool_calls 增量帧→start，finish 带 tool_calls 的
 *  收尾轮经 tool-result 相→done；无工具轮零回调。 */
test('runProxyLoop：onToolStep 序列（start→done）与无工具轮零回调', { timeout: 30_000 }, async () => {
  // 轮1：模型发起 read_board 工具调用（finish=tool_calls）；轮2：带结果终答。
  const { server, url } = scriptedSseServer([
    () => ({ chunks: [{ role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_board', arguments: '{}' } }] }], finish: 'tool_calls' }),
    () => ({ chunks: [{ role: 'assistant', content: '查完账了。' }], finish: 'stop' }),
  ])
  try {
    const steps: Array<[string, string]> = []
    const out = await runProxyLoop('问况', { enabled: true, baseUrl: await url, apiKey: 'k', model: 'glm-test' }, {
      reads: { board: async () => ({ commands: [] }), digest: async () => ({}), ledger: async () => ({}) },
      onToolStep: (name, phase) => { steps.push([name, phase]) },
    })
    assert.equal(out.text, '查完账了。')
    assert.deepEqual(steps, [['read_board', 'start'], ['read_board', 'done']], `钩子序列：${JSON.stringify(steps)}`)
  } finally { server.close() }
})

test('runProxyLoop：纯文本轮 onToolStep 零回调', { timeout: 30_000 }, async () => {
  const { server, url } = scriptedSseServer([
    () => ({ chunks: [{ role: 'assistant', content: '直接答。' }], finish: 'stop' }),
  ])
  try {
    const steps: Array<[string, string]> = []
    const out = await runProxyLoop('问', { enabled: true, baseUrl: await url, apiKey: 'k', model: 'glm-test' }, {
      reads: { board: async () => ({}), digest: async () => ({}), ledger: async () => ({}) },
      onToolStep: (name, phase) => { steps.push([name, phase]) },
    })
    assert.equal(steps.length, 0, '无工具轮零回调')
    assert.equal(out.toolCalls, 0)
  } finally { server.close() }
})

// ── D36 流式详情：思考流（reasoning_content→onReasoningDelta）+工具参数/结果摘要 ──
test('runProxyLoop：onReasoningDelta 收思考流 + onToolStep 带参数/结果摘要', { timeout: 30_000 }, async () => {
  const { server, url } = scriptedSseServer([
    () => ({ chunks: [
      { role: 'assistant', reasoning_content: '先看账面' },
      { reasoning_content: '再核速览' },
      { content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_board', arguments: '{"limit":3}' } }] },
    ], finish: 'tool_calls' }),
    () => ({ chunks: [{ role: 'assistant', content: '查完，两件事在跑。' }], finish: 'stop' }),
  ])
  try {
    const reasoning: string[] = []
    const steps: Array<[string, string, string | undefined]> = []
    const out = await runProxyLoop('问况', { enabled: true, baseUrl: await url, apiKey: 'k', model: 'glm-test' }, {
      reads: { board: async () => ({ commands: ['c1', 'c2'] }), digest: async () => ({}), ledger: async () => ({}) },
      onReasoningDelta: d => { reasoning.push(d) },
      onToolStep: (name, phase, detail) => { steps.push([name, phase, detail]) },
    })
    assert.equal(out.text, '查完，两件事在跑。')
    assert.equal(reasoning.join(''), '先看账面再核速览', `思考流拼接：${JSON.stringify(reasoning)}`)
    assert.equal(steps.length, 2)
    // read_board 的 schema 是空 z.object({})——zod 校验剥掉模型多给的参数，
    // 入参摘要 '{}' 属实（摘要在场即可，参数有无由工具 schema 定）。
    assert.ok(typeof steps[0]![2] === 'string', `start 摘要在场：${steps[0]![2]}`)
    assert.ok(steps[1]![2] !== undefined && steps[1]![2]!.length > 0, `done 摘要带出参：${steps[1]![2]}`)
  } finally { server.close() }
})

test('summarizeStepDetail：压平空白/截断/非法对象不炸', async () => {
  const { summarizeStepDetail } = await import('../src/proxy-loop.ts')
  assert.equal(summarizeStepDetail({ a: 1 }, 60), '{"a":1}')
  assert.ok(summarizeStepDetail({ deep: 'x'.repeat(200) }, 40).endsWith('…'))
  assert.equal(summarizeStepDetail('  a\n b  ', 60), 'a b')
  const cyc: Record<string, unknown> = {}; cyc.self = cyc
  assert.ok(typeof summarizeStepDetail(cyc, 10) === 'string', '循环引用走 String() 兜底')
})
