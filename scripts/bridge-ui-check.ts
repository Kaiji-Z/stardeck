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
  console.log(`种账完毕：clarify cmd-ui-clar + reported task-ui-1（stateDir=${stateDir}）`)

  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
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
  const gateProbe = (): Promise<Record<string, unknown>> => page.evaluate(() => ({
    gate: document.querySelector('.war-fleet-gate, [style*="z-index: 50"]') !== null,
    chat: document.querySelectorAll('[data-bridge="1"]').length,
    phaseHint: (document.body.textContent ?? '').includes('选择舰队'),
  }))
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
  // 默认脸面断言：聊天窗在场（bridge 面带出后 shell 落 chat）。
  await page.waitForSelector('[data-bridge="1"]', { timeout: 15_000 })
  check('默认脸面=聊天窗（舰队门后直落 chat）', true, 'data-bridge=1 在场')
  // 计算样式断言：消息区可滚、输入面真可见（DOM 在场≠可用——UI 交付教训）。
  const msgsScroll = await page.locator('[data-bridge-msgs]').evaluate(el => getComputedStyle(el).overflowY)
  check('计算样式：消息区可滚动（overflowY auto|scroll）', msgsScroll === 'auto' || msgsScroll === 'scroll', `overflowY=${msgsScroll}`)
  const inputBox = await page.locator('[data-bridge-input]').boundingBox()
  check('输入面真实可见（boundingBox 高>0）', inputBox !== null && inputBox.height > 10, JSON.stringify(inputBox?.height ?? null))
  // 决策坞：澄清卡（两问选项药丸）+ 验收卡双在场。
  await page.waitForSelector('[data-bridge-card="clarify"]', { timeout: 15_000 })
  console.log('probe A (cards ready):', JSON.stringify(await gateProbe()))
  const pill = page.locator('[data-bridge-card="clarify"] .war-clarify-opt').first()
  await pill.waitFor({ state: 'visible', timeout: 10_000 })
  check('决策坞：澄清卡+选项药丸在场', true, await pill.textContent() ?? '')
  await page.waitForSelector('[data-bridge-card="review"]', { timeout: 10_000 })
  check('决策坞：验收卡在场（reported 任务）', true, 'review card')
  // 选项药丸点选拼装 1A（三信号之 mut：textarea 值变化）。
  await pill.click()
  console.log('probe B (after pill click):', JSON.stringify(await gateProbe()))
  await page.waitForFunction(() => {
    const tas = [...document.querySelectorAll('textarea')] as HTMLTextAreaElement[]
    return tas.some(t => (t.value ?? '').includes('1A'))
  }, { timeout: 5000 })
  check('选项药丸点选拼装 1A 入答复框', true, '1A')
  await page.screenshot({ path: join(evidenceDir, 'chat-default.png'), fullPage: false })
  // WATCH 模式（BRIDGE_UI_WATCH=1）：零脚本点击静置 15s，捕获-phase 记录一切
  // 点击 + 门翻转时刻——三态药丸若被异步事件翻走，在这里抓现行。
  if (process.env.BRIDGE_UI_WATCH === '1') {
    await page.evaluate(() => {
      // sessionStorage 跨重载存活：t0/点击史在重载后仍可比对（window 变量会被抹）。
      sessionStorage.setItem('__t0', String(Math.round(performance.timeOrigin)))
      sessionStorage.setItem('__clicks', '[]')
      document.addEventListener('click', e => {
        const t = e.target as HTMLElement
        const prev = JSON.parse(sessionStorage.getItem('__clicks') ?? '[]') as unknown[]
        prev.push({ cls: String(t.className).slice(0, 40), txt: (t.textContent ?? '').slice(0, 20), x: e.clientX, y: e.clientY })
        sessionStorage.setItem('__clicks', JSON.stringify(prev))
      }, true)
    })
    console.log('WATCH: 静置 15s 观察门翻转…')
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500))
      const st = await page.evaluate(() => ({
        gate: document.querySelector('[style*="z-index: 50"]') !== null,
        reloaded: Math.round(performance.timeOrigin) !== Number(sessionStorage.getItem('__t0') ?? '0'),
        clicks: (JSON.parse(sessionStorage.getItem('__clicks') ?? '[]') as unknown[]).length,
      }))
      if (st.gate) {
        const clicks = await page.evaluate(() => sessionStorage.getItem('__clicks') ?? '[]')
        console.log('WATCH: 门翻转！reloaded=' + st.reloaded + ' clicks=' + st.clicks + ' 史:', clicks)
        check('WATCH：静置期门不回翻（舰队门不复活）', false, `reloaded=${st.reloaded} clicks=${st.clicks}`)
        break
      }
    }
  }
  // 诊断探针：三态药丸若缺席，落 DOM 快照供排查（渲染层回归的证据面）。
  const switchProbe = await page.evaluate(() => ({
    buttons: document.querySelectorAll('[data-bridge-view]').length,
    switchDiv: document.querySelector('.war-bridge-switch') !== null,
    chatPane: document.querySelectorAll('[data-bridge="1"]').length,
    viewKey: localStorage.getItem('warroom-bridge-view'),
    modalLabels: [...document.querySelectorAll('.war-modal')].map(m => m.getAttribute('aria-label') ?? m.className).slice(0, 4),
    html: document.body.innerHTML.slice(0, 2000),
  }))
  console.log('switch probe:', JSON.stringify(switchProbe))
  // 三态切换：分屏旁观（聊天+板双 pane）→ 看板全屏。
  await page.locator('[data-bridge-view="split"]').click()
  await page.waitForSelector('.war-dispatch, .war-col-body', { timeout: 15_000 })
  const splitChat = await page.locator('[data-bridge="1"]').count()
  check('分屏旁观：聊天 pane 与板 pane 同屏', splitChat > 0, `chat pane=${splitChat}`)
  await page.screenshot({ path: join(evidenceDir, 'split-observatory.png'), fullPage: false })
  await page.locator('[data-bridge-view="board"]').click()
  await page.waitForSelector('.war-dispatch, .war-col-body', { timeout: 15_000 })
  const boardOnly = await page.locator('[data-bridge="1"]').count()
  check('看板全屏：亲自下令面在场（聊天 pane 退场）', boardOnly === 0, `chat pane=${boardOnly}`)
  await page.screenshot({ path: join(evidenceDir, 'board-full.png'), fullPage: false })
  await page.locator('[data-bridge-view="chat"]').click()
  await page.waitForSelector('[data-bridge-input]', { timeout: 10_000 })
  check('一键回聊天：三态往返无损', true, 'chat again')
  // 发一说话：入账通道（fetch 落 /bridge/messages）。
  await page.locator('[data-bridge-input]').fill('界面目检：问声好。')
  await page.locator('[data-bridge-send]').click()
  await page.waitForFunction(async () => {
    const r = await fetch('/warroom/api/bridge/messages')
    const b = await r.json() as { messages?: Array<{ text: string }> }
    return (b.messages ?? []).some(m => m.text.includes('界面目检'))
  }, { timeout: 10_000 })
  check('聊天发话入账（消息流回读可见）', true, '界面目检：问声好。')
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
