/**
 * D38.2 澄清半答闸单元测（批判轮 P1 收口的纯谓词核心）：两问只答一问
 * 不可送达——半答入账翻 pending 会烧 CLARIFY_ROUNDS_CAP=2 的轮数预算。
 * 覆盖判定只看「带选项的问题」；无选项数据恒放行（向后兼容无澄清形态）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clarifyCovered, clarifyProse } from '../src/client/clarify-gate.ts'

const TWO_Q = [['日常工具箱仓', '你帮我定'], ['中文', '英文', '你帮我定']]

test('clarify-gate: 两问只答一问=闸住（批判 P1 场景本体）', () => {
  assert.equal(clarifyCovered('1A;', TWO_Q), false)
  assert.equal(clarifyCovered('2B;', TWO_Q), false)
})

test('clarify-gate: 全答（含「你帮我定」显式委托）=放行', () => {
  assert.equal(clarifyCovered('1A; 2C;', TWO_Q), true)
  assert.equal(clarifyCovered('1B; 2A;', TWO_Q), true)
})

test('clarify-gate: 空答复/无澄清数据=放行（闸退化为原有非空检查）', () => {
  assert.equal(clarifyCovered('', TWO_Q), false)
  assert.equal(clarifyCovered('', []), true)
  assert.equal(clarifyCovered('随便说说', []), true)
})

test('clarify-gate: 混合形态——无选项的问题不参与覆盖判定', () => {
  assert.equal(clarifyCovered('1A;', [['甲', '乙'], []]), true)
  assert.equal(clarifyCovered('', [['甲', '乙'], []]), false)
})

test('clarify-gate: 越界/坏码不误放行也不误伤', () => {
  assert.equal(clarifyCovered('9Z; 1A; 2B;', TWO_Q), true, '越界码忽略，有效码照常计')
  assert.equal(clarifyCovered('1Z;', TWO_Q), false, '坏字母不匹配任何药丸')
})

test('clarify-gate: 改选语义——同问重选不产生幽灵覆盖', () => {
  assert.equal(clarifyCovered('2C; 1B;', TWO_Q), true)
  assert.equal(clarifyCovered('2C;', TWO_Q), false)
})

test('clarify-gate: clarifyProse 剥拼装码剩正文（板面单框形态）', () => {
  assert.equal(clarifyProse('1A; 2B;'), '')
  assert.equal(clarifyProse('1A; 都用中文'), '都用中文')
  assert.equal(clarifyProse('自由作答不点药丸'), '自由作答不点药丸')
  assert.equal(clarifyProse(''), '')
})
