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

import type { Directive, DirectiveEvent, DirectiveGrade } from './directives.ts'
import { relayPromptFor, staffPersonaText } from './prompts.ts'
import type { FeatureFlags } from './flags.ts'
import { readAttachMap, spawnHeadlessOpencode, spawnHeadlessPi, spawnHeadlessZcode, spawnHeadlessClaude, spawnHeadlessDsh, spawnHeadlessCodexStaff, type ExecutorSession } from './executor.ts'
import { readSessionHistory } from './history.ts'

export type StaffWorkKind = 'intake' | 'resolve' | 'plan' | 'publish'

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
  /** 澄清成案单携带：此前你方提问 / 舰长答复 / 轮次（resolved 单）。 */
  questions?: string[]
  answer?: string
  round?: number
}

/**
 * 大副工单（纯）。不出单的四类：终态（approved/cancelled）；未到点的定时令
 * （schedule 未 dispatched——引信语义，daemon tick 到点补）；计划待批
 * （plan pending——等舰长在命令卡上定夺，不是大副的活）；澄清挂起
 * （clarification pending——等舰长答复。工单空 ⇒ staffTick 退场罚时不触发：
 * 「等」就是诚实）。received/talking 但未分诊=接令中断重试（外聘形态无会话
 * 可续，重开一轮）；澄清 answered 且未呈计划=答复成案单（带问答史重开）。
 */
