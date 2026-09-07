/**
 * stardeck 实弹门（R0 全链的常驻版）：起本仓 daemon → 下达命令 → 发布
 * （触发执行者适配器 spawn 真 opencode 外勤）→ 轮询到 reported → KillCredit
 * 机械判绿 → 强制人工验收呈批 → 舰长收官 → 终态断言 → 证据落
 * .goal/evidence/live/。前置：本机 opencode 已装且配好模型（STARDECK_MODEL
 * 可覆盖）。
 *
 * 启动：node --import tsx scripts/live-check.ts（cwd=仓库根）
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadCampaign } from '../src/events.ts'
import { loadDirectives } from '../src/directives.ts'
import { killCreditAllGreen } from '../src/tools.ts'
import { jumpArgs, readAttachMap } from '../src/executor.ts'
import type { SubmissionEvidence } from '../src/types.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.LIVE_PORT ?? 3971)
const base = `http://127.0.0.1:${PORT}`
const evidenceDir = join(repoRoot, '.goal', 'evidence', 'live')
mkdirSync(evidenceDir, { recursive: true })

const t0 = Date.now()
const stamp = (label: string): string => `[+${Math.round((Date.now() - t0) / 1000)}s] ${label}`
const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail })
  console.log(`LIVE CHECK ${pass ? 'PASS' : 'FAIL'} · ${name} — ${detail}`)
}

const stateDir = mkdtempSync(join(tmpdir(), 'stardeck-live-'))
const warRoot = join(stateDir, 'tasks')
console.log(stamp(`stateDir=${stateDir}`))

let daemon: ChildProcess | undefined
try {
  async function waitHealth(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const res = await fetch(`${base}/warroom/api/healthz`)
        if (res.ok) return
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('daemon 30s 未活')
      await new Promise(r => setTimeout(r, 500))
    }
  }
  async function apiJson(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
    const text = await res.text()
    let body: any
    try { body = JSON.parse(text) } catch { throw new Error(`${path} 非 JSON：${text.slice(0, 200)}`) }
    if (!res.ok && body?.error !== undefined) throw new Error(`${path} HTTP ${res.status}: ${body.error}`)
    return body
  }
  async function callTool(name: string, args: Record<string, unknown>, agentId: string): Promise<any> {
    const out = await apiJson('/warroom/api/tools/call', { method: 'POST', body: JSON.stringify({ name, arguments: args, agentId }) })
    if (out.ok !== true) throw new Error(`工具失败：${out.error}`)
    return out.result
  }

  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    // 主环 STARDECK_STAFF=0：本相位由脚本直呼 war_publish（确定性执行者链）——
    // 大副若同时在线会对同一 draft 命令二次发布。大副链走可选相位（下方）。
    env: { ...process.env, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STATE_DIR: stateDir, STARDECK_WAR_ROOT: warRoot, STARDECK_PORT: String(PORT), STARDECK_STAFF: '0', ...(process.env.STARDECK_MODEL !== undefined ? {} : { STARDECK_MODEL: 'zai-coding-plan/glm-5.2' }) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  daemon.stdout?.on('data', d => process.stdout.write(d))
  daemon.stderr?.on('data', d => process.stderr.write(d))

  await waitHealth(30_000)
  console.log(stamp('daemon 活了（healthz 200）'))
  const mcpTools = await (await fetch(`${base}/warroom/api/mcp/tools`)).json() as Array<{ name: string }>
  check('MCP 工具面列出 war_* 注册表', mcpTools.length >= 10 && mcpTools.some(t => t.name === 'war_claim') && mcpTools.some(t => t.name === 'war_submit'), `${mcpTools.length} 个工具`)
  const fleetGet = await apiJson('/warroom/api/fleet')
  // V19.13 双席正典：十二席=六可选（adapter && staffReady）+ gemini/qwen（staffReady=false）+ 四契约。
  const fleetSeats = fleetGet.seats as Array<{ id: string; ok: boolean; adapter?: boolean; staffReady?: boolean }>
  check('舰队兵种面（GET /fleet 十二席：六双席可选 + 二半证 + 四契约）', fleetGet.ok === true && fleetGet.active.executor === 'opencode' && Array.isArray(fleetGet.seats) && fleetGet.seats.length === 12 && fleetSeats.filter(s => s.adapter === false).length === 4 && fleetSeats.filter(s => s.adapter !== false && s.staffReady === false).map(s => s.id).join() === 'gemini,qwen' && ['opencode', 'pi', 'codex', 'zcode', 'claude', 'dsh'].every((id: string) => { const s = fleetSeats.find(x => x.id === id); return s !== undefined && s.staffReady === true }), `active=${fleetGet.active.executor} 席位=${fleetSeats.map(s => `${s.id}${s.ok ? '✓' : '✗'}${s.staffReady === false ? '(双席未通)' : ''}`).join('/')}`)
  const fleetPost = await apiJson('/warroom/api/fleet', { method: 'POST', body: JSON.stringify({ executor: 'pi', model: 'zai/glm-5.2' }) })
  const fleetBack = await apiJson('/warroom/api/fleet', { method: 'POST', body: JSON.stringify({ executor: 'opencode', model: '' }) })
  check('舰队兵种绑定往返（POST /fleet 切 pi 再切回）', fleetPost.ok === true && fleetPost.active.executor === 'pi' && fleetBack.ok === true && fleetBack.active.executor === 'opencode', `主环执行者已复位 opencode`)

  const cmd = await apiJson('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: 'live 实弹：stardeck 独立形态第一响' }) })
  const commandId = cmd.commandId as string
  check('命令下达（POST /commands → draft）', typeof commandId === 'string' && commandId.startsWith('cmd-'), `commandId=${commandId}`)

  const pub = await callTool('war_publish', {
    title: 'stardeck 实弹：hello 回响页',
    brief: [
      '背景：stardeck 独立形态实弹验收——在全新任务工作区留下可验证的回响。',
      '执行指引：①工作区根创建 hello.txt，内容包含字符串 stardeck-live；②写 check.js：校验 hello.txt 存在且包含该串，node 原生 fs，成功 0 失败 1；③真实运行 node check.js 记录退出码。',
      '边界：只在当前工作区动土；不安装依赖；完成后按出口协议 war_submit 交证。',
    ].join('\n'),
    acceptance: '1. 工作区根存在 hello.txt 且内容包含字符串 stardeck-live；\n2. 存在 check.js 且 node check.js 真实运行退出码为 0；\n3. war_submit 证据的 files 列出本轮产出文件相对路径。',
    commandId,
  }, 'live-staff')
  const taskId = pub.taskId as string
  check('war_publish 落账并征召外勤', typeof taskId === 'string' && taskId !== '' && pub.conscripted === true, `taskId=${taskId}`)

  const deadline = Date.now() + 8 * 60_000
  let task: ReturnType<typeof loadCampaign> | undefined
  for (;;) {
    await new Promise(r => setTimeout(r, 5_000))
    task = loadCampaign(stateDir, taskId)
    console.log(stamp(`外勤进行中… status=${task.status} attempts=${task.attempts}`))
    if (task.status === 'reported' || task.status === 'failed' || task.status === 'closed') break
    if (Date.now() > deadline) throw new Error('外勤 8 分钟未交卷')
  }
  check('外部 agent（opencode，零宿主）完成 claim→执行→submit', task.claimedBy !== undefined && task.claimedBy.startsWith('oc-') && (task.status === 'reported' || task.status === 'closed'), `status=${task.status} attempts=${task.attempts} claimedBy=${task.claimedBy}`)

  const report = task.reports[task.reports.length - 1]
  const evidence = report?.evidence as SubmissionEvidence | undefined
  if (evidence === undefined) throw new Error('回报无 evidence——外勤没按出口协议交证')
  const green = killCreditAllGreen(evidence, task.workspacePath)
  check('KillCredit 机械全绿', green.green, green.why)
  // V19 腿1 实弹灵魂验收：战报纪律是否真落到外勤交卷——report 非空且提及
  // 至少一个 evidence 产物文件名（防提示词白写：教学在简报里，见真章在战报里）。
  {
    const repText = (report?.text ?? '').trim()
    const evFiles = (evidence.files ?? []) as string[]
    const mentions = evFiles.some(f => repText.includes(f.split(/[\\/]/).pop() ?? f))
    check('战报=给舰长的最终答复（非空且指路产物文件名）', repText.length >= 10 && mentions, `report=${repText.length} 字 files=${evFiles.join(',')} 指路=${mentions}`)
  }
  check('强制人工验收生效（reported 呈批不自动收官）', task.status === 'reported', `status=${task.status}`)

  const closed = await callTool('war_close_task', { task_id: taskId, verdict: '通过收官——实弹回响属实' }, 'live-staff')
  const after = loadCampaign(stateDir, taskId)
  check('舰长验收收官', closed.status === 'closed' && after.status === 'closed', `status=${after.status}`)

  const board = await apiJson('/warroom/api/board')
  const boardTask = (board.tasks as Array<{ taskId: string; status: string }>).find(t => t.taskId === taskId)
  const boardCmd = (board.commands as Array<{ commandId: string; status: string; taskId?: string }>).find(c => c.commandId === commandId)
  check('板投影终态（closed）', boardTask?.status === 'closed', `${taskId}=${boardTask?.status}`)
  check('命令卡溯源（approved 挂任务）', boardCmd?.status === 'approved' && boardCmd?.taskId === taskId, `${commandId}=${boardCmd?.status}`)
  const ui = await fetch(`${base}/`)
  check('板 UI 静态服务（/ 返回 HTML）', ui.ok && (await ui.text()).includes('stardeck-root'), `HTTP ${ui.status}`)

  // 附着相位（宿主前置第一刀）：征召即捕 opencode 原生会话号 → 跳转端点 dry-run 复认。
  const attachEntry = readAttachMap(stateDir)[taskId]
  check('附着面：征召写入原生会话映射（ses_ 号）', attachEntry?.executor === 'opencode' && (attachEntry?.sessionId ?? '').startsWith('ses_'), `sessionId=${attachEntry?.sessionId ?? '缺'}`)
  const jump = await apiJson('/warroom/api/attach/jump', { method: 'POST', body: JSON.stringify({ taskId, dryRun: true }) })
  check('附着面：跳转端点 dry-run（argv/cwd/executor 同构）', jump.ok === true && jump.executor === 'opencode' && jump.cwd === task.workspacePath && JSON.stringify(jump.argv) === JSON.stringify(jumpArgs('opencode', jump.sessionId)), `argv=${(jump.argv ?? []).join(' ')} cwd命中=${jump.cwd === task.workspacePath}`)

  // 会话历史相位（方案2·二段）：零 token 读本机 opencode 存档——真会话真消息，
  // 首条用户消息就是征召令 PROMPT（不 resume 不烧模型）。
  const hist = await apiJson('/warroom/api/attach/history', { method: 'POST', body: JSON.stringify({ taskId }) }) as { ok?: boolean; executor?: string; messages?: Array<{ role: string; parts: Array<{ text: string }> }> }
  const firstUser = hist.messages?.find(m => m.role === 'user')
  check('附着面：会话历史零 token 读档（弹窗数据源）', hist.ok === true && hist.executor === 'opencode' && (hist.messages?.length ?? 0) >= 2 && (firstUser?.parts[0]?.text ?? '').includes('Mission: read the file .stardeck/brief.md'), `messages=${hist.messages?.length ?? 0} 首条含征召令=${(firstUser?.parts[0]?.text ?? '').includes('Mission: read the file .stardeck/brief.md')}`)
  const entries = await apiJson('/warroom/api/attach/entries', { method: 'POST', body: JSON.stringify({ taskIds: [taskId, 'no-such'] }) }) as { ok?: boolean; entries?: Record<string, { executor?: string } | null> }
  check('附着面：entries 轻查（TUI 行可见性数据源）', entries.ok === true && entries.entries?.[taskId]?.executor === 'opencode' && entries.entries?.['no-such'] === null, JSON.stringify(entries.entries ?? {}))

  writeFileSync(join(evidenceDir, 'board-final.json'), JSON.stringify(board, null, 2), 'utf8')
  writeFileSync(join(evidenceDir, 'campaign-final.json'), JSON.stringify(after, null, 2), 'utf8')
  for (const f of readdirSync(join(stateDir, 'logs'))) {
    if (f.startsWith('executor-') && f.endsWith('.log')) copyFileSync(join(stateDir, 'logs', f), join(evidenceDir, f))
  }
  for (const f of ['campaigns.jsonl', 'directives.jsonl']) {
    if (existsSync(join(stateDir, f))) copyFileSync(join(stateDir, f), join(evidenceDir, f))
  }
} finally {
  daemon?.kill()
  await new Promise(r => setTimeout(r, 500))
}

// ---------- 可选相位：大副外聘实弹（STARDECK_LIVE_STAFF=1） ----------
// 独立第二 daemon（staff 开）：draft 命令不经脚本，全靠外聘大副自动分诊→
// 直发发布（!!直接做 强制 L0）→ 外勤全链 → 定时令到点自动派发。主环关大副
// 是防双发，本相位才是 HANDOFF① 的端到端证据。
// STARDECK_LIVE_STAFF_EXECUTOR=<zcode|pi>（默认 opencode）：大副随舰队实弹
// ——daemon 起在所选舰队上，大副与外勤都跑该席，+1 断言（staff- 映射的
// executor 必须是所选舰队）。
if (process.env.STARDECK_LIVE_STAFF === '1') {
  const staffFleetLive = (process.env.STARDECK_LIVE_STAFF_EXECUTOR ?? 'opencode').trim()
  const PORT2 = PORT + 1
  const base2 = `http://127.0.0.1:${PORT2}`
  const stateDir2 = mkdtempSync(join(tmpdir(), 'stardeck-live-staff-'))
  const warRoot2 = join(stateDir2, 'tasks')
  let daemon2: ChildProcess | undefined
  let staffStateKept = false
  try {
    daemon2 = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STARDECK_CONFIG: join(stateDir2, 'config.json'), STARDECK_STATE_DIR: stateDir2, STARDECK_WAR_ROOT: warRoot2, STARDECK_PORT: String(PORT2), STARDECK_STAFF: '1', STARDECK_STAFF_TIMEOUT_MIN: '10',
        ...(staffFleetLive !== 'opencode' ? { STARDECK_EXECUTOR: staffFleetLive } : {}),
        // codex 席入口按席给定（STARDECK_EXECUTOR_BIN 是全局逃生阀——会误伤
        // 主环 opencode，故走独立变量只在本相位 daemon 生效）。
        ...(staffFleetLive === 'codex' && process.env.STARDECK_LIVE_CODEX_BIN ? { STARDECK_EXECUTOR_BIN: process.env.STARDECK_LIVE_CODEX_BIN } : {}),
        ...(process.env.STARDECK_MODEL !== undefined ? {} : { STARDECK_MODEL: staffFleetLive === 'pi' ? 'zai/glm-5.2' : 'zai-coding-plan/glm-5.2' }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    daemon2.stdout?.on('data', d => process.stdout.write(d))
    daemon2.stderr?.on('data', d => process.stderr.write(d))
    const t2 = Date.now()
    for (;;) {
      try { const r = await fetch(`${base2}/warroom/api/healthz`); if (r.ok) break } catch { /* not up */ }
      if (Date.now() - t2 > 30_000) throw new Error('大副相位 daemon 30s 未活')
      await new Promise(r => setTimeout(r, 500))
    }
    console.log(stamp(`大副相位 daemon 活了（staff=on，舰队=${staffFleetLive}）`))

    const post2 = async (path: string, body: unknown): Promise<any> => {
      const res = await fetch(`${base2}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json() as any
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${json?.error ?? ''}`)
      return json
    }

    // S1/S2 两条命令：一条立即接令（!!直接做→L0 直发），一条定时（每分钟 cron
    // →到点自动派发后再走同一大副管道）。
    const cmdA = (await post2('/warroom/api/commands', { text: '!!直接做：在任务工作区根创建 staff-live.txt（内容包含字符串 stardeck-staff-live），写 check.js 校验该文件存在且含该串并真实运行记录退出码，然后按出口协议交证。' })).commandId as string
    const cmdB = (await post2('/warroom/api/commands', { text: '!!直接做：在任务工作区根创建 minute-mark.txt（内容为当前时刻一行），并写 check.js 校验存在后真实运行，按出口协议交证。', cron: '* * * * *' })).commandId as string
    // V20.1 澄清协议实弹（cmdC）：悬空指代（「上次讨论的」在全新 stateDir 里
    // 不存在）——舰长独有上下文，大副无法自补，必须澄清；舰长板内答复后开成
    // 案轮出任务书。（首轮实弹教训：缺验收但可自补的命令会被大副按起草法合法
    // 直发——考题必须落在「不可自补」象限。）
    const cmdC = (await post2('/warroom/api/commands', { text: '把上次讨论的那个工具箱入口问题处理掉' })).commandId as string
    console.log(stamp(`大副相位命令：${cmdA}（即时）/ ${cmdB}（定时 * * * * *）/ ${cmdC}（悬空指代——澄清协议考题）`))

    const until = async (ms: number, label: string, probe: () => string | undefined): Promise<string> => {
      const end = Date.now() + ms
      for (;;) {
        const hit = probe()
        if (hit !== undefined) return hit
        if (Date.now() > end) throw new Error(`大副相位等待超时：${label}`)
        await new Promise(r => setTimeout(r, 5_000))
      }
    }
    const dirState = () => loadDirectives(stateDir2)

    const taskA = await until(6 * 60_000, `${cmdA} 大副自动成案`, () => {
      const d = dirState().find(x => x.id === cmdA)
      return d?.status === 'approved' && d.taskId !== undefined ? d.taskId! : undefined
    })
    check('大副外聘自动成案（draft→分诊→L0 直发发布）', true, `${cmdA} → ${taskA}`)
    await until(3 * 60_000, `${cmdB} 定时令到点派发`, () => {
      const d = dirState().find(x => x.id === cmdB)
      return d?.schedule?.dispatchedAt !== undefined ? d.schedule.dispatchedAt : undefined
    })
    check('定时命令到点自动派发（宿主 tick 替位）', true, `${cmdB} dispatched`)
    const taskB = await until(6 * 60_000, `${cmdB} 大副接令成案`, () => {
      const d = dirState().find(x => x.id === cmdB)
      return d?.status === 'approved' && d.taskId !== undefined ? d.taskId! : undefined
    })
    check('定时令走同一大副管道成案', true, `${cmdB} → ${taskB}`)

    // V20.1 澄清协议全链：模糊命令 → 澄清挂起（不硬派活）→ 板内答复 →
    // 成案轮任务书五项入账 → 任务发布（征召令内嵌五项）。
    const pendingC = await until(8 * 60_000, `${cmdC} 大副澄清挂起`, () => {
      const d = dirState().find(x => x.id === cmdC)
      return d?.clarification?.status === 'pending' ? `round${d.clarification.round}(${d.clarification.questions.length}问)` : undefined
    })
    const dirC = dirState().find(x => x.id === cmdC)
    check('澄清协议：模糊命令被追问而非硬派活（澄清挂起入账）', dirC?.taskId === undefined, `${pendingC}；问题：${dirC?.clarification?.questions.join(' / ') ?? '?'}`)
    const answerC = await post2('/warroom/api/commands/answer', { commandId: cmdC, text: '「入口问题」指：工具箱首页按钮在窄屏（375px 宽）下溢出容器。验收标准：375px 视口下按钮完整可见、可点击，无横向滚动；非目标：不改后端接口、不做响应式全面重构；交付物：修复改动与验收说明。' }) as { ok?: boolean; note?: string; error?: string }
    check('舰长板内答复入账（澄清回环受理）', answerC.ok === true, answerC.note ?? answerC.error ?? '')
    await until(8 * 60_000, `${cmdC} 成案轮任务书入账`, () => {
      const d = dirState().find(x => x.id === cmdC)
      const b = d?.brief
      return b !== undefined && [b.goal, b.background, b.acceptance, b.nonGoals, b.deliverables].every(s => s !== '') ? b.goal : undefined
    })
    const briefC = dirState().find(x => x.id === cmdC)!.brief!
    check('任务书一等事件：五项齐入账（goal/background/acceptance/nonGoals/deliverables）', true, `目标=${briefC.goal}｜非目标=${briefC.nonGoals}`)
    // 成案轮 L0 直发或 L1 呈批皆可——L1 则舰长当场批准（staff-plan 旗默认开）。
    const taskC = await until(10 * 60_000, `${cmdC} 成案发布`, () => {
      const d = dirState().find(x => x.id === cmdC)
      if (d?.plan?.status === 'pending') {
        void post2('/warroom/api/commands/plan', { commandId: cmdC, decision: 'approve', note: '任务书成立，按计划执行' }).catch(() => { /* 下一轮再试 */ })
      }
      return d?.status === 'approved' && d.taskId !== undefined ? d.taskId! : undefined
    })
    const taskCState = loadCampaign(stateDir2, taskC)
    check('征召令内嵌任务书五项（发布 brief 携带非目标/交付物）', typeof taskCState.brief === 'string' && taskCState.brief.includes('非目标') && taskCState.brief.includes('交付物'), (taskCState.brief ?? '').slice(0, 80))

    let staffTask: ReturnType<typeof loadCampaign> | undefined
    const endStaff = Date.now() + 8 * 60_000
    for (;;) {
      await new Promise(r => setTimeout(r, 5_000))
      staffTask = loadCampaign(stateDir2, taskA)
      console.log(stamp(`大副相位外勤进行中… ${taskA} status=${staffTask.status}`))
      if (staffTask.status === 'reported' || staffTask.status === 'failed' || staffTask.status === 'closed') break
      if (Date.now() > endStaff) throw new Error('大副相位外勤 8 分钟未交卷')
    }
    check('外勤全链（大副发布的任务）claim→执行→submit', staffTask.claimedBy !== undefined && staffTask.claimedBy.startsWith('oc-') && (staffTask.status === 'reported' || staffTask.status === 'closed'), `status=${staffTask.status} claimedBy=${staffTask.claimedBy}`)
    const staffReport = staffTask.reports[staffTask.reports.length - 1]
    const staffEvidence = staffReport?.evidence as SubmissionEvidence | undefined
    if (staffEvidence === undefined) throw new Error('大副相位回报无 evidence')
    const staffGreen = killCreditAllGreen(staffEvidence, staffTask.workspacePath)
    check('KillCredit 机械全绿（大副相位）', staffGreen.green, staffGreen.why)
    if (staffFleetLive !== 'opencode') {
      // 大副随舰队实弹：staff-<id> 键的 attach 映射 executor 必须是所选舰队。
      // 此刻大副必已收工（发布完才轮到外勤交卷）：zcode=退场尾包入账、pi=退场
      // 惰性扫描、opencode=行钩 eager（本分支不查）。
      const amap = readAttachMap(stateDir2)
      const staffHit = Object.entries(amap).find(([k, v]) => k.startsWith('staff-') && v.executor === staffFleetLive)
      const why = Object.entries(amap).filter(([k]) => k.startsWith('staff-')).map(([k, v]) => `${k}→${v.executor}:${v.sessionId}`).join(', ')
      check(`大副随舰队实弹（${staffFleetLive} 席）——原生会话映射入账`, staffHit !== undefined, why || '无 staff- 映射')
    }
    const staffClosed = await post2('/warroom/api/tools/call', { name: 'war_close_task', arguments: { task_id: taskA, verdict: '通过收官——大副链实弹回响属实' }, agentId: 'live-staff' }) as { ok: boolean; result?: { status?: string } }
    check('舰长验收收官（大副相位）', staffClosed.ok === true && staffClosed.result?.status === 'closed', `${taskA}=${loadCampaign(stateDir2, taskA).status}`)

    // taskB 的外勤可以仍在跑——成案即证明派发链，收官不阻塞本门（主环已验收官语义）。
  } catch (err) {
    staffStateKept = true
    console.error(`大副相位现场保留供排查：${stateDir2}`)
    throw err
  } finally {
    daemon2?.kill()
    await new Promise(r => setTimeout(r, 500))
    // 证据拷贝在 daemon 收摊**之后**（V20.4 实弹教训：daemon 仍握句柄时读侧
    // 静默吞错，directives.jsonl 落盘 0 字节——澄清问→答→成案全链证据丢失）。
    // 收摊后读必然稳；空文件显式告警，不假装证据在场。
    writeFileSync(join(evidenceDir, 'staff-phase-directives.jsonl'), readFileSyncSafely(join(stateDir2, 'directives.jsonl')), 'utf8')
    try {
      for (const f of readdirSync(join(stateDir2, 'logs'))) {
        if ((f.startsWith('staff-') || f.startsWith('executor-')) && f.endsWith('.log')) copyFileSync(join(stateDir2, 'logs', f), join(evidenceDir, `staff-phase-${f}`))
      }
    } catch { /* logs 目录缺席（早夭相位）不是门的失败 */ }
    if (!staffStateKept) {
      // Windows 下 taskB 的外勤可能是 daemon2 的孤儿子进程、仍握日志句柄——
      // 清理 best-effort：断言已全过，清不掉就留给系统临时目录，不是门的失败。
      try {
        rmSync(stateDir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
      } catch {
        console.warn(`大副相位临时目录暂不可清（句柄未断，断言已全过）：${stateDir2}`)
      }
    }
  }
}

