/**
 * D26 舰桥频道 UI 目检（v0.3.0 交付判据 6）：起隔离 daemon → 种待决账本 →
 * Playwright 实览三态——默认脸面=聊天窗（计算样式断言：消息区可滚/输入面
 * 可见）、澄清决策卡药丸点选拼装、分屏旁观双-pane 在场、看板全屏可回。
 * 截图存 .goal/evidence/bridge/。纪律：domcontentloaded+显式等待（SSE 挡
 * networkidle）、?cb= 强变更 URL（防内存缓存旧 bundle）。
 * 启动：node --import tsx scripts/bridge-ui-check.ts（cwd=仓库根）
 */
import { spawn, type ChildProcess } from 'node:child_process'
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
let exitCode = 0
try {
  // ── 种账本：挂起澄清（带选项）+ reported 任务 → 聊天决策坞两卡齐 ──
  const now = new Date().toISOString()
  appendDirectiveEvent(stateDir, { type: 'directive_created', ts: now, directiveId: 'cmd-ui-clar', text: '给日常工具箱加一个每日格言小工具' })
  appendDirectiveEvent(stateDir, { type: 'directive_received', ts: now, directiveId: 'cmd-ui-clar', staffSessionId: 'staff-ui' })
  appendDirectiveEvent(stateDir, { type: 'directive_talking', ts: now, directiveId: 'cmd-ui-clar' })
  appendDirectiveEvent(stateDir, { type: 'directive_clarification_requested', ts: now, directiveId: 'cmd-ui-clar', questions: ['1. 工具箱指哪个仓？A 日常工具箱仓 / B 你帮我定', '2. 格言要英文还是中文？A 中文 / B 英文 / C 你帮我定'], options: [['日常工具箱仓', '你帮我定'], ['中文', '英文', '你帮我定']] })
  appendEvent(stateDir, { type: 'task_created', ts: now, campaignId: 'task-ui-1', title: '给 README 加安装一节', brief: 'b', acceptance: 'a', priority: 'normal' })
  appendEvent(stateDir, { type: 'task_submitted', ts: now, campaignId: 'task-ui-1', from: 'oc-exec-1', report: '安装一节已补：三步命令 + 前置条件清单。' })
  appendBridgeEvent(stateDir, { type: 'bridge_agent_message', ts: now, text: '收到——先看账面再答。', commandRefs: ['cmd-ui-clar'] })
  console.log(`种账完毕：clarify cmd-ui-clar + reported task-ui-1 + agent 话轮带 refs（stateDir=${stateDir}）`)

  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_CONFIG: join(stateDir, 'config.json'), STARDECK_STATE_DIR: stateDir, STARDECK_WAR_ROOT: warRoot, STARDECK_PORT: String(PORT), STARDECK_STAFF: '0' },
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
  // D33 段3：对话模型配置段（预设/自定义/基址/key 掩码/来源行/测试连接/保存）。
  const loopcfg = await page.locator('[data-loopcfg]').count()
  const testBtn = await page.locator('[data-loopcfg-test]').count()
  const srcLine = await page.locator('[data-loopcfg-source]').first().getAttribute('data-loopcfg-source')
  check('段3：对话模型配置段在场', loopcfg > 0 && testBtn > 0, `section=${loopcfg} testBtn=${testBtn} keySource=${srcLine}`)
  await page.evaluate(async () => { await fetch('/warroom/api/loop-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-5.3-highspeed' }) }) })
  const fleetLoop = await page.evaluate(async () => await (await fetch('/warroom/api/fleet')).json()) as { loopModel?: string; loopKeySource?: string }
  check('段3：loop-config POST 即时生效（/fleet 回读）', fleetLoop.loopModel === 'glm-5.3-highspeed', `loopModel=${fleetLoop.loopModel} keySource=${fleetLoop.loopKeySource}`)
  await page.screenshot({ path: join(evidenceDir, 'settings-consolidated.png'), fullPage: false })
  await browser.close()
} catch (err) {
  exitCode = 1
  console.error('UI 目检异常：', err instanceof Error ? err.message : String(err))
} finally {
  daemon?.kill()
  await new Promise(r => setTimeout(r, 500))
  writeFileSync(join(evidenceDir, 'ui-check-results.json'), JSON.stringify(results, null, 2), 'utf8')
  try { rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }) } catch { /* 断言已出，清理 best-effort */ }
}
const failed = results.filter(r => !r.pass)
console.log(failed.length === 0 ? `BRIDGE UI PASS（${results.length}/${results.length}）` : `BRIDGE UI FAIL（${failed.length} 红）`)
process.exit(exitCode === 0 && failed.length === 0 ? 0 : 1)