export function staffWorklist(directives: ReadonlyArray<Directive>): StaffWorkItem[] {
  const out: StaffWorkItem[] = []
  for (const d of directives) {
    if (d.status === 'approved' || d.status === 'cancelled') continue
    if (d.schedule !== undefined && d.schedule.dispatchedAt === undefined) continue
    const name = d.name !== undefined ? { name: d.name } : {}
    // 澄清挂起：等舰长答复——不出单（退场罚时的机械豁免就在这一行）。
    if (d.clarification?.status === 'pending') continue
    // 答复已入账且尚无在手计划稿：成案单（带问答史；已呈计划/已批的交常规
    // 路由——rejected 也走成案单，答复+驳回意见一并是重拟依据）。
    if (d.clarification?.status === 'answered' && (d.plan === undefined || d.plan.status === 'rejected')) {
      out.push({
        commandId: d.id, kind: 'resolve', text: d.text,
        questions: d.clarification.questions,
        ...(d.clarification.answer !== undefined ? { answer: d.clarification.answer } : {}),
        round: d.clarification.round,
        ...(d.plan !== undefined ? { planStatus: d.plan.status, planText: d.plan.text } : {}),
        ...(d.plan !== undefined && d.plan.reason !== undefined ? { planRejectedReason: d.plan.reason } : {}),
        ...name,
      })
      continue
    }
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

// ---------- 澄清协议（2026-09-08）：输入成熟度预评 + 结构化块解析 ----------

/** 输入成熟度四判型：vague=连要做什么都不明；missing-acceptance=缺验收；
 * missing-nongoals=缺边界；mature=五项自检无缺口。 */
export type InputVerdict = 'mature' | 'missing-acceptance' | 'missing-nongoals' | 'vague'

/**
 * 舰长命令对任务书五项的机械预评（纯，启发式）。角色是**预过滤而非裁决**：
 * verdict 只调制征召令的处置指引（缺什么点什么），最终问不问由大副按起草法
 * 自行判断——无歧义细节可自行补全的照常成案，不强问（问多了仪式吃掉小任务）。
 */
export function inputMaturityOf(text: string): { verdict: InputVerdict; gaps: string[] } {
  const t = text.trim()
  const hasAction = /做|加|修|写|建|删|改|重构|实现|发布|创建|更新|迁移|清理|支持|安装|配置|排查|交付|开发|翻译|部署|生成/.test(t)
  const hasAcceptance = /验收|标准|判据|退出码|测试|校验|直到|要求|必须|包含|通过|跑通|可运行|报错|检查|通过后/.test(t)
  const hasBoundary = /不要|别|不得|禁止|非目标|勿|避免|仅限|不许|只(许|能|改|做|动|碰)/.test(t)
  if (!hasAction && t.length < 24) return { verdict: 'vague', gaps: ['目标（要做什么）'] }
  if (!hasAcceptance) return { verdict: 'missing-acceptance', gaps: ['验收标准（怎么算完成）'] }
  if (!hasBoundary) return { verdict: 'missing-nongoals', gaps: ['非目标（明确不做什么）'] }
  return { verdict: 'mature', gaps: [] }
}

/** 大副最终答复里的结构化块：头行【澄清】（cmd-…）/【任务书】（cmd-…），
 * 正文归该块直至下一块头。解析器与收割全部纯函数——快照/单测管辖。 */
interface RawBlock { kind: '澄清' | '任务书'; commandId: string; lines: string[] }

function parseStaffBlocks(text: string): RawBlock[] {
  const out: RawBlock[] = []
  let cur: RawBlock | undefined
  for (const raw of text.split(/\r?\n/)) {
    const m = /^【(澄清|任务书)】[（(]((?:cmd-)?[A-Za-z0-9._-]+)[)）]/.exec(raw.trim())
    if (m !== null) {
      if (cur !== undefined) out.push(cur)
      cur = { kind: m[1] as RawBlock['kind'], commandId: m[2]!, lines: [] }
      continue
    }
    if (cur !== undefined) cur.lines.push(raw)
  }
  if (cur !== undefined) out.push(cur)
  return out
}

export interface ClarifyAsk {
  /** 原始行(剥编号,含选项标记)——账本 questions 存这个,板上完整可读。 */
  raw: string
  /** 问干(选项标记剥除后)。 */
  text: string
  /** 选项(「你帮我定」原样保留——舰长委托大副自答的信号);开放问=[]。 */
  options: string[]
}
export interface ClarifyBlock { commandId: string; asks: ClarifyAsk[] }
export interface BriefBlock { commandId: string; goal: string; background: string; acceptance: string; nonGoals: string; deliverables: string }

/** 选项标记解析(选择题式,2026-09-08):行内 ` A xxx / B yyy / C zzz` 段拆出
 * 选项数组;找不到标记=开放问(text=整行,options=[])。正典格式见
 * DESIGN.md D23「第三刀」段——解析从宽(标记识别失败=开放问,不硬拆)。 */
function splitAskLine(line: string): ClarifyAsk {
  const m = /\s?A[.、::]?\s+(\S.*)$/.exec(line)
  if (m === null) return { raw: line, text: line, options: [] }
  const text = line.slice(0, m.index).trim()
  const options = m[1]!
    .split(/\s+\/\s+/)
    .map(s => s.replace(/^[BC][.、::]?\s*/, '').trim())
    .filter(s => s !== '')
  return { raw: line, text: text === '' ? line : text, options }
}

/** 澄清轮数机械闸（D23 完整形态）：允许 2 轮问答——与征召令纪律「第 2 轮起
 * 必须定案」同数。第 3 轮起的澄清请求由收割层拒收（不入账+告警），命令停在
 * answered 态、成案单持续出——命令不死锁、也不被系统单方面弃案。 */
export const CLARIFY_ROUNDS_CAP = 2

/** 收割产物：events=可入账事件;rejectedClarifications=被机械闸拒收的过限澄清
 * （调用方告警——板面与日志都该知道大副想问而被闸下）。 */
export interface StaffHarvest { events: DirectiveEvent[]; rejectedClarifications: Array<{ commandId: string; round: number; questions: string[] }> }

/**
 * 大副最终答复 → 命令账本事件（纯核心，收割 glue 的解析+闸门层）：任务书优先
 * （同号既有任务书又澄清视为成案，澄清块弃）；澄清轮数过机械闸（clarifyRoundOf
 * 报告的既有轮数 +1 > CLARIFY_ROUNDS_CAP）的请求拒收。knownIds=本轮工单在册
 * 命令号：块点名未知命令号一律忽略（防幻觉写账）。
 */
export function staffHarvestEventsFromText(text: string, knownIds: ReadonlySet<string>, clarifyRoundOf: (commandId: string) => number, now = new Date()): StaffHarvest {
  const ts = now.toISOString()
  const events: DirectiveEvent[] = []
  const rejectedClarifications: StaffHarvest['rejectedClarifications'] = []
  const settled = new Set<string>()
  for (const b of briefBlocksOf(text)) {
    if (!knownIds.has(b.commandId) || settled.has(b.commandId)) continue
    settled.add(b.commandId)
    events.push({ type: 'directive_brief_ready', ts, directiveId: b.commandId, goal: b.goal, background: b.background, acceptance: b.acceptance, nonGoals: b.nonGoals, deliverables: b.deliverables })
  }
  for (const b of clarificationBlocksOf(text)) {
    if (!knownIds.has(b.commandId) || settled.has(b.commandId)) continue
    const nextRound = clarifyRoundOf(b.commandId) + 1
    if (nextRound > CLARIFY_ROUNDS_CAP) {
      rejectedClarifications.push({ commandId: b.commandId, round: nextRound, questions: b.asks.map(a => a.raw) })
      continue // 机械闸：过限请求不入账（调用方告警）
    }
    events.push({
      type: 'directive_clarification_requested', ts, directiveId: b.commandId,
      questions: b.asks.map(a => a.raw),
      options: b.asks.map(a => a.options),
    })
  }
  return { events, rejectedClarifications }
}

/**
 * 大副退场收割（daemon staffTick 在大副进程退出时调用）：经 attach-map 定位
 * 本轮原生会话 → 读最终答复 → {@link staffHarvestEventsFromText}。attach 映射
 * 缺席/历史读取失败/无块 → 空数组（下轮工单重试语义接管——诚实降级，不硬凑）。
 * knownIds=本轮工单在册命令号；clarifyRoundOf=命令当前澄清轮数（机械闸依据）。
 */
export function harvestStaffDirectiveEvents(stateDir: string, agentId: string, knownIds: ReadonlySet<string>, clarifyRoundOf: (commandId: string) => number, now = new Date()): StaffHarvest {
  const entry = readAttachMap(stateDir)[agentId]
  if (entry === undefined) return { events: [], rejectedClarifications: [] }
  let history: ReturnType<typeof readSessionHistory>
  try {
    history = readSessionHistory(entry.executor, entry.sessionId, entry.workspacePath)
  } catch {
    return { events: [], rejectedClarifications: [] }
  }
  const last = [...history.messages].reverse().find(m => m.role === 'assistant')
  if (last === undefined) return { events: [], rejectedClarifications: [] }
  const text = last.parts.filter(p => p.kind === 'text').map(p => p.text).join('\n')
  return staffHarvestEventsFromText(text, knownIds, clarifyRoundOf, now)
}

/** 澄清块解析（纯）：数字/连字符列表行=问题；行内 ` A x / B y / C z` 段=选项
 * （选择题式）。零问题=大副没按格式来——弃块（工单重试语义接管，不硬凑半块
 * 入账）。 */
export function clarificationBlocksOf(text: string): ClarifyBlock[] {
  const out: ClarifyBlock[] = []
  for (const b of parseStaffBlocks(text)) {
    if (b.kind !== '澄清') continue
    const asks = b.lines
      .map(l => l.trim())
      .filter(l => /^(?:\d+[.、)）]|[-*•])/.test(l))
      .map(l => splitAskLine(l.replace(/^(?:(?:\d+[.、)）]|[-*•])\s*)+/, '').trim()))
      .filter(a => a.raw !== '')
    if (asks.length > 0) out.push({ commandId: b.commandId, asks })
  }
  return out
}

