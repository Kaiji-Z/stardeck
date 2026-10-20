/**
 * D26→D27 舰桥频道服务层测试：大副 chat 附页退役（聊天职责移交代理舰长席，
 * staffOrderFor 回归纯舰务——无 chat 参数、无舰桥段）、finalStaffReply 缺席
 * 诚实降级。代理舰长征召令的覆盖在 tests/proxy-captain.test.ts。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { staffOrderFor, finalStaffReply, type StaffWorkItem } from '../src/staff.ts'

const item: StaffWorkItem = { commandId: 'cmd-1', kind: 'intake', text: '给工具箱加个格言小工具' }

test('D27 退役：大副征召令无舰桥段——聊天职责移交代理舰长（proxyOrderFor）', () => {
  const order = staffOrderFor([item], {}, 'mcp')
  assert.ok(!order.includes('舰桥频道（舰长发话）'), '舰桥段不在大副征召令')
  assert.ok(!order.includes('【对话纪律】'), '对话纪律不在')
  assert.ok(!order.includes('舰长新话'), '未答话不在——大副不见聊天内容')
})

test('D27 退役：无命令工单时大副不再出勤（「只回舰长的话」头行随附页退役）', () => {
  const order = staffOrderFor([], {}, 'mcp')
  assert.ok(!order.includes('只回舰长的话'))
  assert.ok(order.includes('共 0 件'), '工单头恢复 0.2.x 常态（daemon 不再以空工单+chat 出勤）')
})

test('chat 缺席：工单头与既有快照零漂移（旗 OFF 面=0.2.x 行为字节不变）', () => {
  const order = staffOrderFor([item], {}, 'mcp')
  assert.ok(order.includes('【本轮工单】共 1 件，逐件办结（顺序处理，不挑单）：'))
  assert.ok(!order.includes('舰桥频道（舰长发话）'))
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
