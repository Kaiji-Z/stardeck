/**
 * stardeck 大副外聘（HANDOFF 迭代候选①）：独立形态没有宿主引信（relay
 * 面缺位）——v0.1 的 draft 命令与定时令都靠「能调 MCP 的外部 agent」手动
 * 中继。本模块就是外聘大副的人事处：
 *   - staffWorklist（纯）：哪些命令需要大副动手——接令（分诊→按档位成案）/
 *     呈改计划 / 发布；
 *   - staffOrderFor（纯）：外聘征召令（staffPersonaText 人设正典 + stardeck
 *     MCP 接入面 + 逐件工单；接令工单内嵌 relayPromptFor 转达正典，快照门
 *     由 tests/staff.test.ts 的 fixtures 管辖——同 prompts-snapshot 纪律）；
 *   - spawnStaffAgent：框定 spawn（大副随舰队——复用 executor 三席无头框定
 *     法：opencode/pi/zcode；codex 实弹受阻回退 opencode。大副不是执行者：
 *     无 attemptId、无 war_submit，产出就是账本上的分诊/计划/发布）。
 * daemon 巡检外挂 staffTick（15s，config.staff 开关）：定时令到点补
 * directive_dispatched → 有工单且大副不在役 → spawn。等舰长定夺（计划
 * pending）不是大副的活——工单判定的「等」就是诚实。
 * @module stardeck/staff
 */

import type { Directive, DirectiveGrade } from './directives.ts'
import { relayPromptFor, staffPersonaText } from './prompts.ts'
import type { FeatureFlags } from './flags.ts'
import { spawnHeadlessOpencode, spawnHeadlessPi, spawnHeadlessZcode, spawnHeadlessClaude, type ExecutorSession } from './executor.ts'

export type StaffWorkKind = 'intake' | 'plan' | 'publish'

export interface StaffWorkItem {
  commandId: string
  kind: StaffWorkKind
  /** 命令原文（工单展示用）。 */
  text: string
  /** 已分诊档位（plan/publish 单携带）。 */
  grade?: DirectiveGrade
  /** 计划态（plan/publish 单携带）。 */
  planStatus?: 'pending' | 'approved' | 'rejected'
  /** 舰长驳回理由（重拟工单随行——呈改计划的修改依据）。 */
  planRejectedReason?: string
  /** 最新计划稿（rejected 复用面/publish 依稿成书）。 */
  planText?: string
  /** 战线名（可选展示）。 */
  name?: string
}

/**
 * 大副工单（纯）。不出单的三类：终态（approved/cancelled）；未到点的定时令
 * （schedule 未 dispatched——引信语义，daemon tick 到点补）；计划待批
 * （plan pending——等舰长在命令卡上定夺，不是大副的活）。
 * received/talking 但未分诊=接令中断重试（外聘形态无会话可续，重开一轮）。
 */
export function staffWorklist(directives: ReadonlyArray<Directive>): StaffWorkItem[] {
  const out: StaffWorkItem[] = []
  for (const d of directives) {
    if (d.status === 'approved' || d.status === 'cancelled') continue
    if (d.schedule !== undefined && d.schedule.dispatchedAt === undefined) continue
    const name = d.name !== undefined ? { name: d.name } : {}
    if (d.grade === undefined) {
      out.push({ commandId: d.id, kind: 'intake', text: d.text, ...name })
      continue
    }
    if (d.grade === 'L0') {
      out.push({ commandId: d.id, kind: 'publish', text: d.text, grade: d.grade, ...name })
      continue
    }
    // L1/L2：先计划后做（staff-plan 硬门在 war_publish 工具侧）。
    if (d.plan === undefined || d.plan.status === 'rejected') {
      out.push({
        commandId: d.id, kind: 'plan', text: d.text, grade: d.grade,
        ...(d.plan !== undefined ? { planStatus: d.plan.status, planText: d.plan.text } : {}),
        ...(d.plan !== undefined && d.plan.reason !== undefined ? { planRejectedReason: d.plan.reason } : {}),
        ...name,
      })
    } else if (d.plan.status === 'approved') {
      out.push({ commandId: d.id, kind: 'publish', text: d.text, grade: d.grade, planStatus: 'approved', planText: d.plan.text, ...name })
    }
  }
  return out
}