/** 五项标签(宽容变体):GLM 实弹常把任务书写成 markdown 列表(`- 目标：…`),
 *  且在标签与冒号之间插括号注释(「非目标（起草法补全）：…」)——标签前容忍
 *  列表符、标签后容忍同行修饰,值=冒号后内容(修饰注释保留在值里,「原令未
 *  指明」这类大副标注是任务书的诚实部分)。 */
const BRIEF_LABELS: ReadonlyArray<readonly [key: keyof Omit<BriefBlock, 'commandId'>, re: RegExp]> = [
  ['goal', /^(?:[-*•]\s*)?目标[^:\n]*[:：]/],
  ['background', /^(?:[-*•]\s*)?背景(?:与约束)?[^:\n]*[:：]/],
  ['acceptance', /^(?:[-*•]\s*)?验收(?:标准)?[^:\n]*[:：]/],
  ['nonGoals', /^(?:[-*•]\s*)?非目标[^:\n]*[:：]/],
  ['deliverables', /^(?:[-*•]\s*)?(?:交付物|交付)[^:\n]*[:：]/],
]

/** 任务书块解析（纯）：五项标签行（值可多行，直至下一标签）。**五项缺一即
 * 弃**——协议完整性强排，半本任务书比没有更危险（误导后续成案轮）。 */
