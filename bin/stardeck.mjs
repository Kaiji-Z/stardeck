#!/usr/bin/env node
/** stardeck bin——转发到构建产物 dist/cli.mjs（未构建=提示 pnpm build）。 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const entry = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'cli.mjs')
if (!existsSync(entry)) {
  console.error('stardeck: 未找到构建产物 dist/cli.mjs——先在本仓库跑 pnpm build（npm 发布包已预构建）。')
  process.exit(1)
}
await import(entry)
