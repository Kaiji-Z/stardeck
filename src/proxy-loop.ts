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
}

/** 旗面解析（纯）：基址+key 齐即 enabled（D32 翻默认——BYOK loop 是聊天窗
 *  首选扮演者），STARDECK_PROXY_LOOP=0 显式关。基址去尾斜杠（z.ai 惯例
 *  URL 常带 /；openai-compatible 拼路径不吃双斜杠）。 */
export function proxyLoopEnvOf(env: NodeJS.ProcessEnv): ProxyLoopEnv {
  const baseUrl = (env.Z_AI_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const apiKey = (env.Z_AI_API_KEY ?? '').trim()
  const model = (env.STARDECK_PROXY_LOOP_MODEL ?? 'glm-5.3').trim()
  return { enabled: baseUrl !== '' && apiKey !== '' && env.STARDECK_PROXY_LOOP !== '0', baseUrl, apiKey, model }
}

export interface ProxyLoopDeps {
  /** 只读投影闭包（daemon 传入——与 MCP 座席面 read_* 同源同数据）。 */
  reads: { board: () => Promise<unknown>; digest: () => Promise<unknown>; ledger: () => Promise<unknown> }
  onTextDelta?: (delta: string) => void
  /** 整轮看门狗毫秒（缺省 180s——超时 abort，调用侧降级）。 */
  watchdogMs?: number
}

export interface ProxyLoopResult {
  /** 终答全文（trim 过——空串由调用侧按失败降级，不入账）。 */
  text: string
  steps: number
  toolCalls: number
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
 *  抛错=本轮失手（网络/网关/看门狗）——调用侧诚实降级舰队席。 */
export async function runProxyLoop(order: string, env: ProxyLoopEnv, deps: ProxyLoopDeps): Promise<ProxyLoopResult> {
  const provider = createOpenAICompatible({ name: 'stardeck-proxy-loop', baseURL: env.baseUrl, apiKey: env.apiKey })
  const counter = { n: 0 }
  const result = streamText({
    model: provider.chatModel(env.model),
    messages: [{ role: 'user', content: order }],
    tools: readTools(deps, counter),
    stopWhen: stepCountIs(6),
    abortSignal: AbortSignal.timeout(deps.watchdogMs ?? 180_000),
  })
  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text
      deps.onTextDelta?.(part.text)
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error))
    }
  }
  const steps = (await result.steps).length
  return { text: text.trim(), steps, toolCalls: counter.n }
}
