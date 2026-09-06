/**
 * codex Responses→chat 垫片（V19.13，DESIGN D19 的解锁刀）：
 * codex-cli 0.152+ 只认 Responses wire（chat 已永久移除），z.ai GLM 只有
 * chat/completions 面——本垫片在回环端口把 /responses 翻译成 chat，GLM 直驱
 * codex 由此打通。纯翻译函数（单测锁死）+ node:http 回环服务器（仅绑
 * 127.0.0.1，key 只进本进程内存、永不入 codex 配置）。
 *
 * 协议证据（codex rust-v0.153.4）：
 * - 请求体 ResponsesApiRequest{model,instructions,input,tools,tool_choice,…}
 *   （codex-api/src/common.rs:275）；URL=base_url.trim(/)+"/responses"
 *   （provider.rs:53 url_for_path）。
 * - SSE 帧按 data JSON 的 `type` 字段判型（codex-api/src/sse/responses.rs:167
 *   ResponsesStreamEvent.kind），最小闭合面：response.created /
 *   response.output_item.done（整件直达，可无增量事件）/
 *   response.completed（usage: input_tokens/output_tokens/total_tokens，
 *   :128 ResponseCompletedUsage）；错误面 response.failed。
 * - input 项形状=protocol/src/models.rs:978 ResponseItem（tag=type
 *   snake_case）：Message{role,content[ContentItem input_text/output_text]}、
 *   FunctionCall{name,arguments(串),call_id}、FunctionCallOutput{call_id,
 *   output(串|结构化数组)}、Reasoning、LocalShellCall、CustomToolCall…。
 * - tools 项=tools/src/responses_api.rs:32 ResponsesApiTool
 *   {type:"function",name,description,strict,parameters}。
 * @module stardeck/codex-shim
 */
import { createServer, type Server } from 'node:http'

/** JSON 里的一条 input/output 项（形状按 ResponseItem，防御式读取）。 */
type Item = Record<string, unknown>

/** chat/completions 侧的一条消息（宽松形——不同 provider 字段容忍度不同）。 */
export type ChatMessage = Record<string, unknown>

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
const asObj = (v: unknown): Item => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Item : {})
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Message 项的 content 数组 → 拼接文本（input_text / output_text；其余丢弃）。 */
function contentText(content: unknown, kinds: string[]): string {
  return asArray(content)
    .map(asObj)
    .filter(c => kinds.includes(asString(c.type)))
    .map(c => asString(c.text))
    .join('')
}

/** FunctionCallOutput 的 output 载荷 → 文本（线形=纯串或结构化内容数组）。 */
function outputPayloadText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output.map(o => {
      const rec = asObj(o)
      return asString(rec.text) || asString(rec.content) || JSON.stringify(rec)
    }).join('\n')
  }
  const rec = asObj(output)
  return asString(rec.content) || asString(rec.text) || ''
}

/**
 * Responses 请求 → chat/completions 请求体（纯）。
 * - instructions → system；input 项逐条翻译；Reasoning 等不可载项跳过；
 * - 工具调用对偶保全：FunctionCall→assistant.tool_calls，FunctionCallOutput→
 *   tool 消息；没有前驱 tool_call 的悬空 tool 消息丢弃（部分 provider 见
 *   孤儿 tool 消息会 400）；
 * - tools 只映射 type:"function"（MCP 工具全走这条）；web_search/custom 等
 *   chat 面无对应物，丢弃计数入 debug。
 */
