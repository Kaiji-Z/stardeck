/**
 * D26 舰桥频道服务层测试：staffOrderFor chat 附页（舰桥段+携史+速览+对话纪律）、
 * 无 chat 参数时的工单头不变（旗 OFF 面不漂移）、finalStaffReply 缺席诚实降级。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { staffOrderFor, finalStaffReply, type StaffWorkItem } from '../src/staff.ts'

const item: StaffWorkItem = { commandId: 'cmd-1', kind: 'intake', text: '给工具箱加个格言小工具' }

test('chat 附页：舰桥段在场——舰长发话/携史/速览/对话纪律四要素', () => {
  const order = staffOrderFor([item], {}, 'mcp', {
    pending: [{ text: '现在舰队什么情况？', ts: '2026-10-20T10:00:00Z' }],
    history: [
      { role: 'manager', text: '上一轮我答复过的事' },
      { role: 'you', text: '舰长曾说过的话' },
    ],
    digest: JSON.stringify({ pendingDecisions: [{ kind: 'review', refId: 't1', title: '验收任务', since: '2026-10-20' }] }),
  })
  assert.ok(order.includes('舰桥频道（舰长发话）'), '舰桥段头')
  assert.ok(order.includes('【对话纪律】'), '对话纪律')
  assert.ok(order.includes('舰长曾说过的话') && order.includes('上一轮我答复过的事'), '携史双向在场')
  assert.ok(order.includes('现在舰队什么情况？'), '未答新话单列')
  assert.ok(order.includes('pendingDecisions'), '舰队速览内嵌')
  assert.ok(order.includes('【本轮工单】共 1 件'), '命令工单头保持既有措辞（items>0）')
})

test('chat 附页：无命令工单——头行改说「只回舰长的话」，不出现「共 0 件」', () => {
  const order = staffOrderFor([], {}, 'mcp', {
    pending: [{ text: '闲聊一句', ts: '2026-10-20T10:00:00Z' }],
    history: [],
    digest: '{}',
  })
  assert.ok(order.includes('无命令工单——本轮只回舰长的话'))
  assert.ok(!order.includes('共 0 件'))
})

test('chat 缺席：工单头与既有快照零漂移（旗 OFF 面=0.2.x 行为字节不变）', () => {
  const order = staffOrderFor([item], {}, 'mcp')
  assert.ok(order.includes('【本轮工单】共 1 件，逐件办结（顺序处理，不挑单）：'))
  assert.ok(!order.includes('舰桥频道（舰长发话）'))
})

test('finalStaffReply：attach 映射缺席 → null（诚实降级，不硬凑）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'warroom-bridge-staff-'))
  try {
    assert.equal(finalStaffReply(dir, 'staff-none'), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
