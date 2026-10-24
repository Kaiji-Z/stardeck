/**
 * D29 内置代理舰长 loop：ai SDK 工具调度循环（参考 lookatstudy agent-engine
 * 形态——streamText+tool+stepCountIs）。
 *
 * 职责边界（宪法对齐）：loop 只「想」和「看」——system/user=proxyOrderFor 载荷
 * （块文法教学单源，快照门管辖不变），tools=只读三件（board/digest/ledger，进程
 * 内闭包直读投影）；终答文本交 daemon 收割管线（applyProxyReply）落账，loop 本身
 * 不写任何账本。历史预算=bridgeHistoryWindow 尾窗（携史已在 order 正文里，与
 * spawn 席同一预算纪律）。看门狗=整轮 AbortSignal.timeout（首 token/步间停摆一律
 * 掐）。流式：onTextDelta 回调（打字机入屏是可选刀，本刀只供日志/未来 UI）。
 *
 * 供给：OpenAI 兼容面（z.ai GLM）。旗语义（D32 翻默认，舰长拍板「打开项目
 * 即最佳聊天体验」）：Z_AI_* 齐即 enabled——内置 loop 成为聊天窗默认扮演者；
 * STARDECK_PROXY_LOOP=0 显式关（回落舰队 CLI 席）；无 key=未开（诚实走舰队席，
 * 不静默）。
 * @module stardeck/proxy-loop
 */
import { streamText, tool, stepCountIs, type ToolSet } from 'ai'
import { z } from 'zod'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

export interface ProxyLoopEnv {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  /** D37 思考强度：''=自动（不干预请求体）/ 'fast'=关思考 / 'deep'=开思考——
   *  仅当 baseUrl 命中思考方言表时生效（bodyPatch 打补丁），其余家族静默自动。 */
  effort: '' | 'fast' | 'deep'
}

/** 旗面解析（纯）：基址+key 齐即 enabled（D32 翻默认——BYOK loop 是聊天窗
 *  首选扮演者），STARDECK_PROXY_LOOP=0 显式关。基址去尾斜杠（z.ai 惯例
 *  URL 常带 /；openai-compatible 拼路径不吃双斜杠）。 */
