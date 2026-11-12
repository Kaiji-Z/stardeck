/**
 * stardeck 桌面壳（D30）：Electron 主进程。
 * 生命周期：单实例锁 → 探活/拉起内置 daemon（Electron 自带 node 直跑
 * dist/cli.mjs——用户机器无需装 Node）→ 等就绪 → BrowserWindow 载板 UI →
 * 关窗=进托盘；托盘退出=杀 daemon 进程树再退。已有 daemon 在跑（用户自起
 * 的/别的壳）则复用不重复拉、退出也不杀（谁生的谁管）。
 * @module stardeck-desktop/main
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
const DIST_DIR = isDev ? join(__dirname, '..', '..', 'dist') : join(process.resourcesPath, 'stardeck', 'dist')
// getAppPath()：dev=desktop/ 项目根、打包=resources/app.asar——两态一式，且
// nativeImage/BrowserWindow icon 都认 asar 内路径。旧写法 join(resourcesPath,
// 'app', …) 在 asar 打包下指向不存在的目录（实体是 app.asar），托盘图标
// 静默空白——「关窗进托盘」的壳等于失去唯一可见出口。
const ASSETS_DIR = join(app.getAppPath(), 'assets')
const CLI = join(DIST_DIR, 'cli.mjs')
// 端口解析与 daemon loadConfig 同序：env > ~/.stardeck/config.json 的 port >
// 3970——纯 config 文件改口的用户不再被壳探活 30s 假死（daemon 其实在另一口
// 正常起服）。STARDECK_CONFIG 指到别处时同样尊重。
const configFilePort = () => {
  try {
    const p = process.env.STARDECK_CONFIG ?? join(app.getPath('home'), '.stardeck', 'config.json')
    const cfg = JSON.parse(readFileSync(p, 'utf8'))
    if (typeof cfg?.port === 'number' && cfg.port > 0) return cfg.port
  } catch { /* 缺省/坏 JSON → 默认口 */ }
  return undefined
}
const PORT = Number(process.env.STARDECK_PORT ?? configFilePort() ?? 3970)
const BASE = `http://127.0.0.1:${PORT}`

// D30 实弹：本机 AppData 整条是 C:→D: junction——Chromium ProcessSingleton 对
// junction 化 userData 挂死（requestSingleInstanceLock 永不返回/锁文件互斥冲突）。
// 锁之前把 userData 归一到真身路径。
try { app.setPath('userData', realpathSync(app.getPath('userData'))) } catch { /* 非 junction 环境原样 */ }

/** daemon 探活（1.5s 超时，200=在）。 */
const probe = () => new Promise(resolve => {
  const req = http.get(`${BASE}/warroom/api/healthz`, { timeout: 1500 }, r => { resolve(r.statusCode === 200); r.resume() })
  req.on('error', () => resolve(false))
  req.on('timeout', () => { req.destroy(); resolve(false) })
})

const wait = ms => new Promise(r => setTimeout(r, ms))

// Windows toast 需要 AppUserModelID（否则通知走不出/落不了操作中心）。
app.setAppUserModelId('com.kaiji.stardeck')

let daemon = null          // 本壳拉起的 daemon 子进程（复用既有 daemon 时=null 不代管）
let win = null
let tray = null
let quitting = false
let attentionTimer = null     // D40 注意力轮询（退出时清）
let knownAttentionIds = null   // D40 已见定夺指纹集（null=首轮建基线不通知）

const showWindow = () => {
  if (win !== null && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    title: 'stardeck · 星舰甲板',
    icon: join(ASSETS_DIR, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0d0d0f', // D38 深色默认——载入瞬间不闪浅底（与星域画布同阶近黑）
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.setMenu(null)
  // ?cb=版本号：升级后强制拿新 client.js（no-store 拦不住内存缓存——家法）。
  void win.loadURL(`${BASE}/?cb=desktop-${app.getVersion()}`)
  win.on('close', e => {
    if (quitting) return
    e.preventDefault()
    win.hide() // 关窗=进托盘（应用语义）
  })
}

/** 杀本壳拉起的 daemon 进程树（win32 taskkill /T——执行者孙进程一并收割）。 */
const killDaemon = () => {
  if (daemon === null || daemon.pid === undefined) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(daemon.pid)], { windowsHide: true })
  else daemon.kill('SIGTERM')
  daemon = null
}

