/**
 * HQ 星球注册门回归（2026-09-02 独立形态手动注册轮）：
 * - folderPickerScript（纯）：Shell.BrowseForFolder + 0x41 旗（Vista 风格含「新建
 *   文件夹」按钮）+ UTF-8 输出防中文路径乱码 + title 单引号 PS 翻倍转义；
 * - PowerShell -STA 可启（win32 对话框宿主的基本前提，不弹窗只探进程）；
 * - 注册端点（真 daemon）：真实目录注册 ok + 账本去重 + 非目录 400 + 板投影带出。
 * 原生对话框本体（BrowseForFolder 交互）是用户终验项——自动化只覆盖脚本构造
 * 与进程可启性，不弹真窗。
 * @module stardeck/tests/hq-planets
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { folderPickerScript } from '../src/daemon.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('HQ 注册门：folderPickerScript——FolderBrowserDialog 置顶 + UTF-8 输出 + 引号转义', () => {
  const s = folderPickerScript('为 stardeck 星球选择工作区文件夹（可在此新建文件夹）')
  assert.ok(s.includes('FolderBrowserDialog'))
  assert.ok(s.includes('ShowNewFolderButton=$true')) // 「新建文件夹」按钮（任意位置）
  assert.ok(s.includes('TopMost=$true')) // 属主窗置顶——后台进程对话框不抢前台会落在 z 序底层（首弹实测）
  assert.ok(s.includes('ShowDialog($owner)'))
  assert.ok(s.includes('[Console]::OutputEncoding=[System.Text.Encoding]::UTF8')) // PS 5.1 ANSI 码页防乱中文路径
  assert.ok(s.includes("[Console]::Out.Write($f.SelectedPath)"))
  // title 单引号翻倍转义（PS 单引号串规则）
  const s2 = folderPickerScript("it's a 'quoted' title")
  assert.ok(s2.includes("'it''s a ''quoted'' title'"))
  // 取消 → DialogResult 非 OK → 不写输出（= 取消语义）
  assert.ok(s.includes("if($r -eq [System.Windows.Forms.DialogResult]::OK)"))
})

test('HQ 注册门：PowerShell -STA 可启（win32 对话框宿主前提）', { skip: process.platform !== 'win32' }, async () => {
  const exit = await new Promise<number>((resolve, reject) => {
    const p: ChildProcess = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', 'exit 0'], { stdio: 'ignore' })
    p.on('exit', c => resolve(c ?? -1))
    p.on('error', reject)
    setTimeout(() => { p.kill(); resolve(-1) }, 15_000)
  })
  assert.equal(exit, 0)
})

test('HQ 注册门：注册端点三态 + 板投影带出（真 daemon）', async t => {
  const port = 40850 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const stateDir = mkdtempSync(join(tmpdir(), 'stardeck-hq-'))
  const realDir = mkdtempSync(join(tmpdir(), 'stardeck-hq-ws-'))
  let daemon: ChildProcess | undefined
  t.after(() => {
    daemon?.kill()
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 3 })
    rmSync(realDir, { recursive: true, force: true, maxRetries: 3 })
  })
  daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
    cwd: repoRoot,
    env: { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0' },
    stdio: 'ignore',
  })
  let up = false
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise(r => setTimeout(r, 500))
    up = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
  }
  assert.ok(up, 'daemon 未就绪')
  const post = async (body: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}/warroom/api/planets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json() as any }
  }
  // ① 真实目录注册 ok + 标题落账
  const r1 = await post({ path: realDir, title: '测试星球' })
  assert.equal(r1.status, 200)
  assert.equal(r1.json.ok, true)
  assert.equal(r1.json.planets.length, 1)
  assert.equal(r1.json.planets[0].title, '测试星球')
  // ② 重复注册去重（path 幂等）
  const r2 = await post({ path: realDir })
  assert.equal(r2.json.planets.length, 1)
  // ③ 不存在路径 → 诚实拒绝（星球不得是「不存在文件夹的行星」）。注：dashboard
  // 的 send 刻意吞状态码统一 200（内核 1:1 设计，宿主网关以 ok 字段判）——断言走 body。
  const r3 = await post({ path: join(tmpdir(), 'stardeck-definitely-not-real-probe-folder') })
  assert.equal(r3.json.ok, false)
  assert.ok(String(r3.json.error).includes('不是真实目录'))
  // ④ 板投影带出（星域/起草器数据源）
  const board = await (await fetch(`${base}/warroom/api/board`)).json() as any
  assert.ok(Array.isArray(board.planets) && board.planets.some((p: { path: string }) => p.path === realDir))
})