export function proxyLoopEnvOf(env: NodeJS.ProcessEnv): ProxyLoopEnv {
  const baseUrl = (env.Z_AI_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const apiKey = (env.Z_AI_API_KEY ?? '').trim()
  const model = (env.STARDECK_PROXY_LOOP_MODEL ?? 'glm-5.3').trim()
  const effortRaw = (env.STARDECK_PROXY_LOOP_EFFORT ?? '').trim()
  const effort: '' | 'fast' | 'deep' = effortRaw === 'fast' || effortRaw === 'deep' ? effortRaw : ''
  return { enabled: baseUrl !== '' && apiKey !== '' && env.STARDECK_PROXY_LOOP !== '0', baseUrl, apiKey, model, effort }
}

/** D33 段3：config.loop 段与 env 的合并（纯）——config 优先（窗口刚改的先生效），
 *  env 回落，两处皆无=未配。硬关旗 STARDECK_PROXY_LOOP=0 恒压一切。 */
export function mergeLoopEnv(env: NodeJS.ProcessEnv, cfg: { model: string; baseUrl: string; apiKey: string; effort?: '' | 'fast' | 'deep' }): ProxyLoopEnv {
  return proxyLoopEnvOf({
    ...env,
    Z_AI_BASE_URL: cfg.baseUrl !== '' ? cfg.baseUrl : env.Z_AI_BASE_URL,
    Z_AI_API_KEY: cfg.apiKey !== '' ? cfg.apiKey : env.Z_AI_API_KEY,
    STARDECK_PROXY_LOOP_MODEL: cfg.model !== '' ? cfg.model : env.STARDECK_PROXY_LOOP_MODEL,
    STARDECK_PROXY_LOOP_EFFORT: cfg.effort !== undefined && cfg.effort !== '' ? cfg.effort : env.STARDECK_PROXY_LOOP_EFFORT,
  })
}

export interface ProxyLoopDeps {
  /** 只读投影闭包（daemon 传入——与 MCP 座席面 read_* 同源同数据）。 */
  reads: { board: () => Promise<unknown>; digest: () => Promise<unknown>; ledger: () => Promise<unknown> }
  onTextDelta?: (delta: string) => void
  /** D36 思考流（lookatstudy/DSH 同形）：模型 reasoning 增量（GLM 的
   *  reasoning_content 经 @ai-sdk/openai-compatible 映射为 reasoning part）。 */
  onReasoningDelta?: (delta: string) => void
  /** D33 段2（lookatstudy tool-call part 同形）：工具步骤透明化——start=模型发起
   *  调用、done=结果返回。UI 内联 chip 呈现，让「它在查账」可见。
   *  D36：第三参 detail=参数/结果摘要（start=入参、done=出参，截断白噪声）。 */
  onToolStep?: (toolName: string, phase: 'start' | 'done', detail?: string) => void
  /** 整轮看门狗毫秒（缺省 180s——超时 abort，调用侧降级）。 */
  watchdogMs?: number
  /** D37 手动停止信号（daemon 持 AbortController；与看门狗组合生效）。 */
  abortSignal?: AbortSignal
}

/** 工具参数/结果摘要（D36）：压平空白+截断——chip 行内可读，title 全文。 */
export function summarizeStepDetail(v: unknown, max: number): string {
  let s = ''
  try { s = typeof v === 'string' ? v : JSON.stringify(v) ?? '' } catch { s = String(v) }
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** D37 思考方言表（照搬 lookatstudy reasoning-effort.ts 的家族口径扩表）：
 *  baseUrl 命中 → 按档位产出请求体补丁（fast=关思考，deep=开思考）。 */
const THINKING_DIALECTS: Array<{ match: RegExp; patch: (fast: boolean) => Record<string, unknown> }> = [
  { match: /z\.ai|bigmodel|glm/i, patch: fast => (fast ? { thinking: { type: 'disabled' }, reasoning_effort: 'low' } : { thinking: { type: 'enabled' } }) },
  { match: /deepseek|moonshot|minimax/i, patch: fast => ({ thinking: { type: fast ? 'disabled' : 'enabled' } }) },
  { match: /dashscope/i, patch: fast => ({ enable_thinking: !fast }) },
]

/** D37：供应商/模型是否命中思考方言表（UI 门控数据源——不支持的恒自动）。
 *  匹配源=baseUrl+模型串（GLM 走自建代理端点时 baseUrl 是 127.0.0.1，模型
 *  id 的 glm 字样仍可识别——家法同 lookatstudy 的 llmFamilyOf 双源嗅探）。 */
export function thinkingDialectSupported(baseUrl: string, model: string): boolean {
  return THINKING_DIALECTS.some(d => d.match.test(`${baseUrl} ${model}`))
}

/** D37 bodyPatch（照搬 lookatstudy withBodyPatch）：fetch 包装——请求体 JSON 解开、
 *  浅并入方言补丁再序列化（openai-compatible SDK 无这些方言参数的原生面）。 */
function withBodyPatch(fetchFn: typeof fetch, patch: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body !== undefined && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>
        init = { ...init, body: JSON.stringify({ ...body, ...patch }) }
      } catch { /* 非 JSON 体原样透传 */ }
    }
    return fetchFn(input, init)
  }) as typeof fetch
}

export interface ProxyLoopResult {
  /** 终答全文（trim 过——空串由调用侧按失败降级，不入账）。 */
  text: string
  steps: number
  toolCalls: number
  /** D37 真实计量（includeUsage 下网关回报；流失败时 undefined——诚实缺席）。 */
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number }
  /** D37 回合耗时（毫秒）。 */
  elapsedMs: number
}

/** 只读三件（与 MCP 座席面同名同义——一份心智两处用）。写工具一件不出：
 *  代理舰长的「写」只有终答里的块，收割在 daemon（出口协议红线）。 */
