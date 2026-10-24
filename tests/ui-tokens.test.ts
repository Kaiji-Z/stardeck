/**
 * 独立形态令牌基座机检锁。
 * 旧不变量（P0-1，2026-09-01）：styles.ts 的 L1 层引用宿主 --dsw-* 变量，
 *   独立形态由 public/index.html :root 块供给——缺任何一枚=令牌荒漠（评审
 *   17/40 的根因）；「引用面 ≥20」地板防提取逻辑失效。
 * D38 演进（2026-10-24）：新设计语言令牌定义块（.war-root / 深色覆盖）全
 *   字面值自洽——宿主别名不再是依赖面，「令牌荒漠」在结构上不可能复发，
 *   「引用面 ≥20」地板随之退役。新不变量更硬：
 *   ① 定义块零 var(--dsw-*)（自洽化锁定）；② 残余 --dsw-* 引用（宿主铬层
 *   .war-sidebar-*）仍必须在 index.html 有定义；③ 基座非空。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const repoRoot = join(import.meta.dirname, '..')
const stylesSrc = readFileSync(join(repoRoot, 'src', 'client', 'styles.ts'), 'utf8')
const indexHtml = readFileSync(join(repoRoot, 'public', 'index.html'), 'utf8')

test('ui-tokens：L1 令牌定义块自洽——D38 起定义块零 --dsw-* 依赖（字面值换肤）', () => {
  const lightStart = stylesSrc.indexOf('.war-root{')
  const lightEnd = stylesSrc.indexOf('.war-root ::selection')
  assert.ok(lightStart >= 0 && lightEnd > lightStart, '浅色令牌块结构异常')
  const lightBlock = stylesSrc.slice(lightStart, lightEnd)
  const darkStart = stylesSrc.indexOf('body[data-ds-dark-theme] .war-root{')
  assert.ok(darkStart >= 0, '深色令牌块缺席')
  const darkBlock = stylesSrc.slice(darkStart, darkStart + stylesSrc.slice(darkStart).indexOf('\n}'))
  for (const [name, block] of [['浅色', lightBlock], ['深色', darkBlock]] as const) {
    assert.ok(!block.includes('var(--dsw-'), `${name}令牌定义块出现宿主别名直引——D38 自洽化被破坏`)
    assert.ok(block.length > 1500, `${name}令牌定义块异常地小（${block.length} 字符）——令牌荒漠复发？`)
  }
})

test('ui-tokens：styles.ts 残余 --dsw-* 引用（宿主铬层）都在 index.html 有定义', () => {
  const referenced = new Set([...stylesSrc.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(m => m[1]!))
  const defined = new Set([...indexHtml.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map(m => m[1]!))
  const missing = [...referenced].filter(name => !defined.has(name))
  assert.deepEqual(missing, [], `index.html 缺独立形态令牌定义：${missing.join(', ')}`)
})

test('ui-tokens：index.html 基座每枚 --dsw-* 都有非空取值（防空壳定义）', () => {
  const defs = [...indexHtml.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
  assert.ok(defs.length >= 20, `index.html --dsw-* 定义数异常（${defs.length}）`)
  for (const [, name, value] of defs) {
    assert.ok(value!.trim().length > 0, `${name} 取值为空`)
  }
})
