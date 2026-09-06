/**
 * 舰队兵种面（UI 入口绑定）的确定性回归：三席清单/实验性标记、探测语义
 * （绝对路径 existsSync 真/假；探针注入位可控）、席位 id 校验。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeFleet, fleetSeatIds, bindableSeatIds, seatLabelOf, seatStatusOf } from '../src/fleet.ts'
import { seatStatusOf } from '../src/client/fleet-gate.tsx'

test('席位正典清单：十二席（双席正典后六席可选 + 二半证降不可选 + 四契约）；双语 note 齐', () => {
  assert.deepEqual(fleetSeatIds(), ['opencode', 'pi', 'codex', 'zcode', 'claude', 'gemini', 'qwen', 'dsh', 'copilot', 'amp', 'cursor', 'droid'])
  // V19.13 双席正典：可选=大副+外勤双接通——gemini/qwen（双席不全）降不可选。
  assert.deepEqual(bindableSeatIds(), ['opencode', 'pi', 'codex', 'zcode', 'claude', 'dsh'])
  const seats = probeFleet('', () => true) // 探针全真——只验清单形状
  assert.equal(seats.length, 12)
  assert.equal(seats.filter(s => s.experimental === true).map(s => s.id).join(), 'gemini,qwen')
  for (const s of seats) {
    assert.ok(s.note.length > 10, `${s.id} 缺人话说明`)
    assert.ok((s.noteEn ?? '').length > 10, `${s.id} 缺英译说明（i18n 绑定门）`)
    assert.ok(s.bin.length > 0)
    // 可选判别式=adapter 且 staffReady（gemini/qwen adapter 在场但双席不全）。
    assert.equal(bindableSeatIds().includes(s.id), s.adapter && s.staffReady, `${s.id} 可选标记与双席正典不一致`)
  }
  assert.equal(seatLabelOf('pi'), 'pi')
  assert.equal(seatLabelOf('不存在的'), 'opencode')
})

test('契约席三分语义：adapter=false / staffReady=false 一律不可选（装了二进制也不开——不装样子）', () => {
  assert.equal(seatStatusOf({ ok: true, adapter: false }), 'absent')
  assert.equal(seatStatusOf({ ok: true, experimental: true, adapter: true, staffReady: true }), 'limited')
  assert.equal(seatStatusOf({ ok: false, adapter: true, staffReady: true }), 'absent')
  assert.equal(seatStatusOf({ ok: true, adapter: true, staffReady: false }), 'absent', '双席不全=不可选（V19.13 舰长令）')
})

test('探测语义：绝对入口 existsSync 定生死（真入口 ok / 假入口 not ok）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-fleet-'))
  try {
    const fake = join(dir, 'cli-entry.js')
    writeFileSync(fake, '', 'utf8')
    const okSeats = probeFleet(fake, () => { throw new Error('绝对路径不应走探针') })
    assert.ok(okSeats.every(s => s.ok === true))
    const badSeats = probeFleet(join(dir, 'absent.js'), () => { throw new Error('绝对路径不应走探针') })
    assert.ok(badSeats.every(s => s.ok === false))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('探测语义：裸名走 --version 探针（win32 无绝对入口的 PATH 形）', () => {
  const seats = probeFleet('', bin => bin === 'probe-hit')
  assert.equal(seats.length, 12) // 注入探针不抛错即证明走了探针分支（zcode/qwen 席=包内绝对路径，探针不抛）
})

test('席位卡三分语义（绑定门诚实证）：可绑定 / 受限·实验性 / 未检出——codex 不再裸标可绑定', () => {
  assert.equal(seatStatusOf({ ok: true }), 'ready')
  assert.equal(seatStatusOf({ ok: true, experimental: true }), 'limited') // codex 席：契约在档但本机有已知阻碍
  assert.equal(seatStatusOf({ ok: false }), 'absent')
  assert.equal(seatStatusOf({ ok: false, experimental: true }), 'absent') // 未检出优先于实验性
})
