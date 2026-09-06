/**
 * V19 腿2 workspace/file 只读端点：war_root 双重限界（守卫纯函数 + 路由集成）。
 * 安全面是本端点的存在前提：`../` 穿越、绝对路径顶替、war_root 外工作区、
 * 跨任务工作区串门全部必须 403——正例只有一条（ws 在 war_root 内、name 在 ws 内）。
 * reveal 只测拒绝路径（放行会真开资源管理器——目检轮在浏览器里验）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { registerDashboard, workspaceFileGuardError, type RouteRegistry } from '../src/dashboard.ts'

function fakeStore() {
  return { get: () => ({ version: 2 as const, active: true }), save: () => {} }
}

function makeHandler(warRoot: string): (req: unknown, res: unknown) => Promise<void> {
  let handler: ((req: unknown, res: unknown) => void | Promise<void>) | undefined
  const registry: RouteRegistry = { register: route => { handler = route.handler; return () => {} } }
  registerDashboard(registry, { store: fakeStore() as never, stateDir: '', roster: () => ({ units: [], errors: [] }) as never, warRoot } as never)
  return (req, res) => Promise.resolve(handler!(req, res))
}

function getReq(url: string): { method: string; url: string } {
  return { method: 'GET', url }
}

function postReq(url: string, body: unknown): { method: string; url: string; on(event: string, cb: (chunk?: unknown) => void): void } {
  const text = JSON.stringify(body)
  return {
    method: 'POST',
    url,
    on(event, cb) {
      if (event === 'data') queueMicrotask(() => cb(text))
      if (event === 'end') queueMicrotask(() => cb())
    },
  }
}

async function call(handler: (req: unknown, res: unknown) => Promise<void>, req: unknown): Promise<{ body: any }> {
  let body = ''
  const res = { setHeader: () => {}, end: (b?: string) => { body = b ?? '' }, write: () => true, on: () => {} }
  await handler(req, res)
  return { body: body === '' ? {} : JSON.parse(body) }
}

test('workspaceFileGuardError：war_root 双重限界纯函数', () => {
  const root = 'C:/war'
  const ws = 'C:/war/tasks/t1'
  assert.equal(workspaceFileGuardError(root, ws, 'report.md'), null, '正例放行（含不存在路径——下游 404 面不受扰）')
  assert.match(workspaceFileGuardError(root, '', 'x.md') ?? '', /缺少/, '空参数拒绝')
  assert.match(workspaceFileGuardError(root, 'C:/other', 'x.md') ?? '', /war_root/, 'root 外工作区拒绝')
  assert.match(workspaceFileGuardError(root, ws, '../escape.md') ?? '', /穿越/, '../ 穿越拒绝')
  assert.match(workspaceFileGuardError(root, ws, 'C:/war/tasks/t2/y.md') ?? '', /穿越/, '绝对路径顶替拒绝')
  assert.match(workspaceFileGuardError(root, ws, 'sub/../../t2/y.md') ?? '', /穿越/, '绕行相对路径拒绝')
})

test('workspaceFileGuardError：符号链接绕行拒绝（V19.12 攻防回归）', () => {
  // Windows 符号链接需开发者模式/特权——无权则跳过（CI 之外的实弹机已验证过攻击面）。
  const root = mkdtempSync(join(tmpdir(), 'wslink-'))
  try {
    const ws = join(root, 'tasks', 't1')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'ok.md'), '# 界内', 'utf8')
    const secretDir = join(root, 'topsecret')
    mkdirSync(secretDir)
    writeFileSync(join(secretDir, 'TOPSECRET.md'), '机密', 'utf8')
    try {
      symlinkSync(join(secretDir, 'TOPSECRET.md'), join(ws, 'leak.md'), 'file')
      symlinkSync(secretDir, join(ws, 'leakdir'), 'dir')
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOENT') {
        return // 本机无 symlink 特权：环境不支撑，诚实跳过
      }
      throw e
    }
    // 界内链接指向界外文件：realpath 后落点出界 → 拒。
    assert.match(workspaceFileGuardError(root, ws, 'leak.md') ?? '', /穿越/, '文件符号链接出界拒绝')
    // 界内目录链接下再深的文件同理。
    assert.match(workspaceFileGuardError(root, ws, 'leakdir/TOPSECRET.md') ?? '', /穿越/, '目录符号链接出界拒绝')
    // 界内正常文件不受扰（realpath 后仍在界内）。
    assert.equal(workspaceFileGuardError(root, ws, 'ok.md'), null, '界内文件放行')
    assert.equal(workspaceFileGuardError(root, ws, '尚未生成的产物.md'), null, '不存在的界内名放行（404 面归端点）')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GET /warroom/api/workspace/file：正例 200 + 各越界面 403/404', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wsfile-'))
  try {
    const ws = join(root, 'tasks', 't1')
    mkdirSync(ws, { recursive: true })
    writeFileSync(join(ws, 'report.md'), '# 标题\n\n- 结论', 'utf8')
    const handler = makeHandler(root)
    const enc = (s: string): string => encodeURIComponent(s)
    const ok = await call(handler, getReq(`/warroom/api/workspace/file?ws=${enc(ws)}&name=${enc('report.md')}`))
    assert.equal(ok.body.ok, true, '正例放行')
    assert.equal(ok.body.binary, false)
    assert.ok(String(ok.body.content).includes('# 标题'), '内容读出')
    const trav = await call(handler, getReq(`/warroom/api/workspace/file?ws=${enc(ws)}&name=${enc('../escape.md')}`))
    assert.equal(trav.body.ok, false, '穿越拒绝')
    assert.match(String(trav.body.error), /穿越/)
    const outside = await call(handler, getReq(`/warroom/api/workspace/file?ws=${enc('C:/Windows')}&name=${enc('x.md')}`))
    assert.equal(outside.body.ok, false, 'root 外工作区拒绝')
    const missing = await call(handler, getReq(`/warroom/api/workspace/file?ws=${enc(ws)}&name=${enc('nope.md')}`))
    assert.equal(missing.body.ok, false, '缺文件 404 面')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('POST /warroom/api/workspace/reveal：越界拒绝面（放行不测——会真开资源管理器）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wsrev-'))
  try {
    const handler = makeHandler(root)
    const trav = await call(handler, postReq('/warroom/api/workspace/reveal', { ws: join(root, 't1'), name: '../x.md' }))
    assert.equal(trav.body.ok, false, '穿越拒绝')
    const outside = await call(handler, postReq('/warroom/api/workspace/reveal', { ws: 'C:/Windows', name: 'x.md' }))
    assert.equal(outside.body.ok, false, 'root 外拒绝')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
