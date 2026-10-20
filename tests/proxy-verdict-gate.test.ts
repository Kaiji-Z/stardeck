/**
 * D27 定夺通路与授权门（test-first）：B3 身份门的三条新通路。
 *  1. 复现（修前=红）：板面舰长亲手验收走固定 principal 'captain-board'——
 *     B3 落地（2026-09-23）起独立形态 hqSessionId 从不设置，staff-owned
 *     任务的板面验收实为被拒（潜伏缺陷，D27 盘点发现）；
 *  2. 代理舰长代定夺=flag-gated：无 gate（授权 OFF 面）一律拒；gate 放行
 *     才过（OFF 面行为与 0.3.x 字节等价——随机 agent 永拒）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { warTools } from '../src/tools.ts'
import { appendEvent, loadCampaign } from '../src/events.ts'
import { appendDirectiveEvent } from "../src/directives.ts"
import { readFeatureFlags, type FeatureFlags } from '../src/flags.ts'
import type { Roster } from '../src/roster.ts'
import type { SubagentsServiceFace } from '../src/subagents.ts'

const FLAG_OFF: FeatureFlags = readFeatureFlags({})

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'stardeck-proxy-gate-'))
}

function makeDeps(dir: string, over: { verdictProxyGate?: (id: string) => boolean } = {}): Parameters<typeof warTools>[0] {
  const roster: Roster = { units: [], errors: [] }
  return {
    store: { get: () => ({ version: 2 as const, active: true, hqSessionId: undefined }), save: () => {} },
    stateDir: dir,
    maxUnits: 4,
    maxAttempts: 3,
    roster: () => roster,
    subagents: {
      async startContinuable() { return { childId: 'child-x', messageId: 'm1' } },
      async followup() { return {} },
      interrupt() {},
      async listDescendants() { return [] },
    } satisfies SubagentsServiceFace,
    commander: { conscript: async () => ({ spawned: false }) },
    workspace: {
      materialize: (warRoot: string, id: string) => ({ path: join(warRoot, id), kind: 'dir' as const }),
      materializeInstance: (warRoot: string, id: string) => ({ path: join(warRoot, id), kind: 'dir' as const }),
    },
    warRoot: join(dir, 'war'),
    flags: FLAG_OFF,
    ...(over.verdictProxyGate !== undefined ? { verdictProxyGate: over.verdictProxyGate } : {}),
  } as Parameters<typeof warTools>[0]
}

async function execTool(deps: Parameters<typeof warTools>[0], name: string, args: Record<string, unknown>, callerId: string): Promise<Record<string, unknown>> {
  const tool = warTools(deps).find(t => t.name === name)
  assert.ok(tool !== undefined, `tool ${name} missing`)
  return tool.execute(args, { agent: { id: callerId }, signal: new AbortController().signal }) as Promise<Record<string, unknown>>
}

/** staff-owned reported 任务（B3 主战场形态：所属命令绑定大副会话）。 */
function seedOwnedReported(dir: string, taskId: string): void {
  const commandId = `cmd-${taskId}`
  appendDirectiveEvent(dir, { type: 'directive_created', ts: 't0', directiveId: commandId, text: '做考题' })
  appendDirectiveEvent(dir, { type: 'directive_received', ts: 't1', directiveId: commandId, staffSessionId: 'staff-owner' })
  appendDirectiveEvent(dir, { type: 'directive_approved', ts: 't2', directiveId: commandId, taskId })
  appendEvent(dir, { type: 'task_created', ts: 't0', campaignId: taskId, title: 'x', brief: 'b', acceptance: 'a', priority: 'normal' })
  appendEvent(dir, { type: 'task_published', ts: 't1', campaignId: taskId, workspacePath: join(dir, 'ws', taskId) })
  appendEvent(dir, { type: 'task_claimed', ts: 't2', campaignId: taskId, claimedBy: 'cmd-9', attemptId: `tok-${taskId}`, attempt: 1 })
  appendEvent(dir, { type: 'task_submitted', ts: 't3', campaignId: taskId, report: 'r', from: 'cmd-9' })
}

test('D27 复现：板面舰长验收（captain-board principal）对 staff-owned 任务放行——修前为红（B3 潜伏缺陷）', async () => {
  const dir = tmpDir()
  try {
    seedOwnedReported(dir, 'c-board')
    const deps = makeDeps(dir)
    await execTool(deps, 'war_close_task', { task_id: 'c-board', verdict: '通过' }, 'captain-board')
    assert.equal(loadCampaign(dir, 'c-board').status, 'closed', '板面舰长亲手验收必须能收官（hq 缺席不得拦）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D27 授权门：代理舰长代定夺 flag-gated——无授权拒（OFF 面等价），gate 放行才过', async () => {
  const dir = tmpDir()
  try {
    seedOwnedReported(dir, 'c-off')
    seedOwnedReported(dir, 'c-on')
    const off = makeDeps(dir)
    await assert.rejects(
      execTool(off, 'war_close_task', { task_id: 'c-off', verdict: '通过' }, 'proxy-abc'),
      /无权/,
      '授权 OFF：代理舰长（或任何非所属会话）收官被拒',
    )
    assert.equal(loadCampaign(dir, 'c-off').status, 'reported', '越权收官零写入')
    const on = makeDeps(dir, { verdictProxyGate: id => id === 'proxy-abc' })
    await execTool(on, 'war_close_task', { task_id: 'c-on', verdict: '通过（代理舰长代定夺：证据在案）' }, 'proxy-abc')
    assert.equal(loadCampaign(dir, 'c-on').status, 'closed', '舰长显式授权后代定夺放行')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D27 授权门：gate 在册但不匹配的代理会话仍拒（gate 判式含会话身份，不认前缀）', async () => {
  const dir = tmpDir()
  try {
    seedOwnedReported(dir, 'c-other')
    const deps = makeDeps(dir, { verdictProxyGate: id => id === 'proxy-abc' })
    await assert.rejects(
      execTool(deps, 'war_close_task', { task_id: 'c-other', verdict: '通过' }, 'proxy-spoof'),
      /无权/,
      '伪造 proxy- 前缀不算在册代理会话',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