export function responsesRequestToChat(req: unknown, modelOverride?: string): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const r = asObj(req)
  // 模型改写（V19.13）：slug 骗面——codex 侧用目录内 slug 拿完整模型元数据，
  // 垫片把实际请求改写到真模型（如 glm-5.2）。
  const model = modelOverride !== undefined && modelOverride !== '' ? modelOverride : asString(r.model)
  if (model === '') return { ok: false, error: '请求缺 model 字段' }
  const messages: ChatMessage[] = []
  const instructions = asString(r.instructions)
  if (instructions !== '') messages.push({ role: 'system', content: instructions })
  const emittedCallIds = new Set<string>()
  let callSeq = 0
  for (const raw of asArray(r.input)) {
    const item = asObj(raw)
    const type = asString(item.type)
    if (type === 'message') {
      const role = asString(item.role)
      if (role === 'user' || role === 'system') {
        const text = contentText(item.content, ['input_text'])
        if (text !== '') messages.push({ role: 'user', content: text })
      } else if (role === 'assistant') {
        const text = contentText(item.content, ['output_text'])
        if (text !== '') messages.push({ role: 'assistant', content: text })
      }
    } else if (type === 'function_call') {
      const callId = asString(item.call_id) || `call_shim_${callSeq++}`
      emittedCallIds.add(callId)
      messages.push({
        role: 'assistant', content: null,
        tool_calls: [{ id: callId, type: 'function', function: { name: asString(item.name), arguments: asString(item.arguments) } }],
      })
    } else if (type === 'function_call_output') {
      const callId = asString(item.call_id)
      // 内联紧跟其 tool_call（chat 面序列约束：tool 消息必须贴着前驱
      // assistant.tool_calls）；codex 历史里 call 恒先于 output，不在册=
      // 悬空输出，丢弃。
      if (emittedCallIds.has(callId)) messages.push({ role: 'tool', tool_call_id: callId, content: outputPayloadText(item.output) })
    } else if (type === 'local_shell_call' || type === 'custom_tool_call') {
      const callId = asString(item.call_id)
      if (callId === '') continue
      emittedCallIds.add(callId)
      const args = type === 'custom_tool_call' ? asString(item.input) : JSON.stringify(item.action ?? {})
      messages.push({
        role: 'assistant', content: null,
        tool_calls: [{ id: callId, type: 'function', function: { name: type === 'custom_tool_call' ? asString(item.name) : 'shell', arguments: args } }],
      })
    } else if (type === 'custom_tool_call_output') {
      const callId = asString(item.call_id)
      if (emittedCallIds.has(callId)) messages.push({ role: 'tool', tool_call_id: callId, content: outputPayloadText(item.output) })
    }
    // Reasoning / ToolSearchCall / AgentMessage / 其他：chat 面无对应物，跳过。
  }
  const tools = asArray(r.tools)
    .map(asObj)
    .filter(t => asString(t.type) === 'function')
    .map(t => ({ type: 'function', function: { name: asString(t.name), description: asString(t.description), parameters: t.parameters ?? { type: 'object', properties: {} } } }))
  const body: Record<string, unknown> = { model, messages, stream: false }
  if (tools.length > 0) body.tools = tools
  if (r.tool_choice !== undefined && r.tool_choice !== null) body.tool_choice = r.tool_choice
  if (typeof r.parallel_tool_calls === 'boolean') body.parallel_tool_calls = r.parallel_tool_calls
  return { ok: true, body }
}

/** chat choice → Responses output 项数组（纯）：文本→message 件、tool_calls→
 *  function_call 件（arguments 保持字符串——ResponseItem 契约）。 */
export function chatChoiceToResponseItems(choice: unknown): Item[] {
  const message = asObj(asObj(choice).message)
  const items: Item[] = []
  const text = typeof message.content === 'string' ? message.content : contentText(message.content, ['text', 'output_text'])
  if (text !== '') items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
  asArray(message.tool_calls).forEach((raw, i) => {
    const tc = asObj(raw)
    const fn = asObj(tc.function)
    items.push({ type: 'function_call', name: asString(fn.name), arguments: asString(fn.arguments), call_id: asString(tc.id) || `call_shim_${i}` })
  })
  return items
}

/** 一帧 SSE（`event:` 行 + `data:` 行；data JSON 自带 type——codex 按它判型）。 */
export function sseFrame(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
}

/** chat/completions 应答 → 完整 SSE 流（纯）：created → 各 output_item.done →
 *  completed（usage 映射 + end_turn=finish_reason==='stop'）。 */