/**
 * 外聘大副征召令（纯；措辞改动必须过 tests/staff.test.ts 快照门——
 * `WARROOM_UPDATE_SNAPSHOTS=1 node --import tsx --test tests/staff.test.ts`）。
 * 接令工单内嵌 relayPromptFor 正典（分诊纪律+起草法全文随旗面），续办
 * 工单只给增量指引——不改正典措辞。
 */
export function staffOrderFor(items: ReadonlyArray<StaffWorkItem>, flags: FeatureFlags = {}, face: 'mcp' | 'pi-extension' | 'http' = 'mcp'): string {
  const surface = face === 'mcp'
    ? '【stardeck MCP 接入面】你是 stardeck 舰的外聘大副——本进程已通过 MCP 桥（server 名 stardeck）直连舰桥，war_* 工具全量可用。大副侧动词：war_triage 报档位、war_plan 呈计划、war_publish 发布任务书（务必携带 commandId，发布后命令卡自动标记已批准）。你没有 war_claim/war_submit——那是外勤执行者的出口；你的产出就是账本上的分诊、计划与发布，不要试图替外勤交证。'
    : face === 'http'
      ? '【stardeck 工具接入面】你是 stardeck 舰的外聘大副——本进程经 HTTP 直连舰桥（zcode 无头模式不加载项目 MCP：若本进程工具面里没有 war_* 工具，一律走这条通道，不要探测别的端口）。POST 端点=环境变量 STARDECK_HTTP 的值 + "/warroom/api/tools/call"；请求体 JSON：{"name":"<工具名>","arguments":{…},"agentId":环境变量 STARDECK_AGENT 的值}。必须用 node（process.execPath 或 node 脚本）发请求，恒 UTF-8——禁用 Windows 控制台 curl 拼 JSON（GBK 编码会把中文拼成乱码，乱码哨会拒收并打回重交）。大副侧动词：war_triage 报档位、war_plan 呈计划、war_publish 发布任务书（务必携带 commandId，发布后命令卡自动标记已批准）、war_board 看全局、war_abandon_command 弃案。你没有 war_claim/war_submit——那是外勤执行者的出口；你的产出就是账本上的分诊、计划与发布，不要试图替外勤交证。'
      : '【stardeck 工具接入面】你是 stardeck 舰的外聘大副——本进程已由 stardeck 扩展注册大副侧工具（war_triage / war_plan / war_publish / war_board / war_abandon_command，经 HTTP 回连舰桥，与 MCP 同名同义）。大副侧动词：war_triage 报档位、war_plan 呈计划、war_publish 发布任务书（务必携带 commandId，发布后命令卡自动标记已批准）。你没有 war_claim/war_submit——那是外勤执行者的出口；你的产出就是账本上的分诊、计划与发布，不要试图替外勤交证。'
  const sections: string[] = [
    staffPersonaText(0),
    '',
    surface,
    '',
    `【本轮工单】共 ${items.length} 件，逐件办结（顺序处理，不挑单）：`,
  ]
  let n = 0
  for (const item of items) {
    if (item.kind === 'intake') {
      n += 1
      sections.push(`\n${divider(n, '接令：分诊 → 按档位成案')}\n${relayPromptFor({ id: item.commandId, text: item.text, createdAt: '', status: 'draft' }, flags)}`)
    }
  }
  for (const item of items) {
    if (item.kind !== 'plan') continue
    n += 1
    sections.push([
      `\n${divider(n, '呈改计划')}`,
      `命令号 ${item.commandId}（档位 ${item.grade ?? 'L1'}${item.planStatus === 'rejected' ? '，上一稿计划被舰长驳回' : '，尚未呈报计划'}）`,
      `命令原文：「${item.text}」`,
      ...(item.planText !== undefined ? [`上一稿计划（${item.planStatus === 'rejected' ? '被驳回——按舰长驳回意见修订后重呈' : '存档'}）：${item.planText}`] : []),
      ...(item.planRejectedReason !== undefined ? [`舰长驳回意见：「${item.planRejectedReason}」——按此修订再呈`] : []),
      '【处理】先勘察（war_board 看任务栏全局；需要理解目标项目就读其工作区——你脚下的目录只是作战位，不是目标项目），再 war_plan({command_id, plan}) 呈一页纸计划：目标、≤5 步骤、涉及工作区、风险与回退（≥10 字）。舰长批准后系统会另开一轮叫你发布——本单到「已呈待批」即办结。',
    ].join('\n'))
  }
  for (const item of items) {
    if (item.kind !== 'publish') continue
    n += 1
    if (item.planStatus === 'approved' && item.planText !== undefined) {
      sections.push([
        `\n${divider(n, '发布')}`,
        `命令号 ${item.commandId}（档位 ${item.grade ?? 'L1'}）计划已获舰长批准——按批准的计划成任务书，war_publish 发布（务必携带 commandId=${item.commandId}；标题一句话、brief 写背景/指引/边界、验收 ≤5 条可判定项，过系统 lint）。`,
        `命令原文：「${item.text}」`,
        `已批计划全文：${item.planText}`,
      ].join('\n'))
    } else {
      sections.push([
        `\n${divider(n, '发布')}`,
        `命令号 ${item.commandId} 已判 L0（简单直发）：按起草法直接 war_publish 轻任务书（标题一句话、brief 两三句、验收 ≤3 条可判定项，务必携带 commandId=${item.commandId}，无需舰长批准）。`,
        `命令原文：「${item.text}」`,
      ].join('\n'))
    }
  }
  sections.push([
    '',
    '【办结纪律】逐件推进到终态之一：已发布（war_publish 成功）/ 已呈计划待批 / 确实无法成案（war_abandon_command 附一句人话原因——慎用）。全办结即收工退出，不空转等待。发布被 lint 拦就按报错文案修稿重发；工具报错即纠错指引。禁止伪造账本、禁止对已终态命令动手、禁止替外勤执行者交证。',
  ].join('\n'))
  return sections.join('\n')
}

