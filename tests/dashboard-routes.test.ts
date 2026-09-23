/**
 * B1-件④ dashboard 新路由补测——V17 archive（不可逆写通道六态）、host-sessions、
 * host-workspaces（V18）、planets POST（V18）。archive 是全插件唯一不可逆宿主
 * 扇出，此前零专测。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appendDirectiveEvent, loadDirectives } from '../src/directives.ts'
import { appendEvent } from '../src/events.ts'
import { registerDashboard, type RouteRegistry } from '../src/dashboard.ts'

function tmpStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'warroom-routes-'))
}

function fakeStore(active = true) {
  return { get: () => ({ version: 2 as const, active }), save: () => {} }
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

function makeHandler(deps: Record<string, unknown> = {}): {
  handler: (req: unknown, res: unknown) => Promise<void>
  dispose: () => void
} {
  let handler: ((req: unknown, res: unknown) => void | Promise<void>) | undefined
  const registry: RouteRegistry = { register: route => { handler = route.handler; return () => {} } }
  const dispose = registerDashboard(registry, {
    store: fakeStore() as never,
    stateDir: '',
    roster: () => ({ units: [], errors: [] }) as never,
    warRoot: '/w',
    ...deps,
  } as never)
  return { handler: (req, res) => Promise.resolve(handler!(req, res)), dispose }
}

/** C1 配套（插件仓回流）：真实捕获 send() 写入的 statusCode——旧 helper 硬
 * 编码 code:200，把「全部错误码 200 出线」的 bug 藏在测试面之下。 */
async function call(handler: (req: unknown, res: unknown) => Promise<void>, req: unknown): Promise<{ code: number; body: any }> {
  let body = ''
  const res: { setHeader(): void; write(): boolean; end(b?: string): void; on(): void; statusCode: number } = {
    setHeader: () => {},
    write: () => true,
    end: (b?: string) => { body = b ?? '' },
    on: () => {},
    statusCode: 200,
  }
  await handler(req, res)
  return { code: res.statusCode, body: JSON.parse(body) }
}

/** seed：命令已批准挂任务 + 任务走到指定状态（claimed 才有 attempt 会话）。 */
function seedApprovedWithTask(dir: string, cmdId: string, taskId: string, taskStatus: 'published' | 'in_progress' | 'closed' | 'failed'): void {
  appendDirectiveEvent(dir, { type: 'directive_created', ts: 't0', directiveId: cmdId, text: 'x' })
  appendDirectiveEvent(dir, { type: 'directive_session_opened', ts: 't1', directiveId: cmdId, staffSessionId: `staff-${cmdId}` })
  appendDirectiveEvent(dir, { type: 'directive_received', ts: 't2', directiveId: cmdId, staffSessionId: `staff-${cmdId}` })
  appendEvent(dir, { type: 'task_created', ts: 't3', campaignId: taskId, title: 'x', brief: 'b', acceptance: 'a', priority: 'normal' })
  appendEvent(dir, { type: 'task_published', ts: 't4', campaignId: taskId, workspacePath: '/w/proj' })
  if (taskStatus === 'in_progress' || taskStatus === 'closed') {
    appendEvent(dir, { type: 'task_claimed', ts: 't5', campaignId: taskId, claimedBy: `cmdr-${taskId}`, attemptId: 'tok', attempt: 1 })
  }
  if (taskStatus === 'closed') {
    appendEvent(dir, { type: 'task_submitted', ts: 't6', campaignId: taskId, from: `cmdr-${taskId}`, report: 'r' })
    appendEvent(dir, { type: 'task_closed', ts: 't7', campaignId: taskId, verdict: '通过' })
  }
  if (taskStatus === 'failed') {
    appendEvent(dir, { type: 'task_failed', ts: 't6', campaignId: taskId, reason: 'x' })
  }
  appendDirectiveEvent(dir, { type: 'directive_approved', ts: 't8', directiveId: cmdId, taskId })
}

const okArchive = async () => ({ ok: true as const })

