/**
 * stardeck playground · 试玩沙盘（2026-09-02 定案）
 *
 * 隔离环境：专用端口 3974 + 专用账本 ~/.stardeck-playground（与真实
 * ~/.stardeck 互不干扰；--fresh 重置）。首次启动播种全生命周期演示数据：
 *   - draft×3（!!直接做 / ??先看方案 / 普通）→ 大副 15s 哨位自动接单（活演示）
 *   - 定时令（每 2 分钟）→ staffTick 到点自动派发
 *   - 执行中任务（claimed 未交）→ 执行中列卡 + 星域绕行星体
 *   - 任务回报（真产出真跑 KillCredit 全绿）→ 等你翻阅收官
 *   - 已收官任务 → 归档页签
 *   - 注册星球×2（真实目录）→ 星域 idle 星 + 起草器可选
 * 默认绑定 zcode 舰队（试「进入会话」跳终端最佳路径）；入口门可随时换。
 *
 * 用法：node scripts/playground.mjs [--fresh]
 * 板址：http://127.0.0.1:3974/
 */
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 3974
const base = `http://127.0.0.1:${PORT}`
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const stateDir = join(homedir(), '.stardeck-playground')
const warRoot = join(stateDir, 'tasks')
const marker = join(stateDir, 'playground-seeded.marker')
const fresh = process.argv.includes('--fresh')

if (fresh && existsSync(stateDir)) {
  rmSync(stateDir, { recursive: true, force: true, maxRetries: 5 })
  console.log(`[playground] --fresh：已重置 ${stateDir}`)
}
mkdirSync(stateDir, { recursive: true })

// ---------- 起 daemon（zcode 舰队默认 + 大副在岗） ----------
console.log(`[playground] 起 daemon → ${base}（账本 ${stateDir} · 舰队 zcode · 大副在岗）`)
const daemon = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    STARDECK_PORT: String(PORT),
    STARDECK_STATE_DIR: stateDir,
    STARDECK_WAR_ROOT: warRoot,
    STARDECK_STAFF: '1',
    STARDECK_EXECUTOR: 'zcode',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
daemon.stdout.on('data', d => process.stdout.write(`[daemon] ${d}`))
daemon.stderr.on('data', d => process.stderr.write(`[daemon!] ${d}`))
const die = () => { daemon.kill(); process.exit(0) }
process.on('SIGINT', die)
process.on('SIGTERM', die)

