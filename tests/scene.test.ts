/**
 * D28 图景面：renderScene 确定性渲染器（scene.ts）——零 <script>、内联样式、
 * 组件形状、cards 对账（未知编号整页拒收）、畸形草稿拒收。纯函数单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderScene, parseSceneDraft, type SceneContext } from '../src/scene.ts'

const ctx = (ids: string[]): SceneContext => {
  const commands = new Map<string, { status: string }>()
  const tasks = new Map<string, { status: string }>()
  for (const id of ids) {
    if (id.startsWith('cmd-')) commands.set(id, { status: 'draft' })
    else tasks.set(id, { status: 'reported' })
  }
  return { commands, tasks }
}

const goodDraft = [
  '# 舰队晨报',
  '三条线并进，一条待你验收。',
  '```timeline',
  '- 09:00 命令 cmd-a 下达',
  '- 09:05 外勤应征任务 t-1',
  '- 09:40 任务 t-1 交证',
  '```',
  '```stats',
  '在跑任务: 2',
  '待验收: 1',
  '```',
  '```cards',
  'cmd-a | draft | 工具箱入口问题',
  't-1 | reported | hello 回响页已交证',
  '```',
].join('\n')

test('renderScene：黄金渲染——零 <script>、内联 <style>、三组件齐、转义到位', () => {
  const out = renderScene(goodDraft, ctx(['cmd-a', 't-1']))
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(out.title, '舰队晨报')
  assert.ok(!out.html.includes('<script'), '零 <script>（沙箱+CSP 双保险的第一保险）')
  assert.ok(out.html.includes('<style>'), '内联样式在场')
  assert.ok(out.html.includes('09:00') && out.html.includes('外勤应征任务 t-1'), '时间线行在场')
  assert.ok(out.html.includes('<dt>待验收</dt>'), 'stats 键在场')
  assert.ok(out.html.includes('cmd-a') && out.html.includes('t-1'), 'cards 编号在场')
  assert.ok(out.html.startsWith('<!doctype html>'), '单文件 HTML')
})

test('renderScene：XSS——草稿文本里的 <script>/<img> 全部转义成实体', () => {
  const evil = ['# 标题', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '```stats', '键: <b>值</b>', '```'].join('\n')
  const out = renderScene(evil, ctx([]))
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.ok(!out.html.includes('<script'), 'script 标签被转义')
  assert.ok(!out.html.includes('<img'), 'img 标签被转义')
  assert.ok(out.html.includes('&lt;script&gt;'), '实体化在场')
})

test('renderScene：cards 对账——未知编号整页拒收并列名（幻觉图景进不了聊天）', () => {
  const forged = ['# 编造图', '```cards', 'cmd-fake | draft | 我编的', '```'].join('\n')
  const out = renderScene(forged, ctx(['cmd-real']))
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.ok(out.reason.includes('cmd-fake'), '拒收理由点名未知编号')
})

test('renderScene：畸形草稿——缺标题/零组件拒收；粗体强调包裹容忍（glm-5.3 风格）', () => {
  assert.equal(parseSceneDraft('```stats\n键: 值\n```').ok, false, '缺标题拒收')
  assert.equal(parseSceneDraft('# 只有标题没有组件').ok, false, '零组件拒收')
  const bold = ['**# 粗体标题**', '**```timeline**', '- **09:00** 事件一', '**```**'].join('\n')
  const out = parseSceneDraft(bold)
  assert.equal(out.ok, true, '强调包裹容忍（stripEmphasis）')
  if (!out.ok) return
  assert.equal(out.scene.title, '粗体标题')
  assert.equal(out.scene.timeline.length, 1)
  assert.ok(out.scene.timeline[0]!.when.includes('09:00'))
})

test('renderScene：状态徽章色板——已知状态出彩色 chip，未知状态出中性色不崩', () => {
  const out = renderScene(['# t', '```cards', 't-1 | reported | x', 't-2 | weird-state | y', '```'].join('\n'), ctx(['t-1', 't-2']))
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.ok(out.html.includes('reported') && out.html.includes('weird-state'), '两状态都渲染')
})
