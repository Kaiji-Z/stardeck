/**
 * V19 战报可读性·纯函数层（client/report-face.ts）：
 * - looksLikeFilePath 路径形判定（链化开关——误报会把普通词变按钮，宁紧勿松）；
 * - splitInline 行内切词（code/bold/路径互不嵌套）；
 * - parseMd markdown-lite 块解析（战报是模型自由文本，未知形态退段落）；
 * - pinFinalMessage 最终汇报置顶（腿3：末条含正文 assistant 钉正面，全量保留过程）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksLikeFilePath, parseMd, pinFinalMessage, splitInline } from '../src/client/report-face.ts'

test('looksLikeFilePath：路径形判定（紧口径——URL/句子/带空格不放行）', () => {
  assert.equal(looksLikeFilePath('report.md'), true)
  assert.equal(looksLikeFilePath('report-vibecodingKJ.md'), true)
  assert.equal(looksLikeFilePath('./a/b.txt'), true)
  assert.equal(looksLikeFilePath('check.js'), true)
  assert.equal(looksLikeFilePath('体检报告.md'), true)
  assert.equal(looksLikeFilePath('https://x.com/a.md'), false, 'URL 不算文件路径')
  assert.equal(looksLikeFilePath('这是一个句子'), false)
  assert.equal(looksLikeFilePath('a b.md'), false, '含空白不放行')
  assert.equal(looksLikeFilePath('.md'), false, '无主干不放行')
  assert.equal(looksLikeFilePath('node:fs'), false, '协议面不放行')
  // V19 铺面轮收紧：纯数字扩展=版本号不是路径（真实 CHANGELOG 计划里的 [1.0.0] 实抓）
  assert.equal(looksLikeFilePath('1.0.0'), false, '版本号不放行')
  assert.equal(looksLikeFilePath('3.5'), false, '短版本号不放行')
  assert.equal(looksLikeFilePath('v2.tar.gz'), true, '字母扩展的包名照放')
  assert.equal(looksLikeFilePath('data.json'), true, '字母扩展照放')
})

test('splitInline：code/bold/路径切词，互不嵌套', () => {
  assert.deepEqual(
    splitInline('产物 `report.md` 已落盘'),
    [{ t: 'text', v: '产物 ' }, { t: 'code', v: 'report.md' }, { t: 'text', v: ' 已落盘' }],
  )
  assert.deepEqual(
    splitInline('**结论** 完成'),
    [{ t: 'bold', v: '结论' }, { t: 'text', v: ' 完成' }],
  )
  const toks = splitInline('见 report-x.md 与 check.js 两份')
  assert.deepEqual(toks.filter(t => t.t === 'path').map(t => (t as { v: string }).v), ['report-x.md', 'check.js'], '裸路径 token 化')
  assert.deepEqual(
    splitInline('`a.md` 内的 **b.md** 不再二次解析'),
    [{ t: 'code', v: 'a.md' }, { t: 'text', v: ' 内的 ' }, { t: 'bold', v: 'b.md' }, { t: 'text', v: ' 不再二次解析' }],
  )
})

test('parseMd：标题/列表/代码块/引用/段落块解析', () => {
  const blocks = parseMd([
    '# 盘点报告',
    '',
    '结论：3 个目录。',
    '',
    '- 甲：30 项',
    '- 乙：16 项',
    '',
    '1. 建议一',
    '2. 建议二',
    '',
    '```bash',
    'ls -la',
    '```',
    '',
    '> 引用一行',
  ].join('\n'))
  assert.deepEqual(blocks[0], { kind: 'h', level: 1, text: '盘点报告' })
  assert.deepEqual(blocks[1], { kind: 'p', text: '结论：3 个目录。' })
  assert.deepEqual(blocks[2], { kind: 'ul', items: ['甲：30 项', '乙：16 项'] })
  assert.deepEqual(blocks[3], { kind: 'ol', items: ['建议一', '建议二'] })
  assert.deepEqual(blocks[4], { kind: 'code', lang: 'bash', text: 'ls -la' })
  assert.deepEqual(blocks[5], { kind: 'quote', text: '引用一行' })
  // 宽容面：未闭合代码块到文末、未知行退段落
  const loose = parseMd('```js\nx=1')
  assert.deepEqual(loose[0], { kind: 'code', lang: 'js', text: 'x=1' }, '未闭合围栏宽容收口')
  assert.deepEqual(parseMd('普通一行')[0], { kind: 'p', text: '普通一行' })
})

test('pinFinalMessage：末条含正文 assistant 钉正面，过程全量保留', () => {
  const msgs = [
    { role: 'user', ts: 1, parts: [{ kind: 'text', text: 'Mission' }] },
    { role: 'tool', ts: 2, parts: [{ kind: 'tool', text: 'ls', tool: 'bash' }] },
    { role: 'assistant', ts: 3, parts: [{ kind: 'text', text: '中间一句' }, { kind: 'tool', text: 'x', tool: 't' }] },
    { role: 'assistant', ts: 4, parts: [{ kind: 'reasoning', text: '想想' }, { kind: 'text', text: '最终答复' }] },
  ]
  const pinned = pinFinalMessage(msgs)
  assert.equal(pinned.final?.ts, 4, '钉末条（含 reasoning 也算，只要有正文）')
  assert.equal(pinned.rest.length, 3, '其余全量保留')
  assert.ok(pinned.rest.every(m => m.ts !== 4), 'final 不在 rest 里重复')
  // 空 assistant 正文 → 不硬造总结
  const none = pinFinalMessage([{ role: 'user', ts: 1, parts: [{ kind: 'text', text: 'x' }] }, { role: 'assistant', ts: 2, parts: [{ kind: 'text', text: '  ' }] }])
  assert.equal(none.final, null, '无正文 assistant 不钉')
  assert.equal(none.rest.length, 2)
})