function readFileSyncSafely(p: string): string {
  try {
    const s = readFileSync(p, 'utf8')
    if (s === '') console.warn(`[evidence] 证据文件读到空内容（疑似句柄竞态，重跑实弹补证）：${p}`)
    return s
  } catch (err) {
    console.warn(`[evidence] 证据文件读取失败：${p}（${err instanceof Error ? err.message : String(err)}）`)
    return ''
  }
}

// ---------- 可选相位：执行者变体实弹（STARDECK_LIVE_EXECUTOR=codex|pi|zcode|claude） ----------
// 主环固定 opencode；本相位用同一全链（下令→发布→claim→执行→交证→收官）换
// 指定执行者再打一遍——适配器「源码实证+注入实证」之上的端到端实弹证据。
// 模型接线（本机惯例）：codex=-m glm-5.2 -c model_provider=zai（chat wire，
// 注：codex-cli 0.152+ 已移除 chat wire_api，需 Responses 兼容网关或 ≤0.44）；
// pi=--model zai/glm-5.2（~/.pi/agent/extensions/zai.ts）。key=Z_AI_API_KEY 环境变量。
// claude=env ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN 走 anthropic 兼容网关
//（本机实证 z.ai/api/anthropic + GLM——Z_AI_API_KEY 映射即可，免原生订阅）。
const liveExecutor = process.env.STARDECK_LIVE_EXECUTOR ?? ''
if (liveExecutor === 'codex' || liveExecutor === 'pi' || liveExecutor === 'zcode' || liveExecutor === 'claude') {
  const PORT3 = PORT + 2
  const base3 = `http://127.0.0.1:${PORT3}`
  const stateDir3 = mkdtempSync(join(tmpdir(), `stardeck-live-${liveExecutor}-`))
  const warRoot3 = join(stateDir3, 'tasks')
  let daemon3: ChildProcess | undefined
  let kept = false
  try {
    daemon3 = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
      cwd: repoRoot,
      env: {
        ...process.env, STARDECK_CONFIG: join(stateDir3, 'config.json'), STARDECK_STATE_DIR: stateDir3, STARDECK_WAR_ROOT: warRoot3, STARDECK_PORT: String(PORT3),
        STARDECK_STAFF: '0', STARDECK_EXECUTOR: liveExecutor,
        ...(liveExecutor === 'codex' ? { STARDECK_MODEL: process.env.STARDECK_MODEL ?? 'glm-5.2', STARDECK_MODEL_PROVIDER: process.env.STARDECK_MODEL_PROVIDER ?? 'zai' } : {}),
        ...(liveExecutor === 'pi' ? { STARDECK_MODEL: process.env.STARDECK_MODEL ?? 'zai/glm-5.2' } : {}),
        ...(liveExecutor === 'claude' ? {
          ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? 'https://api.z.ai/api/anthropic',
          ...(process.env.ANTHROPIC_AUTH_TOKEN !== undefined || process.env.Z_AI_API_KEY !== undefined ? { ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.Z_AI_API_KEY! } : {}),
        } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    daemon3.stdout?.on('data', d => process.stdout.write(d))
    daemon3.stderr?.on('data', d => process.stderr.write(d))
    const t3 = Date.now()
    for (;;) {
      try { const r = await fetch(`${base3}/warroom/api/healthz`); if (r.ok) break } catch { /* not up */ }
      if (Date.now() - t3 > 30_000) throw new Error(`${liveExecutor} 相位 daemon 30s 未活`)
      await new Promise(r => setTimeout(r, 500))
    }
    console.log(stamp(`执行者相位 daemon 活了（executor=${liveExecutor}）`))
    const post3 = async (path: string, body: unknown): Promise<any> => {
      const res = await fetch(`${base3}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json() as any
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${json?.error ?? ''}`)
      return json
    }
    const call3 = async (name: string, args: Record<string, unknown>): Promise<any> => {
      const out = await post3('/warroom/api/tools/call', { name, arguments: args, agentId: `live-${liveExecutor}-staff` })
      if (out.ok !== true) throw new Error(`工具失败：${out.error}`)
      return out.result
    }

    const cmdE = (await post3('/warroom/api/commands', { text: `${liveExecutor} 实弹：在任务工作区根创建 ${liveExecutor}-live.txt（内容包含字符串 stardeck-${liveExecutor}-live），写 check.js 校验该文件存在且含该串并真实运行记录退出码，然后按出口协议交证。` })).commandId as string
    const pubE = await call3('war_publish', {
      title: `${liveExecutor} 实弹：回响页`,
      brief: `背景：stardeck 执行者变体实弹（${liveExecutor} 适配器全链）。执行指引：①工作区根创建 ${liveExecutor}-live.txt，内容包含字符串 stardeck-${liveExecutor}-live；②写 check.js 校验之，node 原生 fs，成功 0 失败 1；③真实运行记录退出码。边界：只在当前工作区动土；按出口协议交证。`,
      acceptance: `1. 工作区根存在 ${liveExecutor}-live.txt 且内容包含 stardeck-${liveExecutor}-live；\n2. check.js 真实运行退出码 0；\n3. 交证证据 files 列出产出文件相对路径。`,
      commandId: cmdE,
    })
    const taskE = pubE.taskId as string
    check(`${liveExecutor} 相位 war_publish 落账并征召`, typeof taskE === 'string' && pubE.conscripted === true, `taskId=${taskE}`)

    let taskX: ReturnType<typeof loadCampaign> | undefined
    const endE = Date.now() + 10 * 60_000
    for (;;) {
      await new Promise(r => setTimeout(r, 5_000))
      taskX = loadCampaign(stateDir3, taskE)
      console.log(stamp(`${liveExecutor} 外勤进行中… status=${taskX.status} attempts=${taskX.attempts}`))
      if (taskX.status === 'reported' || taskX.status === 'failed' || taskX.status === 'closed') break
      if (Date.now() > endE) throw new Error(`${liveExecutor} 外勤 10 分钟未交卷`)
    }
    check(`${liveExecutor} 执行者全链 claim→执行→submit`, taskX.claimedBy !== undefined && taskX.claimedBy.startsWith('oc-') && (taskX.status === 'reported' || taskX.status === 'closed'), `status=${taskX.status} claimedBy=${taskX.claimedBy}`)
    const reportE = taskX.reports[taskX.reports.length - 1]
    const evidenceE = reportE?.evidence as SubmissionEvidence | undefined
    if (evidenceE === undefined) throw new Error(`${liveExecutor} 相位回报无 evidence`)
    const greenE = killCreditAllGreen(evidenceE, taskX.workspacePath)
    check(`KillCredit 机械全绿（${liveExecutor}）`, greenE.green, greenE.why)
    check(`强制人工验收生效（${liveExecutor}）`, taskX.status === 'reported', `status=${taskX.status}`)
    await call3('war_close_task', { task_id: taskE, verdict: `通过收官——${liveExecutor} 链实弹回响属实` })
    check(`舰长验收收官（${liveExecutor}）`, loadCampaign(stateDir3, taskE).status === 'closed', `${taskE}=closed`)
    if (liveExecutor === 'pi') {
      // 附着相位（pi）：惰性捕获真实会话文件名里的会话号 → 跳转同构复认。
      const jumpPi = await post3('/warroom/api/attach/jump', { taskId: taskE, dryRun: true })
      check('附着面（pi）：惰性捕获会话号 + 跳转同构', jumpPi.ok === true && jumpPi.executor === 'pi' && typeof jumpPi.sessionId === 'string' && jumpPi.sessionId.length >= 8 && jumpPi.cwd === taskX.workspacePath && JSON.stringify(jumpPi.argv) === JSON.stringify(jumpArgs('pi', jumpPi.sessionId)), `argv=${(jumpPi.argv ?? []).join(' ')} sessionId=${jumpPi.sessionId}`)
    }
    if (liveExecutor === 'zcode') {
      // 附着相位（zcode）：--json 尾包在进程收尾时才打印（submit 后数秒）——
      // 轮询映射就绪（≤20s）再取 sess_ 号，跳转同构复认（node+zcode.cjs 形）。
      let zid = ''
      const zEnd = Date.now() + 20_000
      while (Date.now() < zEnd) {
        zid = readAttachMap(stateDir3)[taskE]?.sessionId ?? ''
        if (zid !== '') break
        await new Promise(res => setTimeout(res, 1000))
      }
      const jumpZ = await post3('/warroom/api/attach/jump', { taskId: taskE, dryRun: true })
      check('附着面（zcode）：征召捕获会话号 + 跳转同构', jumpZ.ok === true && jumpZ.executor === 'zcode' && jumpZ.sessionId === zid && zid.startsWith('sess_') && jumpZ.cwd === taskX.workspacePath && JSON.stringify(jumpZ.argv) === JSON.stringify(jumpArgs('zcode', jumpZ.sessionId)), `argv=${(jumpZ.argv ?? []).join(' ')} sessionId=${zid || '缺'}`)
      // 会话历史（zcode）：真读 ~/.zcode/cli/db/db.sqlite——无头会话全量入库，
      // 首条用户消息=大副/征召令（历史弹窗即 zcode 的会话回看正解，零 token）。
      const histZ = await post3('/warroom/api/attach/history', { taskId: taskE }) as { ok?: boolean; executor?: string; messages?: Array<{ role: string; parts: Array<{ text: string }> }> }
      const zFirstUser = histZ.messages?.find(m => m.role === 'user')
      check('附着面（zcode）：会话历史零 token 读档（真 db）', histZ.ok === true && histZ.executor === 'zcode' && (histZ.messages?.length ?? 0) >= 2 && (zFirstUser?.parts[0]?.text ?? '').includes('Mission'), `messages=${histZ.messages?.length ?? 0} 首条含征召令=${(zFirstUser?.parts[0]?.text ?? '').includes('Mission')}`)
    }
    if (liveExecutor === 'claude') {
      // 附着相位（claude）：--output-format json 尾包在进程收尾——轮询映射就绪
      //（≤30s，claude 会话可能多轮工具调用较慢）再取 uuid 号，跳转同构复认。
      let cid = ''
      const cEnd = Date.now() + 30_000
      while (Date.now() < cEnd) {
        cid = readAttachMap(stateDir3)[taskE]?.sessionId ?? ''
        if (cid !== '') break
        await new Promise(res => setTimeout(res, 1000))
      }
      const jumpC = await post3('/warroom/api/attach/jump', { taskId: taskE, dryRun: true })
      check('附着面（claude）：征召捕获会话号 + 跳转同构', jumpC.ok === true && jumpC.executor === 'claude' && jumpC.sessionId === cid && /^[0-9a-f]{8}-/.test(cid) && jumpC.cwd === taskX.workspacePath && JSON.stringify(jumpC.argv) === JSON.stringify(jumpArgs('claude', jumpC.sessionId)), `argv=${(jumpC.argv ?? []).join(' ')} sessionId=${cid || '缺'}`)
      // 会话历史（claude）：真读 ~/.claude/projects/<编码>/<uuid>.jsonl。
      const histC = await post3('/warroom/api/attach/history', { taskId: taskE }) as { ok?: boolean; executor?: string; messages?: Array<{ role: string; parts: Array<{ text: string }> }> }
      const cFirstUser = histC.messages?.find(m => m.role === 'user')
      check('附着面（claude）：会话历史零 token 读档（真 jsonl）', histC.ok === true && histC.executor === 'claude' && (histC.messages?.length ?? 0) >= 2 && (cFirstUser?.parts[0]?.text ?? '').includes('Mission'), `messages=${histC.messages?.length ?? 0} 首条含征召令=${(cFirstUser?.parts[0]?.text ?? '').includes('Mission')}`)
    }

    writeFileSync(join(evidenceDir, `${liveExecutor}-phase-directives.jsonl`), readFileSyncSafely(join(stateDir3, 'directives.jsonl')), 'utf8')
    for (const f of readdirSync(join(stateDir3, 'logs'))) {
      if (f.endsWith('.log')) copyFileSync(join(stateDir3, 'logs', f), join(evidenceDir, `${liveExecutor}-phase-${f}`))
    }
  } catch (err) {
    kept = true
    console.error(`${liveExecutor} 相位现场保留供排查：${stateDir3}`)
    throw err
  } finally {
    daemon3?.kill()
    await new Promise(r => setTimeout(r, 500))
    try {
      rmSync(stateDir3, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
    } catch {
      console.warn(`${liveExecutor} 相位临时目录暂不可清（句柄未断，断言已全过）：${stateDir3}`)
    }
  }
}

// ---------- 可选相位：pi RPC steer 实弹（STARDECK_LIVE_STEER=1，P0-1 判据②） ----------
// 真 pi 进程协议往返：① prompt 帧 → response 回执 + agent_settled（协议面在真机
// 实证）；② get_state 拿 sessionId → deliverViaRpc --session 续跑二次投递受理
// （板内答复通道同源：答复=续跑 prompt）。模型=zai/glm-5.2（~/.pi/agent/extensions
// /zai.ts；key=Z_AI_API_KEY）。
if (process.env.STARDECK_LIVE_STEER === '1') {
  const { startPiRpc, promptFrame, piRpcArgv, deliverViaRpc } = await import('../src/steer.ts')
  const { detectPiBin } = await import('../src/executor.ts')
  const steerCwd = mkdtempSync(join(tmpdir(), 'stardeck-steer-live-'))
  try {
    const model = process.env.STARDECK_MODEL ?? 'zai/glm-5.2'
    const handle = startPiRpc({ bin: detectPiBin(''), argv: piRpcArgv({ model }), cwd: steerCwd })
    handle.send(promptFrame('live-steer-1', '这是一次通道验证。请只回复两个字：收到。'))
    const receipt = await handle.awaitResponse('live-steer-1', 60_000)
    const settled = receipt.ok ? await handle.awaitSettled(180_000) : false
    handle.send({ id: 'live-gs', type: 'get_state' })
    const state = receipt.ok ? await handle.awaitResponse('live-gs', 10_000) : receipt
    const sessionId = state.data?.sessionId ?? ''
    handle.kill()
    check('pi RPC 协议往返（prompt 回执 + agent_settled）', receipt.ok && settled, `receipt.ok=${receipt.ok} settled=${settled}${receipt.error !== undefined ? ' err=' + receipt.error : ''}`)
    let resumeOk = false
    let resumeDetail = '未执行'
    if (sessionId !== '') {
      const resume = await deliverViaRpc({ bin: detectPiBin(''), cwd: steerCwd, sessionId, model, message: '续跑验证：请只回复一个字：好。', kind: 'prompt', responseTimeoutMs: 60_000, settledTimeoutMs: 180_000 })
      resumeOk = resume.ok
      resumeDetail = `sessionId=${sessionId.slice(0, 8)}… receipt.ok=${resume.ok}${resume.error !== undefined ? ' err=' + resume.error : ''}`
      await resume.settled
    } else {
      resumeDetail = 'get_state 未给出 sessionId：' + JSON.stringify(state.data ?? {})
    }
    check('续跑投递（--session 二次 prompt 受理——板内答复同源通道）', resumeOk, resumeDetail)
  } finally {
    try { rmSync(steerCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }) } catch { /* 句柄慢放 */ }
  }
}

const passed = results.filter(r => r.pass).length
const verdict = passed === results.length ? 'PASS' : 'FAIL'
writeFileSync(join(evidenceDir, 'REPORT.md'), [
  '# stardeck 实弹门（独立 daemon + 真 opencode 外勤全链）',
  '',
  `- 判定：**${verdict}**（${passed}/${results.length} 项过）`,
  `- 时间：${new Date().toISOString()} · 耗时 ${Math.round((Date.now() - t0) / 1000)}s`,
  '- 形态：本仓 src/daemon.ts（零宿主）+ war_* 注册表 + stdio MCP 桥 + opencode 执行者适配器',
  '',
  ...results.map(r => `- ${r.pass ? '✅' : '❌'} **${r.name}** — ${r.detail}`),
].join('\n'), 'utf8')

console.log(`\nLIVE VERDICT: ${verdict}（${passed}/${results.length}）`)
if (verdict === 'FAIL') {
  console.log('保留现场供排查：' + stateDir)
  process.exit(1)
}
// Windows 目录锁（坑录类）：判分后立刻删常撞残留句柄（daemon/opencode 退场竞速）
// ——重试三拍仍锁则留现场退出 0（判分已定，清场是尽力而为，不为保洁误伤门禁）。
for (let i = 0; i < 3; i++) {
  try {
    rmSync(stateDir, { recursive: true, force: true })
    break
  } catch (err) {
    if (i === 2) {
      console.log(`现场目录暂被句柄占用，稍后可手清：${stateDir}（${err instanceof Error ? err.code : String(err)}）`)
      break
    }
    await new Promise(r => setTimeout(r, 1_000))
  }
}
process.exit(0)
