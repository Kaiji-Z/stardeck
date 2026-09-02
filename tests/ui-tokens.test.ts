/**
 * 独立形态令牌基座（P0-1 修复的机检锁）：styles.ts 的 L1 层引用宿主
 * --dsw-* 变量；dsh 宿主形态由宿主提供，独立形态由 public/index.html 的
 * :root 块提供。缺任何一枚=令牌荒漠（白字白底/透明弹窗/状态色全灭——
 * 2026-09-01 评审 17/40 的根因）。本测试双向锁死：styles.ts 引用到的每枚
 * --dsw-* 必须在 index.html 有定义，且基座非空。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const repoRoot = join(import.meta.dirname, '..')
const stylesSrc = readFileSync(join(repoRoot, 'src', 'client', 'styles.ts'), 'utf8')
const indexHtml = readFileSync(join(repoRoot, 'public', 'index.html'), 'utf8')

test('ui-tokens：styles.ts 引用到的每枚 --dsw-* 都在 index.html 有独立形态定义', () => {
  const referenced = new Set([...stylesSrc.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(m => m[1]!))
  assert.ok(referenced.size >= 20, `styles.ts 的 --dsw-* 引用面异常地小（${referenced.size}）——提取逻辑失效？`)
  const defined = new Set([...indexHtml.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map(m => m[1]!))
  const missing = [...referenced].filter(name => !defined.has(name))
  assert.deepEqual(missing, [], `index.html 缺独立形态令牌定义（令牌荒漠=白字白底/透明弹窗复发）：${missing.join(', ')}`)
})

test('ui-tokens：index.html 基座每枚 --dsw-* 都有非空取值（防空壳定义）', () => {
  const defs = [...indexHtml.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  assert.ok(defs.length >= 20, `index.html --dsw-* 定义数异常（${defs.length}）`)
  for (const [, name, value] of defs) {
    assert.ok(value!.trim().length > 0, `${name} 取值为空`)
  }
})