test('件④: archive 面缺席 → 501；缺 commandId → 400；未知命令 → 404', async () => {
  const dir = tmpStateDir()
  const bare = makeHandler({ stateDir: dir })
  try {
    // 面缺席优先（Stop-if 探针语义）：先于参数校验。
    const r0 = await call(bare.handler, postReq('/warroom/api/archive', { commandId: 'cmd-any' }))
    assert.equal(r0.body.ok, false)
    assert.match(r0.body.error, /宿主归档通道未接入/)
  } finally {
    bare.dispose()
  }
  const wired = makeHandler({ stateDir: dir, archiveSession: okArchive })
  try {
    const r1 = await call(wired.handler, postReq('/warroom/api/archive', {}))
    assert.equal(r1.body.ok, false)
    assert.match(r1.body.error, /缺少命令号/)
    const r2 = await call(wired.handler, postReq('/warroom/api/archive', { commandId: 'cmd-nope' }))
    assert.equal(r2.body.ok, false)
    assert.match(r2.body.error, /不存在/)
  } finally {
    wired.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: archive 链未终局 → 400 拒绝；已归档（全覆盖）→ 400', async () => {
  const dir = tmpStateDir()
  try {
    seedApprovedWithTask(dir, 'cmd-live', 'task-live', 'in_progress')
    seedApprovedWithTask(dir, 'cmd-done', 'task-done', 'closed')
    // C5 更新（插件仓回流）：旧种子 sessions:[] 断言的是「已归档即拒」旧闸
    //——新语义为「已入档会话覆盖全部相关会话才拒」，种子改为全覆盖
    //（staff+尝试会话）以保持 400 用例。
    appendDirectiveEvent(dir, { type: 'directive_archived', ts: 't9', directiveId: 'cmd-done', sessions: ['staff-cmd-done', 'cmdr-task-done'] })
    const { handler, dispose } = makeHandler({ stateDir: dir, archiveSession: okArchive })
    try {
      const live = await call(handler, postReq('/warroom/api/archive', { commandId: 'cmd-live' }))
      assert.equal(live.code, 400) // C1
      assert.equal(live.body.ok, false)
      assert.match(live.body.error, /战线未全终局/)
      const done = await call(handler, postReq('/warroom/api/archive', { commandId: 'cmd-done' }))
      assert.equal(done.code, 400) // C1
      assert.equal(done.body.ok, false)
      assert.match(done.body.error, /已归档/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('C5: archive 部分失败 → 第二次调用补齐缺失会话；全覆盖后第三次 400（幂等续档）', async () => {
  const dir = tmpStateDir()
  try {
    seedApprovedWithTask(dir, 'cmd-r', 'task-r', 'closed')
    const calls: string[] = []
    const mk = (failFor: (s: string) => boolean) => async (sessionId: string) => {
      calls.push(sessionId)
      return failFor(sessionId) ? { ok: false as const, code: 'E_TIMEOUT', message: '超时' } : { ok: true as const }
    }
    // 第一次：cmdr 尝试会话「超时」失败（超时≠宿主失败，可能账实分离）→ 落档只含 staff。
    const h1 = makeHandler({ stateDir: dir, archiveSession: mk(s => s.startsWith('cmdr')) })
    try {
      const r1 = await call(h1.handler, postReq('/warroom/api/archive', { commandId: 'cmd-r' }))
      assert.equal(r1.code, 200)
      assert.equal(r1.body.archived, 1)
      const after1 = loadDirectives(dir).find(d => d.id === 'cmd-r')!.archived!
      assert.deepEqual([...after1.sessions], ['staff-cmd-r'])
    } finally {
      h1.dispose()
    }
    // 第二次：重入不被「已归档」堵死——只补归档缺失的 cmdr 会话，账面合并既往+新成功。
    const h2 = makeHandler({ stateDir: dir, archiveSession: mk(() => false) })
    try {
      const callsBefore = calls.length
      const r2 = await call(h2.handler, postReq('/warroom/api/archive', { commandId: 'cmd-r' }))
      assert.equal(r2.code, 200)
      assert.equal(r2.body.archived, 1)
      assert.deepEqual(calls.slice(callsBefore), ['cmdr-task-r'], '只扇出缺失会话，不重打已入档会话')
      const after2 = loadDirectives(dir).find(d => d.id === 'cmd-r')!.archived!
      assert.deepEqual([...after2.sessions].sort(), ['cmdr-task-r', 'staff-cmd-r'].sort())
    } finally {
      h2.dispose()
    }
    // 第三次：全覆盖 → 400 已归档（幂等终点）。
    const h3 = makeHandler({ stateDir: dir, archiveSession: mk(() => false) })
    try {
      const r3 = await call(h3.handler, postReq('/warroom/api/archive', { commandId: 'cmd-r' }))
      assert.equal(r3.code, 400)
      assert.match(r3.body.error, /已归档/)
    } finally {
      h3.dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: archive 全终局 → 逐会话扇出成功落账（大副会话+尝试会话）', async () => {
  const dir = tmpStateDir()
  try {
    seedApprovedWithTask(dir, 'cmd-ok', 'task-ok', 'closed')
    const archived: string[] = []
    const { handler, dispose } = makeHandler({
      stateDir: dir,
      archiveSession: async sessionId => { archived.push(sessionId); return { ok: true } },
    })
    try {
      const r = await call(handler, postReq('/warroom/api/archive', { commandId: 'cmd-ok' }))
      assert.equal(r.body.ok, true)
      assert.equal(r.body.archived, 2)
      assert.deepEqual([...archived].sort(), [`staff-cmd-ok`, `cmdr-task-ok`].sort())
      const d = loadDirectives(dir).find(x => x.id === 'cmd-ok')!
      assert.deepEqual([...d.archived!.sessions].sort(), [`staff-cmd-ok`, `cmdr-task-ok`].sort())
    } finally {
      dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: archive 部分失败如实返回；全部失败 → 502', async () => {
  const dir = tmpStateDir()
  try {
    seedApprovedWithTask(dir, 'cmd-p', 'task-p', 'closed')
    const { handler, dispose } = makeHandler({
      stateDir: dir,
      archiveSession: async sessionId => sessionId.startsWith('staff')
        ? { ok: true }
        : { ok: false, code: 'E_TIMEOUT', message: '超时' },
    })
    try {
      const r = await call(handler, postReq('/warroom/api/archive', { commandId: 'cmd-p' }))
      assert.equal(r.body.ok, true)
      assert.equal(r.body.archived, 1)
      assert.equal(r.body.failed.length, 1)
      assert.equal(r.body.failed[0].code, 'E_TIMEOUT')
      // 全败分支：两个会话都失败。
      const all = makeHandler({
        stateDir: dir,
        archiveSession: async () => ({ ok: false, code: 'E_NOPE', message: 'x' }),
      })
      try {
        seedApprovedWithTask(dir, 'cmd-q', 'task-q', 'closed')
        const rq = await call(all.handler, postReq('/warroom/api/archive', { commandId: 'cmd-q' }))
        assert.equal(rq.body.ok, false)
        assert.match(rq.body.error, /全部失败/)
      } finally {
        all.dispose()
      }
    } finally {
      dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: host-sessions 面缺席 501 / 提供时透出清单', async () => {
  const dir = tmpStateDir()
  const bare = makeHandler({ stateDir: dir })
  try {
    const r1 = await call(bare.handler, { method: 'GET', url: '/warroom/api/host-sessions' })
    assert.equal(r1.body.ok, false)
    assert.match(r1.body.error, /未接入/)
  } finally {
    bare.dispose()
  }
  const wired = makeHandler({ stateDir: dir, listSessions: async () => ['s1', 's2'] })
  try {
    const r2 = await call(wired.handler, { method: 'GET', url: '/warroom/api/host-sessions' })
    assert.equal(r2.body.ok, true)
    assert.deepEqual(r2.body.sessions, ['s1', 's2'])
  } finally {
    wired.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: host-workspaces 面缺席 501 / 提供时映射 sessionCount', async () => {
  const dir = tmpStateDir()
  const bare = makeHandler({ stateDir: dir })
  try {
    const r1 = await call(bare.handler, { method: 'GET', url: '/warroom/api/host-workspaces' })
    assert.equal(r1.body.ok, false)
  } finally {
    bare.dispose()
  }
  const wired = makeHandler({
    stateDir: dir,
    listWorkspaces: async () => [
      { workspaceId: 'w1', path: 'D:/proj/a', title: 'A', sessionCount: 0 },
      { workspaceId: 'w2', path: 'D:/proj/b', title: 'B', sessionCount: 0 },
    ],
  })
  try {
    const r2 = await call(wired.handler, { method: 'GET', url: '/warroom/api/host-workspaces' })
    assert.equal(r2.body.ok, true)
    assert.equal(r2.body.workspaces.length, 2)
    assert.equal(r2.body.workspaces[0].workspaceId, 'w1')
  } finally {
    wired.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('件④: planets POST 空/假路径 400，真目录注册 200', async () => {
  const dir = tmpStateDir()
  const realDir = mkdtempSync(join(tmpdir(), 'warroom-planet-real-'))
  const { handler, dispose } = makeHandler({ stateDir: dir })
  try {
    const r1 = await call(handler, postReq('/warroom/api/planets', { path: '   ' }))
    assert.equal(r1.body.ok, false)
    assert.match(r1.body.error, /缺少工作区路径/)
    const r2 = await call(handler, postReq('/warroom/api/planets', { path: 'D:/definitely/not/a/dir' }))
    assert.equal(r2.body.ok, false)
    assert.match(r2.body.error, /不是真实目录/)
    const r3 = await call(handler, postReq('/warroom/api/planets', { path: realDir, title: '实验星' }))
    assert.equal(r3.body.ok, true)
    assert.equal(r3.body.planets.length, 1)
    assert.equal(r3.body.planets[0].title, '实验星')
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
    rmSync(realDir, { recursive: true, force: true })
  }
})

// ─── D24 两档制：签发走 /commands/plan 通道（approve 可携舰长修改后的五项）───

function seedAwaitingSign(dir: string, cmdId: string): void {
  appendDirectiveEvent(dir, { type: 'directive_created', ts: 't0', directiveId: cmdId, text: '清理实验脚本' })
  appendDirectiveEvent(dir, { type: 'directive_received', ts: 't1', directiveId: cmdId, staffSessionId: `staff-${cmdId}` })
  appendDirectiveEvent(dir, { type: 'directive_triaged', ts: 't2', directiveId: cmdId, grade: 'L1', reason: '不可逆' })
  appendDirectiveEvent(dir, { type: 'directive_brief_ready', ts: 't3', directiveId: cmdId, goal: '原目标', background: '原背景', acceptance: '原验收', nonGoals: '原非目标', deliverables: '原交付物' })
  appendDirectiveEvent(dir, { type: 'directive_plan_opened', ts: 't4', directiveId: cmdId, plan: '目标：原目标\n背景与约束：原背景' })
}

test('D24 签发：approve 携修改文本 → plan_approved + brief_signed 双入账（原稿保留）', async () => {
  const dir = tmpStateDir()
  seedAwaitingSign(dir, 'cmd-sign1')
  const h = makeHandler({ stateDir: dir, flags: { 'staff-plan': true } })
  const r = await call(h.handler, postReq('/warroom/api/commands/plan', {
    commandId: 'cmd-sign1', decision: 'approve',
    brief: { goal: '改后目标', background: '原背景', acceptance: '原验收', nonGoals: '舰长定稿非目标', deliverables: '原交付物' },
    note: '非目标按我的来',
  }))
  assert.equal(r.body.ok, true)
  const d = loadDirectives(dir).find(x => x.id === 'cmd-sign1')!
  assert.equal(d.plan?.status, 'approved')
  assert.equal(d.briefSigned?.nonGoals, '舰长定稿非目标', '签发文本=舰长定稿')
  assert.equal(d.brief?.nonGoals, '原非目标', '原稿保留')
  h.dispose()
})

test('D24 签发：approve 不携 brief → 照原稿签发；reject 必走 plan_rejected', async () => {
  const dir = tmpStateDir()
  seedAwaitingSign(dir, 'cmd-sign2')
  const h = makeHandler({ stateDir: dir, flags: { 'staff-plan': true } })
  const r1 = await call(h.handler, postReq('/warroom/api/commands/plan', { commandId: 'cmd-sign2', decision: 'approve' }))
  assert.equal(r1.body.ok, true)
  const d1 = loadDirectives(dir).find(x => x.id === 'cmd-sign2')!
  assert.equal(d1.briefSigned?.goal, '原目标', '未修改照原稿签发')
  h.dispose()

  const dir2 = tmpStateDir()
  seedAwaitingSign(dir2, 'cmd-sign3')
  const h2 = makeHandler({ stateDir: dir2, flags: { 'staff-plan': true } })
  const r2 = await call(h2.handler, postReq('/warroom/api/commands/plan', { commandId: 'cmd-sign3', decision: 'reject', note: '范围太大' }))
  assert.equal(r2.body.ok, true)
  const d2 = loadDirectives(dir2).find(x => x.id === 'cmd-sign3')!
  assert.equal(d2.plan?.status, 'rejected')
  assert.equal(d2.plan?.reason, '范围太大')
  assert.equal(d2.briefSigned, undefined, '驳回无签发')
  h2.dispose()
})

test('D24 签发：brief 字段不完整 → 400 不静默；无待批计划 → 400', async () => {
  const dir = tmpStateDir()
  seedAwaitingSign(dir, 'cmd-sign4')
  const h = makeHandler({ stateDir: dir, flags: { 'staff-plan': true } })
  const bad = await call(h.handler, postReq('/warroom/api/commands/plan', {
    commandId: 'cmd-sign4', decision: 'approve',
    brief: { goal: '只有一项' },
  }))
  assert.equal(bad.body.ok, false, '五项缺一即 400')
  const none = await call(h.handler, postReq('/warroom/api/commands/plan', { commandId: 'cmd-sign4', decision: 'reject', note: 'x' }))
  assert.equal(none.body.ok, true, '第一次调用未入账（400 拒收）——驳回仍可行')
  const after = await call(h.handler, postReq('/warroom/api/commands/plan', { commandId: 'cmd-sign4', decision: 'reject', note: 'x' }))
  assert.equal(after.body.ok, false, 'plan 已 rejected，再判=400')
  h.dispose()
})

test('D24 签发：旧 plan 来路（无 brief）+ 携修改文本 → brief_signed 照落（舰长定稿权绝对化）', async () => {
  const dir = tmpStateDir()
  appendDirectiveEvent(dir, { type: 'directive_created', ts: 't0', directiveId: 'cmd-sign5', text: '重构配置层' })
  appendDirectiveEvent(dir, { type: 'directive_received', ts: 't1', directiveId: 'cmd-sign5', staffSessionId: 'staff-x' })
  appendDirectiveEvent(dir, { type: 'directive_triaged', ts: 't2', directiveId: 'cmd-sign5', grade: 'L1', reason: '大改' })
  appendDirectiveEvent(dir, { type: 'directive_plan_opened', ts: 't3', directiveId: 'cmd-sign5', plan: '旧式计划稿' })
  const h = makeHandler({ stateDir: dir, flags: { 'staff-plan': true } })
  const r = await call(h.handler, postReq('/warroom/api/commands/plan', {
    commandId: 'cmd-sign5', decision: 'approve',
    brief: { goal: '舰长定稿目标', background: '定稿背景', acceptance: '定稿验收', nonGoals: '定稿非目标', deliverables: '定稿交付物' },
  }))
  assert.equal(r.body.ok, true)
  const d = loadDirectives(dir).find(x => x.id === 'cmd-sign5')!
  assert.equal(d.plan?.status, 'approved')
  assert.equal(d.briefSigned?.goal, '舰长定稿目标', '无原稿也落签发（定稿权不依赖来路）')
  assert.equal(d.brief, undefined, '原稿本来就缺，不伪造')
  h.dispose()
})
