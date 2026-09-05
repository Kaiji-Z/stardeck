import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import {
  dshModelId, dshPatchYml, dshHeadlessArgs, dshProjectKey, dshLatestSessionId,
  JUMP_TEMPLATES, ADAPTERS,
} from '../src/executor.ts'
import { dshHistoryFromLines, dshDecodeZstdFrames } from '../src/history.ts'

// 第七舰队 dsh（2026-09-05）：纯函数面——argv/模型外挂层/目录编码/事件映射。

test('dshModelId：provider/id 形取 id 段；空归 glm-5.2', () => {
  assert.equal(dshModelId('zai-coding-plan/glm-5.2'), 'glm-5.2')
  assert.equal(dshModelId('glm-5.2'), 'glm-5.2')
  assert.equal(dshModelId(''), 'glm-5.2')
})

test('dshPatchYml：外挂层=模型路由+目录条目（maxTokens 必须显式——缺了 z.ai 拒 max_tokens，实弹坑）', () => {
  const yml = dshPatchYml('zai/glm-5.2')
  assert.ok(yml.includes('id: agent-default-model'))
  assert.ok(yml.includes('model: glm-5.2'))
  assert.ok(yml.includes('id: llm-deepseek'))
  assert.ok(yml.includes('maxTokens: 8192'), 'catalog 条目必须带显式 maxTokens')
})

test('dshHeadlessArgs：node+绝对 tsx loader（file:// URL）+bin.ts+headless+patch+任务正文', () => {
  const argv = dshHeadlessArgs({ cloneRoot: 'C:/clone', binTs: 'C:/clone/apps/cli/src/bin.ts', patchPath: 'C:/ws/.stardeck/dsh-model.yml', prompt: 'PROMPT' })
  assert.equal(argv[0], '--import')
  assert.ok(argv[1]!.startsWith('file://'), 'win32 绝对路径须 file:// URL（裸 C:\\ 会被当 c: 协议）')
  assert.ok(argv[1]!.endsWith(join('node_modules', 'tsx', 'dist', 'esm', 'index.mjs').replace(/\\/g, '/')))
  assert.deepEqual(argv.slice(2, 8), ['C:/clone/apps/cli/src/bin.ts', '--profile', 'headless', '--patch', 'C:/ws/.stardeck/dsh-model.yml', 'PROMPT'])
})

test('dshProjectKey：dsh format.ts projectKey 字节级复刻（实测目录对齐）', () => {
  assert.equal(dshProjectKey('C:\\Users\\kaiji\\vibecodingKJ\\projects\\stardeck\\.goal\\tmp-dsh-smoke'), '--C-Users-kaiji-vibecodingKJ-projects-stardeck-.goal-tmp-dsh-smoke--')
  assert.equal(dshProjectKey('D:\\Users\\kaiji\\projects\\dsh-plugin-stardeck\\.smoke-state\\ws-t4'), '--D-Users-kaiji-projects-dsh-plugin-stardeck-.smoke-state-ws-t4--')
  assert.equal(dshProjectKey('/home/u/proj'), '--home-u-proj--') // POSIX 分隔符同折叠
  assert.equal(dshProjectKey('C:\\工作区'), '--C-~5DE5~4F5C~533A--') // 非 ASCII → ~XXXX 转义
})

test('dshLatestSessionId：projectKey 目录下 mtime≥起跑的最新 session（缺席诚实 null）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-dsh-'))
  try {
    const ws = join(dir, 'ws')
    mkdirSync(ws)
    const root = join(dir, 'sessions')
    const proj = join(root, dshProjectKey(ws))
    mkdirSync(proj, { recursive: true })
    assert.equal(dshLatestSessionId(ws, Date.now(), root), null) // 空
    mkdirSync(join(proj, 'session-old'))
    assert.equal(dshLatestSessionId(ws, Date.now() + 10_000, root), null) // 起跑锚在未来：全在起跑前（避开同毫舍入）
    mkdirSync(join(proj, 'session-new'))
    assert.equal(dshLatestSessionId(ws, Date.now() - 60_000, root), 'session-new')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dsh 历史读取：user/assistant 消息映射（嵌套 message 载荷+noise 跳过）', () => {
  const lines = [
    JSON.stringify({ type: 'session', id: 'session-x', cwd: 'C:/ws' }),
    JSON.stringify({ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }),
    JSON.stringify({ type: 'user/message', seq: 7, time: 1788602131386, data: { content: [{ type: 'text', text: '干活' }], role: 'user' } }),
    JSON.stringify({ type: 'assistant/message', seq: 133, time: 1788602138212, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: '干完了' }] } } }),
    'not json',
  ]
  const msgs = dshHistoryFromLines(lines)
  assert.equal(msgs.length, 2)
  assert.deepEqual(msgs[0], { role: 'user', ts: 1788602131386, parts: [{ kind: 'text', text: '干活' }] })
  assert.deepEqual(msgs[1]!.parts.map(p => p.kind), ['reasoning', 'text'])
  assert.equal(msgs[1]!.parts[1]!.text, '干完了')
})

test('dsh 历史读取：多帧 zstd 解码（帧魔数步进拼接）', () => {
  const frame = (s: string): Buffer => zlib.zstdCompressSync(Buffer.from(s, 'utf8'))
  const buf = Buffer.concat([frame('{"type":"user/message","time":1,"data":{"content":[{"type":"text","text":"a"}]}}\n'), frame('{"type":"user/message","time":2,"data":{"content":[{"type":"text","text":"b"}]}}\n')])
  const text = dshDecodeZstdFrames(buf)
  assert.equal(dshHistoryFromLines(text.split('\n')).length, 2)
  assert.equal(dshDecodeZstdFrames(Buffer.alloc(0)), '')
})

test('dsh 跳转模板与适配器注册：JUMP_TEMPLATES 锁死 + ADAPTERS 在册', () => {
  assert.equal(JUMP_TEMPLATES.dsh, 'dsh --profile tui --resume <会话号>')
  assert.equal(ADAPTERS.dsh!.id, 'dsh')
})
