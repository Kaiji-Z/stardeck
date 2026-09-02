// stardeck 注入的大副侧工具扩展（征召时自动重写——勿手改）。
// 工具经 daemon HTTP 面（/warroom/api/tools/call）回账；大副无 attemptId、
// 无 war_claim/war_submit——分诊/计划/发布即产出。与 MCP 桥同名同义。
import { Type } from "typebox"

const HTTP = process.env.STARDECK_HTTP ?? "http://127.0.0.1:3970"
const AGENT = process.env.STARDECK_AGENT ?? "staff-20260902"

async function call(tool: string, toolArgs: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${HTTP}/warroom/api/tools/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: tool, arguments: toolArgs, agentId: AGENT }),
  })
  const out = (await res.json()) as { ok?: boolean; result?: unknown; error?: string }
  return out.ok === true ? JSON.stringify(out.result) : `工具失败：${out.error ?? res.status}`
}

export default function (pi: { registerTool: (tool: unknown) => void }) {
  pi.registerTool({
    name: "war_board",
    label: "war_board",
    description: "战略任务栏：跨工作区查看全部任务与任务书全文。呈报/发布前先看板。",
    promptSnippet: "war_board: 看 stardeck 任务栏全局",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: Record<string, never>) {
      return { content: [{ type: "text" as const, text: await call("war_board", {}) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_triage",
    label: "war_triage",
    description: "大副接令第一轮报档位：L0 简单直发 | L1 复杂呈批 | L2 不明确先澄清。每命令只分诊一次。",
    promptSnippet: "war_triage: 报分诊档位 L0/L1/L2",
    parameters: Type.Object({
      command_id: Type.String(),
      grade: Type.String(),
      reason: Type.String(),
      confidence: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId: string, params: { command_id: string; grade: string; reason: string; confidence?: number }) {
      return { content: [{ type: "text" as const, text: await call("war_triage", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_plan",
    label: "war_plan",
    description: "L1/L2 呈计划草案待舰长批准（目标、≤5 步骤、工作区、风险与回退；批准前 war_publish 会被拦）。",
    promptSnippet: "war_plan: 呈一页纸计划待批",
    parameters: Type.Object({
      command_id: Type.String(),
      plan: Type.String(),
    }),
    async execute(_toolCallId: string, params: { command_id: string; plan: string }) {
      return { content: [{ type: "text" as const, text: await call("war_plan", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_publish",
    label: "war_publish",
    description: "发布任务书上任务栏（务必携带 commandId——发布后命令卡自动标记已批准）。L0 直发；L1/L2 计划批准后发布。",
    promptSnippet: "war_publish: 发布任务书（带 commandId）",
    parameters: Type.Object({
      title: Type.String(),
      brief: Type.String(),
      acceptance: Type.String(),
      priority: Type.Optional(Type.String()),
      quality: Type.Optional(Type.String()),
      deps: Type.Optional(Type.Array(Type.String())),
      cron: Type.Optional(Type.String()),
      repo: Type.Optional(Type.String()),
      workspace: Type.Optional(Type.String()),
      commandId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: { title: string; brief: string; acceptance: string; [k: string]: unknown }) {
      return { content: [{ type: "text" as const, text: await call("war_publish", params) }], details: {} }
    },
  })
  pi.registerTool({
    name: "war_abandon_command",
    label: "war_abandon_command",
    description: "命令意图无法成案时废弃命令（附一句人话原因——慎用；已批准出任务的不能废）。",
    promptSnippet: "war_abandon_command: 废弃无法成案的命令",
    parameters: Type.Object({
      command_id: Type.String(),
      reason: Type.String(),
    }),
    async execute(_toolCallId: string, params: { command_id: string; reason: string }) {
      return { content: [{ type: "text" as const, text: await call("war_abandon_command", params) }], details: {} }
    },
  })
}
