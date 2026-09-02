/**
 * stardeck 验收门（三段式，继承 warroom verify 纪律）：
 *   ① tests 全量（node:test + tsx）
 *   ② build（esbuild 三产物）
 *   ③ needle 断言——正针脚（产品面在场）+ 负针脚（**零宿主引用**：独立形态
 *      的完整性铁证，import 层面不许出现任何 @deepseek-ai/cordis/dsh 字样）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const fail = msg => { console.error(`verify FAIL: ${msg}`); process.exit(1) }

// ① tests
const t = spawnSync('node', ['--import', 'tsx', '--test', ...readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => join('tests', f))], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (t.status !== 0) fail('tests 未全绿')

// ② build
const b = spawnSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (b.status !== 0) fail('build 失败')

// ③ needles
const read = rel => readFileSync(join(root, rel), 'utf8')
const needles = [
  ['src/daemon.ts', ['registerDashboard', 'warTools', 'ExecutorRegistry', 'patrolTick', '巡检回收', 'staffTick', 'dueScheduledDirectives', 'directive_received', 'staffRetryAfter', 'activeExecutor', '/warroom/api/fleet']],
  ['src/executor.ts', ['commanderOrderFor', 'opencode', 'mcp-bridge', 'war_claim', 'war_submit', 'injectOpencodeMcp', 'spawnHeadlessOpencode', 'codexAdapter', 'piAdapter', 'injectCodexMcp', 'injectPiExtension', 'codexExecArgs', 'piPrintArgs']],
  ['src/staff.ts', ['staffWorklist', 'staffOrderFor', 'staffPersonaText', 'relayPromptFor', 'war_publish', '没有 war_claim/war_submit']],
  ['src/fleet.ts', ['probeFleet', 'detectOpencodeBin', 'FleetSeatInfo', 'fleetSeatIds']],
  ['src/client/fleet-gate.tsx', ['选择舰队', '开始调度', 'seatStatusOf', 'war-root', '受限 · 实验性']],
  ['src/mcp-bridge.mjs', ['tools/list', 'tools/call', 'initialize', 'STARDECK_AGENT']],
  ['src/tool.ts', ['defineTool', 'invalid arguments', 'parameterSchemaSpecToJsonSchema']],
  ['src/config.ts', ['stardeckHome', 'loadConfig']],
  ['src/client-standalone.tsx', ['warView', 'ensureWarStyles', 'warroom-last-seen', 'fleetGate', '/warroom/api/fleet']],
  ['bin/stardeck.mjs', ['dist/cli.mjs']],
  ['public/index.html', ['stardeck-root', '/client.js', '--dsw-alias-state-business-primary', '--dsw-font-family']],
  ['dist/cli.mjs', ['stardeck']],
  ['dist/client.js', ['stardeck-root']],
]
for (const [file, keys] of needles) {
  if (!existsSync(join(root, file))) fail(`缺文件：${file}`)
  const text = read(file)
  for (const k of keys) if (!text.includes(k)) fail(`${file} 缺针脚：${k}`)
}

// ④ 旗面双跑矩阵（VERIFICATION.md §4/P1——opt-in：STARDECK_VERIFY_MATRIX=1）：
// 同一套回归在「默认旗面」与「全特性旗显式关」下都必须绿。当前套件对
// process.env 旗面不敏感（单测显式传旗），此段是闭环 SOP 的执法轨——新特性
// 若开始读环境旗面，这里立即产生信号。旗清单从 src/flags.ts 单一源取（经
// tsx 动态 import，不手抄清单防漂移）。
if (process.env.STARDECK_VERIFY_MATRIX === '1') {
  // 旗清单从 src/flags.ts 单一源提取（正则读数组字面量，不手抄防漂移）。
  const flagsSrc = read('src/flags.ts')
  const m = /DEFAULT_ON_FLAGS[^=]*=\s*\[([^\]]*)\]/.exec(flagsSrc)
  if (m === null) fail('旗面清单读取失败（src/flags.ts 的 DEFAULT_ON_FLAGS 数组解析不到——矩阵无法构造 off 面）')
  const offFlags = [...m[1].matchAll(/'([^']+)'/g)].map(x => `!${x[1]}`).join(',')
  if (offFlags === '') fail('旗面清单为空（矩阵无法构造 off 面）')
  const r = spawnSync('node', ['--import', 'tsx', '--test', ...readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => join('tests', f))],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, WARROOM_FEATURES: offFlags } })
  if (r.status !== 0) fail(`旗面双跑矩阵：全旗 OFF 面未全绿（off 面：${offFlags}）`)
  console.log(`旗面双跑矩阵 PASS（off 面：${offFlags}）`)
}

// 负针脚：零宿主引用（独立形态完整性铁证——import 层不许有 dsh 痕迹）。
const scanDirs = ['src', 'tests', 'bin', 'scripts', 'public']
const hostPattern = /from\s+['"]@deepseek-ai|require\(['"]@deepseek-ai|from\s+['"]cordis|require\(['"]cordis/
for (const dir of scanDirs) {
  const walk = d => {
    for (const f of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = join(d, f.name)
      if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); continue }
      if (!/\.(ts|tsx|mjs|js|json|html)$/.test(f.name)) continue
      if (hostPattern.test(read(p))) fail(`宿主引用残留：${p}（独立形态零容忍）`)
    }
  }
  walk(dir)
}

console.log('verify PASS（tests + build + needles 全绿；零宿主引用）')
