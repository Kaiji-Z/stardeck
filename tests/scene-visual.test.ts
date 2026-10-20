/**
 * D28 图景 UI 目检（opt-in：STARDECK_SCENE_CHECK=1 才跑——Playwright 依赖借自
 * 邻仓 ielts-cbt，不入本仓依赖）：起真 daemon（attach-face 同款 spawn——独立
 * bash 直跑同命令会踩 cli.ts isMain 守卫的盘符规范化失配，test-runner 上下文
 * 稳）→ 种 artifact 话轮 → 断言聊天窗图景 iframe（在场/sandbox=''/src/计算样式
 * 可见）+ artifact 端点 200+CSP+零 script——截图落 .goal/evidence/scene/。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const run = process.env.STARDECK_SCENE_CHECK === '1'

test('D28 图景 UI 目检（真 daemon + Playwright：iframe sandbox + CSP + 零 script + 截图）', { skip: run ? false : 'opt-in：STARDECK_SCENE_CHECK=1' }, async () => {
  const require2 = createRequire('file:///C:/Users/kaiji/vibecodingKJ/projects/ielts-cbt/package.json')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 借邻仓 playwright，形状在调用点断言
  const { chromium } = require2('playwright') as any

  const PORT = 3973
  const stateDir = mkdtempSync(join(tmpdir(), 'stardeck-scene-ui-'))
  const evidence = join(repoRoot, '.goal', 'evidence', 'scene')
  mkdirSync(evidence, { recursive: true })
  mkdirSync(join(stateDir, 'artifacts'), { recursive: true })
  writeFileSync(join(stateDir, 'artifacts', 'scene-check1.html'),
    '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>舰队晨报</title><style>body{margin:0;padding:20px;background:#0d1117;color:#d6dde6}h1{font-size:19px}</style></head><body><h1>舰队晨报</h1><p>三条线并进，一条待你验收。</p></body></html>', 'utf8')

  const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(PORT), STARDECK_STATE_DIR: stateDir, STARDECK_OPENCODE_DB: join(stateDir, 'oc.db') },
    stdio: 'ignore',
  })
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(`http://127.0.0.1:${PORT}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
      if (!up) await new Promise(r => setTimeout(r, 500))
    }
    assert.ok(up, 'daemon 30s 未活')
    // 首跑舰队门：先绑 opencode（与 live 门同款），聊天视图不被门挡。
    await fetch(`http://127.0.0.1:${PORT}/warroom/api/fleet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ executor: 'opencode', model: 'zai-coding-plan/glm-5.3' }) })

    await fetch(`http://127.0.0.1:${PORT}/warroom/api/bridge/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '用一页图景讲讲现在舰队的情况' }) })
    const { appendBridgeEvent } = await import('../src/bridge.ts')
    appendBridgeEvent(stateDir, { type: 'bridge_agent_message', ts: new Date().toISOString(), text: '配一页图景给你看——时间线、数据、条目都来自速览。', agentId: 'proxy-check', artifact: { id: 'scene-check1', title: '舰队晨报' } })

    const browser = await chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const tab = await ctx.newPage()
      await tab.goto(`http://127.0.0.1:${PORT}/?cb=d28scene`, { waitUntil: 'domcontentloaded' })
      // 首载舰队门必现（phase=entry 恒真直到点钮——外部 POST /fleet 只预填卡面，
      // 不解门）。门钮=war-gate-actions 里的「开始调度」（entry 相位唯一钮，
      // 卡面已预选 opencode+预填模型串，点击重发同值绑定后入板）。
      await tab.waitForSelector('.war-gate-actions button', { timeout: 30_000 })
      await tab.click('.war-gate-actions button')
      try {
        await tab.waitForSelector('iframe.war-bmsg-scene', { timeout: 15_000 })
      } catch (err) {
        await tab.screenshot({ path: join(evidence, 'scene-fail-debug.png') }).catch(() => {})
        throw err
      }
      await new Promise(r => setTimeout(r, 1200))
      const frame = tab.locator('iframe.war-bmsg-scene')
      assert.equal(await frame.getAttribute('sandbox'), '', 'sandbox 空串=禁脚本禁同源')
      assert.ok((await frame.getAttribute('src') ?? '').includes('/warroom/api/artifact/scene-check1'), 'src 指 artifact 端点')
      const box = await frame.boundingBox()
      assert.ok(box !== null && box.height >= 200, `iframe 计算样式可见（高 ${box?.height ?? 0}px）`)
      const artifactRes = await fetch(`http://127.0.0.1:${PORT}/warroom/api/artifact/scene-check1`)
      const artifactHtml = await artifactRes.text()
      assert.equal(artifactRes.status, 200)
      assert.ok((artifactRes.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), 'CSP default-src none')
      assert.ok(!artifactHtml.includes('<script'), '图页零 <script>')
      await tab.screenshot({ path: join(evidence, 'scene-chat.png') })
    } finally {
      await browser.close()
    }
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 500))
    try { rmSync(stateDir, { recursive: true, force: true }) } catch { /* 句柄竞态不致命 */ }
  }
})