function divider(n: number, label: string): string {
  return `── 工单 ${n}（${label}）──`
}

export interface StaffSpawnArgs {
  /** 落地简报正文（staffOrderFor 产物）。 */
  brief: string
  workspacePath: string
  http: string
  agentId: string
  model: string
  /** 大副随舰队（定案 2026-09-02）：staffExecutorFor 解析后的席别。 */
  executor: string
  executorBin: string
  stateDir: string
}

/** 大副席别解析（纯）：舰队绑谁大副就跑谁——zcode/pi/claude 各自框定；
 * gemini/codex 实弹受阻（gemini 本机无 GEMINI_API_KEY；codex Windows 起不了
 * MCP 桥——README「执行者适配器」在档）——诚实回退 opencode，daemon 侧
 * 打点，不静默。 */
export function staffExecutorFor(fleet: string): 'opencode' | 'pi' | 'zcode' | 'claude' {
  if (fleet === 'pi' || fleet === 'zcode' || fleet === 'claude') return fleet
  return 'opencode'
}

const STAFF_PROMPT = 'Mission: read the file .stardeck/brief.md at the workspace root and execute it now. You are the first mate (大副) of the stardeck fleet. The stardeck tools (war_*) are already connected. Process every work item in the brief to its terminal state (published / plan pending captain approval / abandoned with reason), then finish.'

/** 框定 spawn 外聘大副（进程即生命——退出由 daemon staffTick 回收语义接管）。
 * 大副随舰队：zcode=--prompt --json+.mcp.json 桥；pi=--approve -p+大副侧扩展
 * （禁出口协议三件）；opencode=--auto --format json+MCP 注入（codex 回退至此）。
 * attachTaskId=agentId：行钩/退场扫描捕获大副原生会话号入 attach-map（键=
 * staff-<id>）——板上「任务会话」钮独立形态跳转的数据源。 */
export async function spawnStaffAgent(args: StaffSpawnArgs): Promise<ExecutorSession> {
  const common = {
    workspacePath: args.workspacePath,
    brief: args.brief,
    title: `stardeck:staff:${args.agentId}`,
    http: args.http,
    agentId: args.agentId,
    stateDir: args.stateDir,
    role: 'staff' as const,
    attachTaskId: args.agentId,
    prompt: STAFF_PROMPT,
  }
  if (args.executor === 'zcode') {
    // zcode 模型串不透传（引擎吃自身 config 的 provider 条目）。
    return spawnHeadlessZcode({ ...common, executorBin: args.executorBin })
  }
  if (args.executor === 'claude') {
    return spawnHeadlessClaude({ ...common, model: args.model, executorBin: args.executorBin })
  }
  if (args.executor === 'pi') {
    return spawnHeadlessPi({ ...common, model: args.model, executorBin: args.executorBin })
  }
  return spawnHeadlessOpencode({ ...common, model: args.model, executorBin: args.executorBin })
}