export function briefBlocksOf(text: string): BriefBlock[] {
  const out: BriefBlock[] = []
  for (const b of parseStaffBlocks(text)) {
    if (b.kind !== '任务书') continue
    const fields: Partial<Record<keyof Omit<BriefBlock, 'commandId'>, string[]>> = {}
    let cur: keyof Omit<BriefBlock, 'commandId'> | undefined
    for (const line of b.lines) {
      const trimmed = line.trim()
      const hit = BRIEF_LABELS.find(([, re]) => re.test(trimmed))
      if (hit !== undefined) {
        cur = hit[0]
        // 值=剥列表符、标签词(含变体)与冒号;括号注释保留(「原令未指明」是诚实标注)。
        const stripped = trimmed
          .replace(/^(?:[-*•]\s*)?/, '')
          .replace(/^(?:目标|背景与约束|背景|验收标准|验收|非目标|交付物|交付)/, '')
          .replace(/^[:：]\s*/, '')
          .trim()
        fields[cur] = [stripped]
      } else if (cur !== undefined && trimmed !== '') {
        fields[cur]!.push(trimmed)
      }
    }
    const get = (k: keyof Omit<BriefBlock, 'commandId'>): string => (fields[k] ?? []).join('\n').trim()
    const goal = get('goal')
    const background = get('background')
    const acceptance = get('acceptance')
    const nonGoals = get('nonGoals')
    const deliverables = get('deliverables')
    if (goal === '' || background === '' || acceptance === '' || nonGoals === '' || deliverables === '') continue
    out.push({ commandId: b.commandId, goal, background, acceptance, nonGoals, deliverables })
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
      ? '【stardeck 工具接入面】你是 stardeck 舰的外聘大副——本进程经 HTTP 直连舰桥（zcode/codex/dsh 无头形态不加载项目 MCP 或 MCP 工具不进模型面：若本进程工具面里没有 war_* 工具，一律走这条通道，不要探测别的端口）。POST 端点=环境变量 STARDECK_HTTP 的值 + "/warroom/api/tools/call"；请求体 JSON：{"name":"<工具名>","arguments":{…},"agentId":环境变量 STARDECK_AGENT 的值}。必须用 node（process.execPath 或 node 脚本）发请求，恒 UTF-8——禁用 Windows 控制台 curl 拼 JSON（GBK 编码会把中文拼成乱码，乱码哨会拒收并打回重交）。大副侧动词：war_triage 报档位、war_plan 呈计划、war_publish 发布任务书（务必携带 commandId，发布后命令卡自动标记已批准）、war_board 看全局、war_abandon_command 弃案。你没有 war_claim/war_submit——那是外勤执行者的出口；你的产出就是账本上的分诊、计划与发布，不要试图替外勤交证。'
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
    if (item.kind !== 'intake') continue
    n += 1
    const maturity = inputMaturityOf(item.text)
    const maturityLine = maturity.verdict === 'mature'
      ? '系统预评：成熟（五项自检无缺口）——照常分诊成案，除非发现真缺口，不要多问。'
      : `系统预评：${maturity.verdict}——缺口：${maturity.gaps.join('、')}。`
    sections.push(`\n${divider(n, '接令：分诊 → 按档位成案')}\n${relayPromptFor({ id: item.commandId, text: item.text, createdAt: '', status: 'draft' }, flags)}`)
    sections.push([
      `【接令第一动作：输入成熟度评估】${maturityLine}`,
      '按任务书五项自检舰长命令（目标 / 背景与约束 / 验收标准 / 非目标 / 交付物）：',
      '- 缺口属起草法可自行补全的无歧义细节 → 直接补全，照常分诊成案，不要多问。',
      '- 涉及舰长独有上下文的缺口（此前对话、口头约定、未指明的对象——如「上次说的那个问题」）→ 不可自补，必须澄清。',
      '- 验收标准不可判定、或关键信息缺失无法成案 → 本轮不分诊不呈批，最终答复末尾输出澄清块（格式逐字如下，系统据此入账挂起）：',
      `【澄清】（${item.commandId}）`,
      '1. <问题——只问影响成案的关键缺口，至多 3 问>；能给出候选答案就附选项：A <选项一> / B <选项二> / C 你帮我定',
      '选项让舰长点选即答（收答更快）；确属开放的才裸问。本进程随澄清块退出即办结——舰长答复后系统另开一轮让你定案，不要空等。',
      // D23 翻译显性化（V21.4）：成熟命令也把「审核+翻译」的产物亮在板上——
      // 成案前输出任务书块，舰长看到自己的强目标被翻译成了什么。
      '- 命令成熟（含走快道的）同样必须在最终答复末尾输出任务书块（五项、格式同办结纪律；按舰长强目标翻译，缺口按起草法补全并注明）——缺块的办结不算办结。',
    ].join('\n'))
  }
  for (const item of items) {
    if (item.kind !== 'resolve') continue
    n += 1
    sections.push([
      `\n${divider(n, '答复成案')}`,
      `命令号 ${item.commandId}（澄清第 ${item.round ?? 1} 轮已获舰长答复）`,
      `命令原文：「${item.text}」`,
      ...(item.questions !== undefined && item.questions.length > 0 ? [`此前你方澄清：\n${item.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`] : []),
      `舰长答复：「${item.answer ?? ''}」`,
      '（舰长答复可能形如「1A;2B;3 <自由文本>」——编号+字母即其对第 N 问的选项选择；含自由文本的按文本理解。）',
      ...(item.planRejectedReason !== undefined ? [`（另：上一稿计划被舰长驳回——「${item.planRejectedReason}」，修订要点一并吸收）`] : []),
      '【处理】结合答复定案——最终答复末尾先输出任务书块（五项齐、格式逐字如下，系统据此入账）：',
      `【任务书】（${item.commandId}）`,
      '目标：<一句话>',
      '背景与约束：<背景与不许碰的边界>',
      '验收标准：<可判定的完成定义>',
      '非目标：<明确不做的>',
      '交付物：<产物清单>',
      '再按复杂度走流程（L0 war_publish 直发 / L1 先 war_plan 呈批，务必携带 commandId；发布时 brief 字段写全背景与约束/非目标/交付物，验收字段写验收标准）。确实仍不可成案才允许再出澄清块——第 2 轮起必须定案或 war_abandon_command，不得再问。',
    ].join('\n'))
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
        `发布成功后，最终答复末尾必须输出该命令的任务书块（五项，见办结纪律）——缺块不算办结。`,
      ].join('\n'))
    } else {
      sections.push([
        `\n${divider(n, '发布')}`,
        `命令号 ${item.commandId} 已判 L0（简单直发）：按起草法直接 war_publish 轻任务书（标题一句话、brief 两三句、验收 ≤3 条可判定项，务必携带 commandId=${item.commandId}，无需舰长批准）。`,
        `命令原文：「${item.text}」`,
        `发布成功后，最终答复末尾必须输出该命令的任务书块（五项，见办结纪律）——缺块不算办结。`,
      ].join('\n'))
    }
  }
  sections.push([
    '',
    '【办结纪律】逐件推进到终态之一：已发布（war_publish 成功）/ 已呈计划待批 / 已澄清待答复（最终答复含澄清块，等舰长答复后系统另开成案轮）/ 确实无法成案（war_abandon_command 附一句人话原因——慎用）。凡已发布或已呈批的命令，最终答复必须包含该命令的【任务书】块（五项：目标/背景与约束/验收标准/非目标/交付物，头行【任务书】（命令号））——它是审核与翻译的入账凭证，缺块的办结不算办结。全办结即收工退出，不空转等待。发布被 lint 拦就按报错文案修稿重发；工具报错即纠错指引。禁止伪造账本、禁止对已终态命令动手、禁止替外勤执行者交证。',
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
  /** V19.13 codex 垫片基址（codex 席大副的 GLM 直驱面；余席忽略）。 */
  codexShimBase?: string
}

/** 大副席别解析（纯）：**双席正典（V19.13）——可选舰队必须大副+外勤双接通**。
 * pi/zcode/claude/codex/dsh 各自框定（codex=http 面+垫片；dsh=http 面）；
 * 双席不全的（gemini/qwen 外勤未实弹且无大副通道）在舰队门即不可选，这里
 * 兜底回退 opencode 仅作防御，daemon 侧打点不静默。 */
export function staffExecutorFor(fleet: string): 'opencode' | 'pi' | 'zcode' | 'claude' | 'codex' | 'dsh' {
  if (fleet === 'pi' || fleet === 'zcode' || fleet === 'claude' || fleet === 'codex' || fleet === 'dsh') return fleet
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
  if (args.executor === 'dsh') {
    // dsh 模型串归一在适配器内（provider/id 形取 id；网关 env Z_AI_*→DEEPSEEK_* 映射）。
    return spawnHeadlessDsh({ ...common, model: args.model, executorBin: args.executorBin })
  }
  if (args.executor === 'codex') {
    // codex 大副（V19.13 双席正典）：http 面教学（exec 形态 MCP 工具不进模型
    // 面——D21 双证）+ shim provider 五旗（GLM 直驱）+ 线程号行钩捕获。
    return spawnHeadlessCodexStaff({ ...common, model: args.model, executorBin: args.executorBin, codexShimBase: args.codexShimBase })
  }
  return spawnHeadlessOpencode({ ...common, model: args.model, executorBin: args.executorBin })
}
