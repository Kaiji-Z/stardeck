#!/usr/bin/env node
/** stardeck bin——转发到构建产物 dist/cli.mjs（未构建=提示 pnpm build）。
 *  动态 import 必须 file:// URL：裸 Windows 盘符路径=ERR_UNSUPPORTED_ESM_URL_SCHEME
 *  （0.7.0 npm Windows 首装实弹抓的——POSIX 裸绝对路径恰好合法所以从未暴露）。 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const entry = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'cli.mjs')
if (!existsSync(entry)) {
  console.error('stardeck: 未找到构建产物 dist/cli.mjs——先在本仓库跑 pnpm build（npm 发布包已预构建）。')
  process.exit(1)
}
// 转发标记：cli 的 isMain 判 argv[1]==自身——经 bin 转发时 argv[1]=bin/stardeck.mjs
// 而 import.meta.url=dist/cli.mjs，结构性恒假（0.7.0 npm Windows 首装实弹抓的）。
process.env.STARDECK_BIN_ENTRY = '1'
await import(pathToFileURL(entry).href)
