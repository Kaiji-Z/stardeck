/**
 * 打包前置：把主仓构建产物拷进 desktop/resources/stardeck/（electron-builder
 * extraResources 源）。dist 四件（cli/client/mcp-bridge/public）+ package.json
 * （daemon 的 packageVersion 读它）。幂等：先删后拷。
 * @module stardeck-desktop/pack-daemon
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopRoot, '..')
const srcDist = join(repoRoot, 'dist')
const out = join(desktopRoot, 'resources', 'stardeck')

if (!existsSync(join(srcDist, 'cli.mjs'))) {
  console.error('主仓未构建——先在仓库根跑 pnpm build 再打包桌面壳。')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(srcDist, join(out, 'dist'), { recursive: true })
// 静态资源双布局：daemon 的候选是 dist 的**同级** public/（npm 包同构——
// files: dist + public 顶层）。只拷 dist 会让 GET / 落进 API fallback
// （"no route: GET /"——安装版实弹实抓）。
cpSync(join(repoRoot, 'public'), join(out, 'public'), { recursive: true })
cpSync(join(repoRoot, 'package.json'), join(out, 'package.json'))
console.log(`daemon 已收进 ${out}（dist + public + package.json）`)
