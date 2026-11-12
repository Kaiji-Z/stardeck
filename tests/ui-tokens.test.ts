/**
 * 独立形态令牌基座机检锁。
 * 旧不变量（P0-1，2026-09-01）：styles.ts 的 L1 层引用宿主 --dsw-* 变量，
 *   独立形态由 public/index.html :root 块供给——缺任何一枚=令牌荒漠（评审
 *   17/40 的根因）。
 * D38 演进（2026-10-24）：令牌定义块全字面值自洽，「令牌荒漠」结构性消亡。
 * D38 收口（2026-11-12）：宿主铬层（.war-sidebar-*）与 index.html 的
 *   --dsw-* 令牌农场（浅色 alias/全量 static/暗色 alias）一并退役——
 *   不变量升到终态：① 定义块零 var(--dsw-*)；② **src 与 index.html 全线
 *   零 --dsw-*（直引与定义都不许回流）**；③ 基座非空。
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

test('ui-tokens：--dsw-* 全线退役——styles.ts 零直引、index.html 零定义（防回流锁）', () => {
  const referenced = [...stylesSrc.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(m => m[1]!)
  assert.deepEqual(referenced, [], `styles.ts 出现宿主别名直引（D38 收口后被禁）：${[...new Set(referenced)].join(', ')}`)
  const defined = [...indexHtml.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map(m => m[1]!)
  assert.deepEqual(defined, [], `index.html 出现 --dsw-* 定义（令牌农场已退役，别再回流）：${[...new Set(defined)].join(', ')}`)
  assert.ok(indexHtml.includes('#stardeck-boot'), '基座非空（boot 壳在场）')
})
