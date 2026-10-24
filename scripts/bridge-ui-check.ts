/**
 * D26 舰桥频道 UI 目检（v0.3.0 交付判据 6）：起隔离 daemon → 种待决账本 →
 * Playwright 实览三态——默认脸面=聊天窗（计算样式断言：消息区可滚/输入面
 * 可见）、澄清决策卡药丸点选拼装、分屏旁观双-pane 在场、看板全屏可回。
 * 截图存 .goal/evidence/bridge/。纪律：domcontentloaded+显式等待（SSE 挡
 * networkidle）、?cb= 强变更 URL（防内存缓存旧 bundle）。
 * 启动：node --import tsx scripts/bridge-ui-check.ts（cwd=仓库根）
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendDirectiveEvent } from '../src/directives.ts'
import { appendEvent } from '../src/events.ts'
import { appendBridgeEvent } from '../src/bridge.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.BRIDGE_UI_PORT ?? 3973)
const base = `http://127.0.0.1:${PORT}`
const evidenceDir = join(repoRoot, '.goal', 'evidence', 'bridge')
mkdirSync(evidenceDir, { recursive: true })

const stateDir = mkdtempSync(join(tmpdir(), 'stardeck-bridge-ui-'))
const warRoot = join(stateDir, 'tasks')
const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail })
  console.log(`BRIDGE UI ${pass ? 'PASS' : 'FAIL'} · ${name} — ${detail}`)
}

// pnpm 严格 node_modules：playwright-core 是 promptfoo 的传递依赖，按 .pnpm
// 绝对路径动态导入（版本目录现场探）。
function playwrightCorePath(): string {
  const pn = join(repoRoot, 'node_modules', '.pnpm')
  const hit = readdirSync(pn).find(d => /^playwright-core@/.test(d))
  if (hit === undefined) throw new Error('playwright-core 不在 .pnpm 库（pnpm install）')
  return join(pn, hit, 'node_modules', 'playwright-core', 'index.mjs')
}

let daemon: ChildProcess | undefined
let gate: ReturnType<typeof createServer> | undefined
let exitCode = 0
try {
  // ── D37 慢答假网关：SSE chat 兼容面。普通问话秒答；「慢点答」标记轮先吐
  // 思考流再挂 30s——造一个可停止的在途轮（停止钮 e2e 的对手方）。 ──
  gate = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const slow = raw.includes('慢点答')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const frame = (delta: Record<string, unknown>, finish: string | null): void => {
        res.write(`data: ${JSON.stringify({ id: 'g1', object: 'chat.completion.chunk', created: 1, model: 'glm-test', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      }
      if (slow) {
        frame({ role: 'assistant', reasoning_content: '舰长要慢答，先把账面核一遍再开口……' }, null)
        setTimeout(() => { frame({ content: '慢答正文（不应出现——已被停止）。' }, 'stop'); res.write('data: [DONE]\n\n'); res.end() }, 30_000)
        return
      }
      frame({ role: 'assistant', content: '收到，一切照常。' }, 'stop')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(r => gate.listen(0, '127.0.0.1', r))
  const gatePort = (gate.address() as { port: number }).port
  // ── 种账本：挂起澄清（带选项）+ reported 任务 → 聊天决策坞两卡齐 ──
  const now = new Date().toISOString()
  appendDirectiveEvent(stateDir, { type: 'directive_created', ts: now, directiveId: 'cmd-ui-clar', text: '给日常工具箱加一个每日格言小工具' })
  appendDirectiveEvent(stateDir, { type: 'directive_received', ts: now, directiveId: 'cmd-ui-clar', staffSessionId: 'staff-ui' })
  appendDirectiveEvent(stateDir, { type: 'directive_talking', ts: now, directiveId: 'cmd-ui-clar' })
  appendDirectiveEvent(stateDir, { type: 'directive_clarification_requested', ts: now, directiveId: 'cmd-ui-clar', questions: ['1. 工具箱指哪个仓？A 日常工具箱仓 / B 你帮我定', '2. 格言要英文还是中文？A 中文 / B 英文 / C 你帮我定'], options: [['日常工具箱仓', '你帮我定'], ['中文', '英文', '你帮我定']] })
  appendEvent(stateDir, { type: 'task_created', ts: now, campaignId: 'task-ui-1', title: '给 README 加安装一节', brief: 'b', acceptance: 'a', priority: 'normal' })
  appendEvent(stateDir, { type: 'task_submitted', ts: now, campaignId: 'task-ui-1', from: 'oc-exec-1', report: '安装一节已补：三步命令 + 前置条件清单。' })
  appendBridgeEvent(stateDir, { type: 'bridge_agent_message', ts: now, text: '收到——先看账面再答。', commandRefs: ['cmd-ui-clar'] })
  // D37：带 meta 的 agent 话轮（消息 meta 行的种子——模型·思考档·耗时·tokens）。
  appendBridgeEvent(stateDir, { type: 'bridge_agent_message', ts: now, text: '上一轮战报：两件事在跑，一件待签。', agentId: 'proxy-loop', meta: { model: 'glm-5.3', effort: 'deep', elapsedMs: 4200, promptTokens: 1200, completionTokens: 340 } })
  console.log(`种账完毕：clarify cmd-ui-clar + reported task-ui-1 + agent 话轮带 refs/meta（stateDir=${stateDir}）`)

  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STATE_DIR: stateDir, STARDECK_WAR_ROOT: warRoot, STARDECK_PORT: String(PORT), STARDECK_STAFF: '0', Z_AI_BASE_URL: `http://127.0.0.1:${gatePort}`, Z_AI_API_KEY: 'sk-ui-gate', STARDECK_PROXY_LOOP_MODEL: 'glm-5.3' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  daemon.stdout?.on('data', d => process.stdout.write(d))
  daemon.stderr?.on('data', d => process.stderr.write(d))
  for (let i = 0; ; i++) {
    try { const r = await fetch(`${base}/warroom/api/healthz`); if (r.ok) break } catch { /* not up */ }
    if (i > 60) throw new Error('UI 目检 daemon 30s 未活')
    await new Promise(r => setTimeout(r, 500))
  }
  const boardFace = await fetch(`${base}/warroom/api/board`).then(r => r.json()) as { bridge?: { enabled?: boolean } }
  check('daemon 旗面：/board 带 bridge.enabled（默认 ON）', boardFace.bridge?.enabled === true, JSON.stringify(boardFace.bridge ?? null))

  const pw = await import(pathToFileURL(playwrightCorePath()).href)
  const browser = await pw.chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 300)))
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)) })
  // ?cb= 强变更 URL（坑录：no-store 拦不住内存缓存旧 bundle）。
  await page.goto(`${base}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  // 舰队探测（12 席 --version spawn）settled 前是 loading 占位——门或聊天面
  // 都要等探测返回，40s 上限。门体锚=.war-gate-actions（root 是裸 war-root，
  // 不可作选择器——首版误用 .war-fleet-gate 恒 0 命中，门从未被真正进入）。
  await page.waitForSelector('.war-gate-actions, [data-bridge="1"]', { timeout: 40_000 })
  // 舰队门：选第一张可选席卡并开始调度（门文案「开始调度」）。
  if (await page.locator('.war-gate-actions').count() > 0) {
    const enterBtn = page.locator('button', { hasText: '开始调度' }).first()
    await enterBtn.waitFor({ state: 'visible', timeout: 10_000 })
    // D35 形态 A：门面 agent 接入卡（复制一条提示词）——进场前就在场。
    const agentCard = await page.locator('[data-war-agent-card]').count()
    const promptBtn = await page.locator('[data-war-agent-prompt-copy]').count()
    check('D35：门面 agent 接入卡+复制提示词钮在场', agentCard === 1 && promptBtn === 1, `card=${agentCard} btn=${promptBtn}`)
    await enterBtn.click()
  }
  // 默认脸面断言（2026-10-21 悬浮球改版）：看板恒为基座——板列在场、无抽屉。
  await page.waitForSelector('.war-dispatch, .war-col-body', { timeout: 15_000 })
  const drawerAtBoot = await page.locator('[data-bridge-panel]').count()
  check('默认脸面=看板基座（无浮窗自开）', drawerAtBoot === 0, `panel=${drawerAtBoot}`)
  // 悬浮球在场 + 待决角标=2（种账：1 澄清 + 1 验收）。
  await page.waitForSelector('[data-bridge-ball]', { timeout: 10_000 })
  const badge = await page.locator('[data-bridge-badge]').count()
  const badgeText = badge > 0 ? await page.locator('[data-bridge-badge]').first().textContent() : null
  check('悬浮球在场+待决角标', true, `badge=${badgeText ?? 'none'}`)
  await page.screenshot({ path: join(evidenceDir, 'board-base.png'), fullPage: false })
  // 球可拖动（舰长二定案）：拖到屏中——位置改变+持久化；聊天窗贴球择向弹出。
  const ballBox0 = await page.locator('[data-bridge-ball]').boundingBox()
  await page.mouse.move(ballBox0!.x + 27, ballBox0!.y + 27)
  await page.mouse.down()
  await page.mouse.move(700, 450, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const ballBox1 = await page.locator('[data-bridge-ball]').boundingBox()
  const moved = ballBox1 !== null && ballBox0 !== null && (Math.abs(ballBox1.x - ballBox0.x) > 100 || Math.abs(ballBox1.y - ballBox0.y) > 100)
  const posSaved = await page.evaluate(() => localStorage.getItem('warroom-tg-ball-pos') !== null)
  check('悬浮球可拖动（位置改变+持久化）', moved && posSaved, `moved=${moved} saved=${posSaved}`)
  // 键盘可达（D31 批判 P0）：焦点球 + Enter 开窗——不再是 pointer-only 死键。
  await page.locator('[data-bridge-ball]').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-bridge-panel]', { timeout: 5000 })
  check('球键盘可达：Enter 开聊天窗', true, 'keyboard enter')
  await page.locator('[data-bridge-panel-close]').click()
  await page.waitForSelector('[data-bridge-panel]', { state: 'detached', timeout: 5000 })
  // 点球开浮窗：Telegram 式聊天窗贴球弹出。
  await page.locator('[data-bridge-ball]').click()
  await page.waitForSelector('[data-bridge-panel]', { timeout: 10_000 })
  const ballBox2 = await page.locator('[data-bridge-ball]').boundingBox()
  const panelBox = await page.locator('[data-bridge-panel]').boundingBox()
  const anchored = ballBox2 !== null && panelBox !== null &&
    Math.hypot((panelBox.x + panelBox.width / 2) - (ballBox2.x + ballBox2.width / 2), (panelBox.y + panelBox.height / 2) - (ballBox2.y + ballBox2.height / 2)) < 520
  check('聊天窗贴球弹出（非抽屉）', anchored, `ball=(${Math.round(ballBox2?.x ?? -1)},${Math.round(ballBox2?.y ?? -1)}) panel=(${Math.round(panelBox?.x ?? -1)},${Math.round(panelBox?.y ?? -1)})`)
  check('点球开聊天窗', true, 'data-bridge-panel=1')
  // D33 舰长令：浮窗可自主调整大小——resize 手柄真拖放 + 尺寸持久化。
  const canResize = await page.locator('[data-bridge-panel]').evaluate(el => getComputedStyle(el).resize)
  check('浮窗可调大小（resize=both）', canResize === 'both', canResize)
  const pb0 = await page.locator('[data-bridge-panel]').boundingBox()
  if (pb0 !== null) {
    await page.mouse.move(pb0.x + pb0.width - 4, pb0.y + pb0.height - 4)
    await page.mouse.down()
    await page.mouse.move(pb0.x + pb0.width + 80, pb0.y + pb0.height + 80, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  const pb1 = await page.locator('[data-bridge-panel]').boundingBox()
  const sizeSaved = await page.evaluate(() => localStorage.getItem('warroom-tg-panel-size') !== null)
  check('拖手柄真变大+尺寸持久化', pb1 !== null && pb0 !== null && pb1.width > pb0.width + 40 && sizeSaved, `w ${Math.round(pb0?.width ?? 0)}→${Math.round(pb1?.width ?? 0)} saved=${sizeSaved}`)
  // 计算样式断言：消息区可滚、输入面真可见（DOM 在场≠可用——UI 交付教训）。
  const msgsScroll = await page.locator('[data-bridge-msgs]').evaluate(el => getComputedStyle(el).overflowY)
  check('计算样式：消息区可滚动（overflowY auto|scroll）', msgsScroll === 'auto' || msgsScroll === 'scroll', `overflowY=${msgsScroll}`)
  const inputBox = await page.locator('[data-bridge-input]').boundingBox()
  check('输入面真实可见（boundingBox 高>0）', inputBox !== null && inputBox.height > 10, JSON.stringify(inputBox?.height ?? null))
  // D33 B4：头部副行=动态状态（格言已迁空态欢迎语，短状态永不截断）。
  const statusText = await page.locator('[data-bridge-status]').first().textContent()
  check('B4：头部动态状态行（在线/离役）', (statusText ?? '').length > 0 && (statusText ?? '').includes('在线'), statusText ?? 'missing')
  // 决策坞：澄清卡（两问选项药丸）+ 验收卡双在场（抽屉内）。
  await page.waitForSelector('[data-bridge-card="clarify"]', { timeout: 15_000 })
  const pill = page.locator('[data-bridge-card="clarify"] .war-clarify-opt').first()
  await pill.waitFor({ state: 'visible', timeout: 10_000 })
  check('决策坞：澄清卡+选项药丸在场', true, await pill.textContent() ?? '')
  await page.waitForSelector('[data-bridge-card="review"]', { timeout: 10_000 })
  check('决策坞：验收卡在场（reported 任务）', true, 'review card')
  // 双重编号回归（UI 目检实抓）：大副问句自带「1. 」前缀，<ol> 再画一层=「1. 1.」。
  const doubleNum = await page.evaluate(() => (document.body.textContent ?? '').includes('1. 1.'))
  check('澄清问干无双重编号（模型前缀已剥）', !doubleNum, `doubleNum=${doubleNum}`)
  // D33 B2：决策坞滚动吸附卡边界——动作钮永不与卡头分离。
  const snapGeo = await page.locator('.war-bridge-dock').evaluate(el => {
    const dock = getComputedStyle(el)
    const card = el.querySelector('.war-bcard')
    return { snap: dock.scrollSnapType, align: card === null ? 'none' : getComputedStyle(card).scrollSnapAlign }
  })
  check('B2：决策坞滚动吸附（snap 启用+卡对齐 start）', snapGeo.snap !== 'none' && snapGeo.snap.includes('y') && snapGeo.align.includes('start'), JSON.stringify(snapGeo))
  // 选项药丸点选：已选摘要人话回显（D31 批判 P1——拼装码不泄漏给舰长）。
  await pill.click()
  await page.waitForSelector('[data-bridge-chosen]', { timeout: 5000 })
  const chosenText = await page.locator('[data-bridge-chosen]').textContent()
  check('选项药丸点选：已选摘要人话回显', (chosenText ?? '').includes('工具箱仓'), chosenText ?? 'empty')
  // D38.2 批判 P1 收口：半答闸——两问只答一问不可送达（防烧澄清轮预算）。
  const halfGate = await page.locator('[data-bridge-act="answer"]').isDisabled()
  check('D38.2：澄清半答闸——只答一问禁送达', halfGate === true, `disabled=${halfGate}`)
  const gateTitle = await page.locator('[data-bridge-act="answer"]').getAttribute('title')
  check('D38.2：半答闸带教学 title', (gateTitle ?? '').length > 0, gateTitle ?? 'missing')
  const gateHint = await page.locator('[data-bridge-gatehint]').count()
  check('D38.2：闸住原因内联常显（非悬停可达，复评 A 席 P3）', gateHint === 1, `hint=${gateHint}`)
  await page.locator('[data-bridge-card="clarify"] .war-clarify-opt').nth(2).click()
  await page.waitForTimeout(200)
  const fullGate = await page.locator('[data-bridge-act="answer"]').isDisabled()
  check('D38.2：两问全答解锁送达', fullGate === false, `disabled=${fullGate}`)
  const gateHintGone = await page.locator('[data-bridge-gatehint]').count()
  check('D38.2：全答后内联提示退场', gateHintGone === 0, `hint=${gateHintGone}`)
  // D38.2 批判 P2：浮窗开=板层指路 toast 让位（防半遮在面板下诱导误点「忽略」）。
  const hintCount = await page.locator('.war-map-hint').count()
  const toastDisplay = hintCount > 0 ? await page.locator('.war-map-hint').first().evaluate(el => getComputedStyle(el).display) : 'absent'
  check('D38.2：浮窗开=板层指路 toast 让位', toastDisplay === 'none' || toastDisplay === 'absent', `hints=${hintCount} display=${toastDisplay}`)
  await page.screenshot({ path: join(evidenceDir, 'chat-panel.png'), fullPage: false })
  // 关闭钮收浮窗 → 球再开（往返无损）。
  await page.locator('[data-bridge-panel-close]').click()
  await page.waitForSelector('[data-bridge-panel]', { state: 'detached', timeout: 5000 })
  check('关闭钮收浮窗', true, 'panel detached')
  await page.locator('[data-bridge-ball]').click()
  await page.waitForSelector('[data-bridge-input]', { timeout: 5000 })
  check('球再开浮窗：往返无损', true, 'panel again')
  // 发一说话：入账通道（fetch 落 /bridge/messages）。
  await page.locator('[data-bridge-input]').fill('界面目检：问声好。')
  await page.locator('[data-bridge-send]').click()
  await page.waitForFunction(async () => {
    const r = await fetch('/warroom/api/bridge/messages')
    const b = await r.json() as { messages?: Array<{ text: string }> }
    return (b.messages ?? []).some(m => m.text.includes('界面目检'))
  }, { timeout: 10_000 })
  check('聊天发话入账（消息流回读可见）', true, '界面目检：问声好。')
  // D33 B3：Enter 直发（Telegram 语法）。
  await page.locator('[data-bridge-input]').fill('回车直发：第二轮。')
  await page.locator('[data-bridge-input]').press('Enter')
  await page.waitForFunction(async () => {
    const r = await fetch('/warroom/api/bridge/messages')
    const b = await r.json() as { messages?: Array<{ text: string }> }
    return (b.messages ?? []).some(m => m.text.includes('回车直发'))
  }, { timeout: 10_000 })
  check('B3：Enter 直发入账', true, 'enter send')
  const clearedVal = await page.locator('[data-bridge-input]').inputValue()
  check('B3：Enter 发送后输入框清空', clearedVal === '', JSON.stringify(clearedVal))
  // ── D37 工具条三件 + meta 行 + 停止钮 e2e（浮窗开、输入在场时测）──
  await page.waitForSelector('[data-bridge-toolbar]', { timeout: 10_000 })
  const effortChip = await page.locator('[data-bridge-effort]').count()
  const effortText0 = effortChip > 0 ? await page.locator('[data-bridge-effort]').textContent() : null
  check('D37：思考档芯条在场（自动初相）', effortChip === 1 && (effortText0 ?? '').includes('自动'), effortText0 ?? 'missing')
  await page.locator('[data-bridge-effort]').click()
  await page.waitForFunction(() => document.querySelector('[data-bridge-effort]')?.getAttribute('data-bridge-effort') === 'fast', { timeout: 5_000 })
  const cfgEffort = await page.evaluate(async () => await (await fetch('/warroom/api/loop-config')).json()) as { effort?: string }
  check('D37：档位点击循环切换+落盘即时生效', cfgEffort.effort === 'fast', `effort=${cfgEffort.effort}`)
  const ctxChip = await page.locator('[data-bridge-ctx]').count()
  check('D37：上下文占用环在场', ctxChip === 1, `chip=${ctxChip}`)
  await page.locator('[data-bridge-ctx]').click()
  await page.waitForSelector('[data-bridge-ctxpanel]', { timeout: 5_000 })
  const panelRows = await page.locator('[data-bridge-ctxpanel] .war-ctx-row').count()
  check('D37：占用明细面板四段（教学/历史/账本/新话）', panelRows === 4, `rows=${panelRows}`)
  await page.locator('[data-bridge-ctx]').click() // 再点收起
  // meta 行：种子 agent 消息（effort=deep）带 模型·思考档·耗时·tokens 小字。
  await page.waitForFunction(() => [...document.querySelectorAll('.war-bmsg-meta')].some(el => (el.textContent ?? '').includes('深度') && (el.textContent ?? '').includes('glm-5.3')), { timeout: 5_000 })
  const metaLine = await page.locator('.war-bmsg-meta', { hasText: 'glm-5.3' }).filter({ hasText: '深度' }).first().textContent()
  check('D37：agent 消息 meta 行（模型·思考档·耗时·tokens）', (metaLine ?? '').includes('4.2s') === true && (metaLine ?? '').includes('1.2k') === true, metaLine ?? 'missing')
  // 停止钮 e2e：慢答轮（思考流已上屏、正文未出）→ 发送钮变 ■停止 → 点击 →
  // 「已停止」terminal 战报 + 按钮复位（不降级——staff=0 也起不了 CLI 席）。
  await page.locator('[data-bridge-input]').fill('慢点答：讲讲舰队现状')
  await page.locator('[data-bridge-send]').click()
  await page.waitForSelector('[data-bridge-reasoning]', { timeout: 20_000 })
  // D38.1：思考恒折叠一行（摘要行带尾部预览）——不再正文未出时自动展开满屏。
  const reasoningState = await page.locator('[data-bridge-reasoning]').evaluate(el => ({
    open: (el as HTMLDetailsElement).open,
    peek: (el.querySelector('.war-bmsg-reasoning-peek')?.textContent ?? '').length,
  }))
  check('D38.1：思考恒折叠一行（不自动展开+尾部预览在场）', reasoningState.open === false && reasoningState.peek > 0, JSON.stringify(reasoningState))
  const stopBtn = await page.locator('[data-bridge-stop]').count()
  check('D37：在途轮发送钮变停止（■）', stopBtn === 1, `stop=${stopBtn}`)
  await page.screenshot({ path: join(evidenceDir, 'd37-live-stop.png'), fullPage: false })
  await page.locator('[data-bridge-stop]').click()
  await page.waitForFunction(() => (document.body.textContent ?? '').includes('已停止本轮应答'), { timeout: 10_000 })
  check('D37：停止→「已停止」terminal 战报（不降级）', true, 'terminal notice')
  await page.waitForSelector('[data-bridge-stop]', { state: 'detached', timeout: 10_000 })
  check('D37：停止后发送钮复位', true, 'stop detached')
  await page.screenshot({ path: join(evidenceDir, 'd37-toolbar.png'), fullPage: false })
  // ── D38 新设计语言断言（深色默认/玻璃面板/composer 一体卡/状态单槽/meta 弱化）──
  const darkDefault = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  check('D38：首跑深色默认（无存储偏好即 dark）', darkDefault, `dark=${darkDefault}`)
  const panelGeo = await page.locator('[data-bridge-panel]').evaluate(el => {
    const s = getComputedStyle(el)
    return { radius: s.borderRadius, blur: s.backdropFilter || s.webkitBackdropFilter }
  })
  check('D38：面板 16px 大圆角', panelGeo.radius === '16px', `radius=${panelGeo.radius}`)
  check('D38：面板玻璃材质（backdrop-filter blur 在场）', panelGeo.blur.includes('blur'), panelGeo.blur)
  const composerGeo = await page.locator('[data-bridge-composer]').evaluate(el => ({
    exists: el !== null,
    hasInput: el.querySelector('[data-bridge-input]') !== null,
    hasToolbar: el.querySelector('[data-bridge-toolbar]') !== null,
    radius: getComputedStyle(el).borderRadius,
  }))
  check('D38：composer 一体卡（内含输入+工具条，16px 圆角）', composerGeo.exists && composerGeo.hasInput && composerGeo.hasToolbar && composerGeo.radius === '16px', JSON.stringify(composerGeo))
  const sendGeo = await page.locator('[data-bridge-send]').evaluate(el => getComputedStyle(el).borderRadius)
  check('D38：圆形 3D 发送钮（border-radius 50%）', sendGeo === '50%', `radius=${sendGeo}`)
  const noteCount = await page.locator('.war-composer-note').count()
  check('D38：状态单槽（提示互斥呈现，≤1 行）', noteCount <= 1, `notes=${noteCount}`)
  const metaColor = await page.locator('.war-bmsg-meta').first().evaluate(el => getComputedStyle(el).color)
  // D38 批判 P1 修后 meta=text-2 实色（text-3 曾 4.3:1、opacity .5 时 2.2:1 不达 AA）。
  check('D38：meta 行弱化但不失读（text-2 实色，D38.2 白α阶梯）', metaColor === 'rgba(255, 255, 255, 0.62)', metaColor)
  // D38.1：字号滑杆热跟随到浮窗 + 面板可见描边（暗色层级=更亮表面+读得出的边）。
  const fsBefore = await page.locator('[data-bridge-panel]').evaluate(el => getComputedStyle(el).getPropertyValue('--war-fs').trim())
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('warroom-fs', { detail: 1.2 })) })
  await page.waitForTimeout(150)
  const fsHot = await page.locator('[data-bridge-panel]').evaluate(el => ({
    fs: getComputedStyle(el).getPropertyValue('--war-fs').trim(),
    chipFont: getComputedStyle(document.querySelector('[data-bridge-effort]') ?? el).fontSize,
  }))
  check('D38.1：字号滑杆管到浮窗（warroom-fs 热跟随）', fsBefore === '1' && fsHot.fs === '1.2' && parseFloat(fsHot.chipFont) > 13, `before=${fsBefore} hot=${JSON.stringify(fsHot)}`)
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('warroom-fs', { detail: 1 })) })
  const panelBorder = await page.locator('[data-bridge-panel]').evaluate(el => getComputedStyle(el).borderTopColor)
  check('D38.2：面板白α描边（Raycast 月光线稿，批判轮提阶 α.14）', panelBorder === 'rgba(255, 255, 255, 0.14)', panelBorder)
  await page.screenshot({ path: join(evidenceDir, 'd38-panel-dark.png'), fullPage: false })
  // D33 B1：点穿聚焦页浮窗保持开（种子战报卡带「打开聚焦页」钮）。
  const refBtn = page.locator('.war-bref').first()
  if (await refBtn.count() > 0) {
    await refBtn.click()
    await page.waitForTimeout(300)
    const panelStill = await page.locator('[data-bridge-panel]').count()
    const hashNow = await page.evaluate(() => location.hash)
    check('B1：点穿聚焦页浮窗保持开', panelStill === 1, `panel=${panelStill} hash=${hashNow}`)
  } else {
    check('B1：点穿聚焦页浮窗保持开', false, 'war-bref 缺席（种子不足）')
  }
  // B1 点穿后聚焦页模态开在浮窗之上——先 Esc 收模态再继续（否则盖住后续点击）。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  // D33 B7：双击球复位默认位（此前拖拽测试已把球拖到屏中）。
  await page.locator('[data-bridge-panel-close]').click()
  await page.waitForSelector('[data-bridge-panel]', { state: 'detached', timeout: 5000 })
  const bAway = await page.locator('[data-bridge-ball]').boundingBox()
  await page.locator('[data-bridge-ball]').dblclick()
  await page.waitForTimeout(300)
  const bHome = await page.locator('[data-bridge-ball]').boundingBox()
  const homeOk = bHome !== null && Math.abs(bHome.x - (1440 - 18 - 54)) < 8 && Math.abs(bHome.y - (900 - 18 - 54)) < 8
  check('B7：双击球复位默认位', homeOk, `away=(${Math.round(bAway?.x ?? -1)},${Math.round(bAway?.y ?? -1)}) home=(${Math.round(bHome?.x ?? -1)},${Math.round(bHome?.y ?? -1)})`)
  // 设置归拢（2026-10-21 定案）：唯一设置面=看板设置抽屉——含明暗开关与
  // 定夺授权段（迷你弹层退役后的对位断言）。
  await page.waitForSelector('[data-bridge-panel]', { state: 'detached', timeout: 5000 })
  await page.locator('button[aria-label="设置"], button[aria-label="Settings"]').first().click()
  await page.waitForSelector('.war-settings-drawer', { timeout: 10_000 })
  const authCount = await page.locator('[data-bridge-auth]').count()
  const authGrant = await page.locator('[data-bridge-auth-grant]').count()
  const darkSwitch = await page.locator('.war-settings-drawer .war-switch').count()
  check('设置归拢：板设置抽屉含定夺授权段', authCount > 0 && authGrant > 0, `auth=${authCount} grant=${authGrant}`)
  check('设置归拢：明暗开关在看板抽屉（standalone）', darkSwitch > 0, `switches=${darkSwitch}`)
  // D34 舰长令：模型设置独立弹窗——抽屉里一行摘要+「模型设置…」钮，点开弹窗。
  const launchBtn = await page.locator('[data-loopcfg-open]').count()
  const launchSummary = await page.locator('[data-looplaunch-summary]').count()
  check('D34：抽屉内模型行摘要+打开钮在场', launchBtn === 1 && launchSummary === 1, `btn=${launchBtn} summary=${launchSummary}`)
  await page.click('[data-loopcfg-open]')
  await page.waitForSelector('[data-loopdlg]', { timeout: 5000 })
  const drawerStill = await page.locator('.war-settings-drawer').count()
  const dlgTest = await page.locator('[data-loopdlg] [data-loopcfg-test]').count()
  const dlgSave = await page.locator('[data-loopdlg] [data-loopcfg-save]').count()
  check('D34：模型设置弹窗开在抽屉之上（表单+动作条齐）', drawerStill === 1 && dlgTest === 1 && dlgSave === 1, `drawer=${drawerStill} test=${dlgTest} save=${dlgSave}`)
  await page.evaluate(async () => { await fetch('/warroom/api/loop-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-5.2' }) }) })
  const fleetLoop = await page.evaluate(async () => await (await fetch('/warroom/api/fleet')).json()) as { loopModel?: string; loopKeySource?: string }
  check('段3：loop-config POST 即时生效（/fleet 回读）', fleetLoop.loopModel === 'glm-5.2', `loopModel=${fleetLoop.loopModel} keySource=${fleetLoop.loopKeySource}`)
  // D34 供应商中立化（照搬 zcode 注册表）：供应商药丸/点选填表/领 key 链接/统一契约。
  const provPills = await page.locator('[data-loopcfg-providers] [data-loopcfg-preset]').count()
  check('D34：供应商药丸行（8 预设+自定义）', provPills === 9, `pills=${provPills}`)
  await page.click('[data-loopcfg-preset="deepseek"]')
  await page.waitForTimeout(200)
  const dsBase = await page.locator('[data-loopcfg-base]').inputValue()
  const dsModel = await page.locator('[data-loopcfg-model]').inputValue()
  const getKey = await page.locator('[data-loopcfg-getkey]').count()
  const modelOpts = await page.locator('[data-loopcfg-modelopts] [data-loopcfg-modelopt]').count()
  check('D34：点供应商=填表（DeepSeek 基址/模型/领 key 链接/快捷药丸）', dsBase.includes('api.deepseek.com') && dsModel !== '' && getKey === 1 && modelOpts > 0, `base=${dsBase} model=${dsModel} getKey=${getKey} opts=${modelOpts}`)
  const afterDs = await page.evaluate(async () => await (await fetch('/warroom/api/loop-config')).json()) as { model?: string }
  check('D34：统一契约——药丸只填表不落盘（daemon 仍 glm-5.2）', afterDs.model === 'glm-5.2', `daemon model=${afterDs.model}`)
  // Esc 层序：弹窗后入栈——Esc 关弹窗、抽屉保持开。
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-loopdlg]', { state: 'detached', timeout: 5000 })
  const drawerAfterEsc = await page.locator('.war-settings-drawer').count()
  check('D34：Esc 只关弹窗（抽屉保持开）', drawerAfterEsc === 1, `drawer=${drawerAfterEsc}`)
  await page.screenshot({ path: join(evidenceDir, 'settings-consolidated.png'), fullPage: false })
  // ── D38.2 Raycast 语系断言：流光开窗/kbd 芯片/obsidian 面梯 ──
  // 此前流程已把浮窗关掉（设置抽屉段）——先 Esc 收抽屉（D34 段留开）再点球重开。
  await page.keyboard.press('Escape')
  await page.waitForSelector('.war-settings-drawer', { state: 'detached', timeout: 5000 })
  await page.locator('[data-bridge-ball]').click()
  await page.waitForSelector('[data-bridge-panel]', { timeout: 5000 })
  await page.waitForTimeout(300)
  const shine = await page.locator('[data-bridge-panel]').evaluate(el => getComputedStyle(el, '::before').animationName)
  check('D38.2：开窗流光描边动画在场（war-shine）', shine === 'war-shine', shine)
  const kbdInCard = await page.locator('[data-bridge-card="clarify"] .war-kbd').count()
  const kbdInToolbar = await page.locator('[data-bridge-toolbar] .war-kbd').count()
  check('D38.2：kbd 芯片一等公民（澄清卡主钮+composer ⏎）', kbdInCard === 1 && kbdInToolbar === 1, `card=${kbdInCard} toolbar=${kbdInToolbar}`)
  const obsidian = await page.locator('.war-zone').first().evaluate(el => getComputedStyle(el).backgroundColor)
  check('D38.2：obsidian 面梯（zone=#121214）', obsidian === 'rgb(18, 18, 20)', obsidian)
  // D38.2 复评批次：键位总览弹层（? 芯片 toggle，ctx-panel 同法）+ 消息流顶部淡出。
  await page.locator('[data-bridge-keys]').click()
  await page.waitForSelector('[data-bridge-keyspanel]', { timeout: 5000 })
  const keysRows = await page.locator('.war-keys-row').count()
  check('D38.2：键位总览弹层（? 开·四行真键位，复评双席 #10）', keysRows === 4, `rows=${keysRows}`)
  await page.locator('[data-bridge-keys]').click()
  await page.waitForSelector('[data-bridge-keyspanel]', { state: 'detached', timeout: 5000 })
  const msgsFade = await page.locator('[data-bridge-msgs]').evaluate(el => getComputedStyle(el).maskImage)
  check('D38.2：消息流顶部 12px 淡出（滚出内容不硬切，复评 B 席 #8）', msgsFade.includes('linear-gradient'), msgsFade)
  await page.screenshot({ path: join(evidenceDir, 'd382-panel-dark.png'), fullPage: false })
  // D38 浅色往返：显式选浅 → 重载后深色属性摘除（浅色一等公民），截图存证。
  // 重载后落回舰队门（门在时球不渲染）——与开场同法：门在场先点「开始调度」。
  await page.evaluate(() => { try { localStorage.setItem('warroom-standalone-theme', 'light') } catch { /* 隐私模式 */ } })
  await page.goto(`${base}/?cb=${Date.now() + 1}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.war-gate-actions, [data-bridge-ball]', { timeout: 40_000 })
  if (await page.locator('.war-gate-actions').count() > 0) {
    await page.locator('button', { hasText: '开始调度' }).first().click()
  }
  await page.waitForSelector('[data-bridge-ball]', { timeout: 20_000 })
  const lightBoot = await page.evaluate(() => !document.body.hasAttribute('data-ds-dark-theme'))
  check('D38：显式选浅=深色属性摘除（浅色往返）', lightBoot, `light=${lightBoot}`)
  await page.screenshot({ path: join(evidenceDir, 'd38-board-light.png'), fullPage: false })
  // D38.2：浅色面板一等公民——浅色往返后重开浮窗，玻璃配方走 token 自洽
  // （浅 pop=#fff → 96% 玻璃=近白实底），对照深色黑曜石存证。
  await page.locator('[data-bridge-ball]').click()
  await page.waitForSelector('[data-bridge-panel]', { timeout: 5000 })
  await page.waitForTimeout(300)
  const lightPanelBg = await page.locator('[data-bridge-panel]').evaluate(el => getComputedStyle(el).backgroundColor)
  // Chromium 新版把 color-mix 结果序列化为 color(srgb …) 形状——两形状都认。
  const lightPanelOk = lightPanelBg === 'rgba(255, 255, 255, 0.96)' || lightPanelBg === 'color(srgb 1 1 1 / 0.96)'
  check('D38.2：浅色面板=近白玻璃（96% pop）', lightPanelOk, lightPanelBg)
  await page.screenshot({ path: join(evidenceDir, 'd382-panel-light.png'), fullPage: false })
  await browser.close()
} catch (err) {
  exitCode = 1
  // 判决诚实刀：中途异常必须计入 results——否则已完成断言全绿时控制台仍打
  // PASS（exitCode 只对脚本退出码负责， verdict 行会骗人）。
  results.push({ name: '流程完整性（无中途异常）', pass: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) })
  console.error('UI 目检异常：', err instanceof Error ? err.message : String(err))
} finally {
  daemon?.kill()
  await new Promise(r => setTimeout(r, 500))
  try { gate?.close() } catch { /* best-effort */ }
  writeFileSync(join(evidenceDir, 'ui-check-results.json'), JSON.stringify(results, null, 2), 'utf8')
  try { rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }) } catch { /* 断言已出，清理 best-effort */ }
}
const failed = results.filter(r => !r.pass)
console.log(failed.length === 0 ? `BRIDGE UI PASS（${results.length}/${results.length}）` : `BRIDGE UI FAIL（${failed.length} 红）`)
process.exit(exitCode === 0 && failed.length === 0 ? 0 : 1)