function readTools(deps: ProxyLoopDeps, counter: { n: number }): ToolSet {
  return {
    read_board: tool({
      description: '读板投影（只读）：命令与任务清单。想核对话里数字时用。',
      inputSchema: z.object({}),
      execute: async () => { counter.n++; return deps.reads.board() },
    }),
    read_digest: tool({
      description: '读待决摘要（只读）：待签/待验收/待答复等当前要舰长出手的事。',
      inputSchema: z.object({}),
      execute: async () => { counter.n++; return deps.reads.digest() },
    }),
    read_ledger: tool({
      description: '读近期账本切片（只读）：命令尾 30+任务尾 30，按时间升序。',
      inputSchema: z.object({}),
      execute: async () => { counter.n++; return deps.reads.ledger() },
    }),
  }
}

/** 跑一轮：order 正文进 user 消息，模型可自查三件只读工具，终答全文返回。
 *  抛错=本轮失手（网络/网关/看门狗/手动停止）——调用侧诚实降级舰队席
 *  （手动停止由调用侧按自己的 abort 旗区分，不降级）。 */
export async function runProxyLoop(order: string, env: ProxyLoopEnv, deps: ProxyLoopDeps): Promise<ProxyLoopResult> {
  const t0 = Date.now()
  // D37 思考强度：方言命中（baseUrl+模型双源嗅探）且选了档位才打补丁（''/缺省=自动零干预）。
  const effort: '' | 'fast' | 'deep' = env.effort === 'fast' || env.effort === 'deep' ? env.effort : ''
  const dialect = THINKING_DIALECTS.find(d => d.match.test(`${env.baseUrl} ${env.model}`))
  const patch = effort !== '' && dialect !== undefined ? dialect.patch(effort === 'fast') : null
  const provider = createOpenAICompatible({
    name: 'stardeck-proxy-loop',
    baseURL: env.baseUrl,
    apiKey: env.apiKey,
    includeUsage: true, // D37：stream_options.include_usage——网关回报真实 usage
    ...(patch !== null ? { fetch: withBodyPatch(globalThis.fetch, patch) } : {}),
  })
  const counter = { n: 0 }
  const watchdog = AbortSignal.timeout(deps.watchdogMs ?? 180_000)
  const result = streamText({
    model: provider.chatModel(env.model),
    messages: [{ role: 'user', content: order }],
    tools: readTools(deps, counter),
    stopWhen: stepCountIs(6),
    abortSignal: deps.abortSignal !== undefined ? AbortSignal.any([deps.abortSignal, watchdog]) : watchdog,
  })
  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text
      deps.onTextDelta?.(part.text)
    } else if (part.type === 'reasoning-delta' || part.type === 'reasoning') {
      // ai v5 正名 reasoning-delta；旧命名 reasoning 也兜（part.text 场地两侧同名）。
      const d = typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''
      if (d !== '') deps.onReasoningDelta?.(d)
    } else if (part.type === 'tool-call') {
      deps.onToolStep?.(part.toolName, 'start', summarizeStepDetail((part as { input?: unknown }).input, 60))
    } else if (part.type === 'tool-result') {
      const r = (part as { output?: unknown; result?: unknown }).output ?? (part as { result?: unknown }).result
      deps.onToolStep?.(part.toolName, 'done', summarizeStepDetail(r, 100))
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error))
    }
  }
  const steps = (await result.steps).length
  // usage promise 在流失败路径可能 reject——catch 成 undefined（诚实缺席）。
  // 字段名=spec v2 面名（inputTokens/outputTokens——1.0.58 实测，别按 v3 的
  // promptTokens 读，读错=全 undefined 静默）。
  const u = await result.usage.catch(() => undefined)
  const usage = u === undefined ? undefined : {
    promptTokens: typeof u.inputTokens === 'number' && Number.isFinite(u.inputTokens) ? u.inputTokens : undefined,
    completionTokens: typeof u.outputTokens === 'number' && Number.isFinite(u.outputTokens) ? u.outputTokens : undefined,
    reasoningTokens: typeof u.reasoningTokens === 'number' ? u.reasoningTokens : undefined,
  }
  return { text: text.trim(), steps, toolCalls: counter.n, usage, elapsedMs: Date.now() - t0 }
}