const quitAll = () => {
  quitting = true
  if (attentionTimer !== null) clearInterval(attentionTimer)
  killDaemon()
  app.quit()
}

async function main() {
  if (!existsSync(CLI)) {
    const { dialog } = await import('electron')
    await dialog.showMessageBox({ type: 'error', title: 'stardeck', message: `daemon 缺失（${CLI}）——安装包不完整，请重新下载安装器。` })
    app.quit()
    return
  }
  if (!(await probe())) {
    // ELECTRON_RUN_AS_NODE：用 Electron 自带 node 跑 daemon——用户机器零依赖。
    daemon = spawn(process.execPath, [CLI, 'start', '--no-open'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    })
    let up = false
    for (let i = 0; i < 60 && !up; i++) { up = await probe(); if (!up) await wait(500) }
    if (!up) {
      const { dialog } = await import('electron')
      await dialog.showMessageBox({ type: 'error', title: 'stardeck', message: `daemon 30s 未就绪（${BASE}）——检查端口占用后重试。` })
      killDaemon()
      app.quit()
      return
    }
  }
  await showWindow()
  // 托盘：关窗后甲板仍活着（聊天/外勤继续）；左键/菜单回甲板。
  const icon = nativeImage.createFromPath(join(ASSETS_DIR, 'icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('stardeck · 星舰甲板')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开甲板', click: () => { showWindow() } },
    { type: 'separator' },
    { label: '退出（含停服）', click: () => { quitAll() } },
  ]))
  tray.on('click', () => { showWindow() })

  // ── D40 注意力拉取：轮询舰桥 digest（「等你」面）→ 任务栏角标 + 托盘 tooltip
  // + 新到定夺的系统通知（窗口隐身才推——看得见就不打扰；首 poll 只建基线不
  // 轰炸）。角标=预渲染点阵 1-9（>9 用 9 号饼：数字是「有账」信号不是精确计数）。
  const KIND_LABEL = { clarify: '待答复', sign: '待签发', review: '待验收', retry: '待重试' }
  const pollAttention = async () => {
    try {
      const res = await fetch(BASE + '/warroom/api/bridge/digest', { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return
      const d = await res.json()
      const items = Array.isArray(d.pendingDecisions) ? d.pendingDecisions : []
      const ids = new Set(items.map(it => it.kind + ':' + it.refId))
      const n = items.length
      if (win !== null && !win.isDestroyed()) {
        let badge = null
        if (n > 0) {
          const img = nativeImage.createFromPath(join(ASSETS_DIR, 'badge-' + Math.min(n, 9) + '.png'))
          if (!img.isEmpty()) badge = img
        }
        try { win.setOverlayIcon(badge, n > 0 ? n + ' 张卡等你定夺' : '') } catch { /* 窗口已亡 */ }
      }
      if (tray !== null) tray.setToolTip(n > 0 ? 'stardeck · ' + n + ' 张卡等你定夺' : 'stardeck · 星舰甲板')
      if (knownAttentionIds !== null) {
        const fresh = items.filter(it => !knownAttentionIds.has(it.kind + ':' + it.refId))
        const hidden = win === null || win.isDestroyed() || !win.isVisible()
        if (fresh.length > 0 && hidden && Notification.isSupported()) {
          const byKind = {}
          for (const it of fresh) byKind[it.kind] = (byKind[it.kind] || 0) + 1
          const parts = Object.keys(byKind).map(k => byKind[k] + ' ' + (KIND_LABEL[k] || k))
          const note = new Notification({ title: 'stardeck 等你定夺', body: fresh.length + ' 张新卡：' + parts.join(' · ') })
          note.on('click', () => { showWindow() })
          note.show()
        }
      }
      knownAttentionIds = ids
    } catch { /* daemon 未就绪/网络抖动——下轮再问 */ }
  }
  attentionTimer = setInterval(() => { void pollAttention() }, 15000)
  attentionTimer.unref()
  void pollAttention()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { showWindow() })
  app.whenReady().then(main).catch(err => {
    console.error(err)
    app.quit()
  })
  app.on('before-quit', () => { quitting = true; killDaemon() })
  app.on('window-all-closed', () => { /* 关窗=进托盘——退出只走托盘菜单 */ })
}