export function chatResponseToSse(chat: unknown): string {
  const c = asObj(chat)
  const id = asString(c.id) || 'chatcmpl-shim'
  const choice = asArray(c.choices)[0]
  const usage = asObj(c.usage)
  const frames: string[] = [sseFrame('response.created', { response: { id } })]
  for (const item of chatChoiceToResponseItems(choice)) {
    frames.push(sseFrame('response.output_item.done', { item }))
  }
  const finish = asString(asObj(choice).finish_reason)
  const completed: Record<string, unknown> = { id }
  if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
    completed.usage = {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: Number(usage.completion_tokens ?? 0),
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: Number(usage.total_tokens ?? (Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0))),
    }
  }
  completed.end_turn = finish === 'stop'
  frames.push(sseFrame('response.completed', { response: completed }))
  return frames.join('')
}

export interface CodexShimHandle { port: number; close(): Promise<void> }

/**
 * 回环垫片服务器：POST …/responses → 上游 chat/completions → SSE。
 * 仅绑 host（默认 127.0.0.1——垫片带 key 裸听全网是反模式）；上游错误以 502
 * JSON 中继（codex 走自家 5xx 重试面）；/responses/compact 诚实 404（压缩
 * 面未实现——长会话触发时 codex 报错但不崩，已知限）。
 */
export function startCodexShim(opts: {
  port: number
  upstream: string
  apiKey: string
  host?: string
  model?: string
  fetchImpl?: typeof fetch
  upstreamTimeoutMs?: number
}): Promise<CodexShimHandle> {
  const upstream = opts.upstream.replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const server: Server = createServer((req, res) => {
    const path = req.url ?? ''
    if (req.method === 'GET' && path.startsWith('/healthz')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method !== 'POST' || !(path.endsWith('/responses') || path.includes('/responses/'))) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `codex-shim：未知路径 ${path}（只服务 */responses）` } }))
      return
    }
    if (path.includes('/responses/compact')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'codex-shim：compact 压缩面未实现（已知限）' } }))
      return
    }
    const parts: Buffer[] = []
    req.on('data', (chunk: Buffer) => { parts.push(chunk) })
    req.on('end', async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(parts).toString('utf8'))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'codex-shim：请求体不是合法 JSON' } }))
        return
      }
      const translated = responsesRequestToChat(parsed, opts.model)
      if (process.env.STARDECK_SHIM_DEBUG === '1') {
        const tools = asArray(translated.ok ? translated.body.tools : [])
          .map(asObj)
          .map(t => asString(asObj(t.function).name))
        console.error(`[shim] req: model=${asString(asObj(parsed).model)} messages=${asArray(translated.ok ? translated.body.messages : []).length} tools=${tools.length === 0 ? 'NONE' : tools.join(',')}`)
      }
      if (!translated.ok) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `codex-shim：${translated.error}` } }))
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, opts.upstreamTimeoutMs ?? 300_000)
      try {
        const upstreamRes = await doFetch(`${upstream}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(translated.body),
          signal: controller.signal,
        })
        const text = await upstreamRes.text()
        if (!upstreamRes.ok) {
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: `codex-shim：上游 ${upstreamRes.status}——${text.slice(0, 300)}` } }))
          return
        }
        let chat: unknown
        try {
          chat = JSON.parse(text)
        } catch {
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'codex-shim：上游应答不是 JSON' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        res.end(chatResponseToSse(chat))
      } catch (err) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `codex-shim：上游请求失败——${err instanceof Error ? err.message : String(err)}` } }))
      } finally {
        clearTimeout(timer)
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : opts.port
      resolve({
        port: boundPort,
        close: () => new Promise<void>((resolveClose, rejectClose) => { server.close(err => (err === undefined ? resolveClose() : rejectClose(err))) }),
      })
    })
  })
}

/** codex 侧 provider 定义的 -c 旗组（纯，测试管辖）：与 codexExecArgs 同一
 *  TOML 透传语义——base_url 指向垫片、Responses wire、免 OpenAI 鉴权。 */
export function codexShimProviderArgs(base: string): string[] {
  return [
    '-c', 'model_provider=stardeck_shim',
    '-c', 'model_providers.stardeck_shim.name="stardeck shim"',
    '-c', `model_providers.stardeck_shim.base_url="${base.replace(/\/+$/, '')}"`,
    '-c', 'model_providers.stardeck_shim.wire_api="responses"',
    '-c', 'model_providers.stardeck_shim.requires_openai_auth=false',
  ]
}