// ---------- 等健康 ----------
const api = async (p, init) => {
  const r = await fetch(base + p, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  return r.json()
}
const call = async (name, args, agentId) => {
  const o = await api('/warroom/api/tools/call', { method: 'POST', body: JSON.stringify({ name, arguments: args, agentId }) })
  if (o.ok !== true) throw new Error(`${name}: ${o.error}`)
  return o.result
}
for (let i = 0; i < 60; i++) {
  const ok = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
  if (ok) break
  if (i === 59) throw new Error('daemon 30s 未活')
  await new Promise(r => setTimeout(r, 500))
}
console.log('[playground] daemon 就绪')

// ---------- 播种（幂等：marker 在即跳过） ----------
if (existsSync(marker)) {
  console.log('[playground] 已播种过（--fresh 重置后可重播）——跳过')
} else {
  console.log('[playground] 播种全生命周期演示数据…')

  // ① 注册星球×2（真实目录，起草器即可选）
  const planetsRoot = join(stateDir, 'demo-planets')
  for (const name of ['试验场-甲', '试验场-乙']) {
    const dir = join(planetsRoot, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), `# ${name}\n\nplayground 演示星球——真实目录，可在此立项执行任务。\n`, 'utf8')
    await api('/warroom/api/planets', { method: 'POST', body: JSON.stringify({ path: dir, title: name }) })
  }

  // ② 三道 draft（交给活大副：!!直接做→L0 直发；??先看方案→计划呈批；普通→分诊）
  await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '!!直接做：在工作区根创建 hello.txt（内容包含 playground-live），写 check.js 校验后真实运行，按出口协议交证。' }) })
  await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '??先看方案：给这个工作区设计一个极简的 CHANGELOG 维护方案，先呈方案等我批。' }) })
  await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '盘点当前目录结构，给出一份一页纸的项目体检报告。' }) })
  // ③ 定时令（每 2 分钟到点，staffTick 自动派发→大副→zcode 外勤）
  await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '!!直接做：在工作区根创建 heartbeat.txt（内容为当前时刻一行），写 check.js 校验后按出口协议交证。', cron: '*/2 * * * *' }) })

  // ④ 执行中任务（claim 不交——执行中列卡 + 星域绕行星）
  const cBusy = await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '铺设观测站（演示：执行中挂起）' }) })
  const pubBusy = await call('war_publish', {
    title: '观测站地基（演示卡）',
    brief: '背景：playground 演示「执行中」挂起态。执行指引：无需真做——本任务为演示播种，长期处于执行中。边界：不动任何文件。',
    acceptance: '1. 演示卡保持执行中态（无需真做）；\n2. 板面执行中列可见本卡；\n3. 星域可见绕行星体。',
    commandId: cBusy.commandId,
  }, 'playground-seeder')
  await call('war_claim', { task_id: pubBusy.taskId }, 'pg-field-1')

  // ⑤ 任务回报（真产出真跑，KillCredit 机械全绿）→ 等翻阅收官
  const cDone = await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: '建造每日格言终端（演示：待翻阅）' }) })
  const pubDone = await call('war_publish', {
    title: '格言 CLI 最小版（playground）',
    brief: '背景：演示待翻阅态。执行指引：工作区根创建 motto.js——无参数输出今日格言，list 子命令列出全部（≥30 条），node 原生零依赖。边界：只在本工作区内动土。',
    acceptance: '1. node motto.js today 退出码 0 且输出一行；\n2. node motto.js list 列出 ≥30 条；\n3. 证据 files 列出产出路径。',
    commandId: cDone.commandId,
    quality: 'fine',
  }, 'playground-seeder')
  const ws = pubDone.workspacePath
  const lines = Array.from({ length: 32 }, (_, i) => `  "格言 ${i + 1}：星星在夜里也不停航 ${i + 1}"`).join(',\n')
  writeFileSync(join(ws, 'motto.js'), `const M = [\n${lines}\n]\nconst k = process.argv[2]\nif (k === 'list') { M.forEach((m, i) => console.log(i + 1 + '. ' + m)) } else { console.log(M[new Date().getDate() % M.length]) }\n`, 'utf8')
  execSync('node motto.js today', { cwd: ws })
  execSync('node motto.js list', { cwd: ws })
  const claim = await call('war_claim', { task_id: pubDone.taskId }, 'pg-field-2')
  await call('war_submit', {
    task_id: pubDone.taskId,
    attempt_id: claim.attemptId,
    report: '格言 CLI 完成：today/list 双子命令，32 条内置格言，零依赖。均实跑通过。',
    evidence: JSON.stringify({
      checks: [
        { item: 'node motto.js today 退出码 0 且输出一行格言', passed: true },
        { item: 'node motto.js list 列出 ≥30 条', passed: true },
        { item: 'war_submit 证据 files 列出产出文件相对路径', passed: true },
      ],
      tests: { command: 'node motto.js today', exit_code: 0, passed: 1, failed: 0 },
      files: ['motto.js'],
    }),
  }, 'pg-field-2')

  // ⑥ 已收官（归档页签） + 星球标记行 ⑤ 命令挂到试验场-甲（【星球：】标记演示）
  const cOld = await api('/warroom/api/commands', { method: 'POST', body: JSON.stringify({ text: `点亮首颗星（演示：已收官）\n【星球：${join(planetsRoot, '试验场-甲')}】` }) })
  const pubOld = await call('war_publish', {
    title: '首星信标（已收官演示）',
    brief: '背景：演示归档态。执行指引：创建 beacon.txt 内容 ok。边界：只在本工作区。',
    acceptance: '1. 工作区根存在 beacon.txt；\n2. 内容包含 ok；\n3. 证据 files 列出 beacon.txt。',
    commandId: cOld.commandId,
  }, 'playground-seeder')
  writeFileSync(join(pubOld.workspacePath, 'beacon.txt'), 'ok\n', 'utf8')
  const claimOld = await call('war_claim', { task_id: pubOld.taskId }, 'pg-field-3')
  await call('war_submit', {
    task_id: pubOld.taskId,
    attempt_id: claimOld.attemptId,
    report: '信标点亮。',
    evidence: JSON.stringify({ checks: [{ item: 'beacon.txt 存在且内容含 ok', passed: true }], tests: { command: 'node -e "require(\'fs\')"', exit_code: 0, passed: 1, failed: 0 }, files: ['beacon.txt'] }),
  }, 'pg-field-3')
  await call('war_close_task', { task_id: pubOld.taskId, verdict: '通过收官——playground 演示' }, 'playground-seeder')

  writeFileSync(marker, new Date().toISOString(), 'utf8')
  console.log('[playground] 播种完成：draft×3 + 定时令 + 执行中×1 + 待翻阅×1 + 已收官×1 + 星球×2')
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  stardeck playground · 试玩沙盘已就位                     ║
╠══════════════════════════════════════════════════════════╣
║  板址：${base}/
║  账本：${stateDir}（独立于真实数据）
║  舰队：zcode（门里可换 opencode/pi）；大副在岗
║  退出：Ctrl+C
╚══════════════════════════════════════════════════════════╝

试玩清单（照单全收约 15 分钟）：
 1. 舰队绑定门：四席卡、zcode 默认选中、codex 受限标记——「开始调度」
 2. 看板上预置卡：任务列「待翻阅」/ 执行中列「挂起演示」/ 调度坞四道命令
 3. 决策带：点「待翻阅」卡 → 任务回报段看 KillCredit 全绿证据 → 收官
 4. 大副活演示：等 15-60 秒，三道 draft 被大副自动接单（!!→L0 直发真跑
    zcode 外勤；??→计划呈批等你批；普通→先分诊）——板会实时动起来
 5. 计划呈批：??那道命令出计划后，聚焦页「等你定夺」→ 批准 → 大副发布
 6. 进入会话（重点）：绑 zcode → 等 !!直接做 那道任务跑完（状态变待翻阅）
    → 聚焦页底部「⌁ 进入会话」→ 新终端 zcode --resume 直达执行现场
    （注意：zcode 席要任务收尾后才有映射；播种的旧任务没有映射=诚实 409）
 7. 定时令：每 2 分钟一道 heartbeat 自动派发（调度坞会看到新卡）
 8. HQ 注册星球：m 切星域 → 点中心 HQ 发射台 → 「浏览…」弹资源管理器
    （对话框里可任意位置「新建文件夹」）→ 注册 → 起草器星球行可选
 9. 星域玩法：V 切 3D/2D、悬停星球、拖拽、滚轮缩放；试验场-甲有已收官星
10. 暗色模式：⚙ 设置 → 外观 → 深色界面；顺手换皮肤（军事/星际/平话）
11. 快捷键：n 下达命令 / m 列表⇄星域；页签 ▶进行中 ✓已收官 ▦归档看 c 老命令
12. 续接：点开已收官命令 → 报告段「下续战令」→ 起草器自动带续接上下文
`)
console.log('[playground] 前台保持运行中——浏览器打开', `${base}/`, '开始试玩')
