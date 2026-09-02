/**
 * stardeck 构建（esbuild，无框架）：
 *   dist/cli.mjs + dist/daemon.mjs —— node 侧全量 bundle（运行零依赖）
 *   dist/client.js                —— 板 UI 整页 bundle（react+three 打进去，IIFE）
 *   dist/mcp-bridge.mjs           —— MCP 桥原样拷贝（node 直跑）
 *   dist/public/index.html        —— 静态壳
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
mkdirSync(join(dist, 'public'), { recursive: true })

await build({
  entryPoints: [join(root, 'src/cli.ts')],
  outfile: join(dist, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'warning',
})
await build({
  entryPoints: [join(root, 'src/client-standalone.tsx')],
  outfile: join(dist, 'client.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx' },
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: false,
  logLevel: 'warning',
})
copyFileSync(join(root, 'src/mcp-bridge.mjs'), join(dist, 'mcp-bridge.mjs'))
copyFileSync(join(root, 'public/index.html'), join(dist, 'public/index.html'))
console.log('build ok: dist/cli.mjs + dist/client.js + dist/mcp-bridge.mjs + dist/public/index.html')
