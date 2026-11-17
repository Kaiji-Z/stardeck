/**
 * 舰队兵种面（UI 入口绑定）的确定性回归：席位清单/实验性标记、探测语义
 * （绝对路径 existsSync 定 ok、探针注入位可控、版本串捕获）、席位 id 校验。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeFleet, fleetSeatIds, bindableSeatIds, seatLabelOf } from '../src/fleet.ts'
import { seatStatusOf } from '../src/client/fleet-gate.tsx'

test('席位正典清单：十二席（双席正典后六席可选 + 二半证降不可选 + 四契约）；双语 note 齐', () => {
  assert.deepEqual(fleetSeatIds(), ['opencode', 'pi', 'codex', 'zcode', 'claude', 'gemini', 'qwen', 'dsh', 'copilot', 'amp', 'cursor', 'droid'])
  // V19.13 双席正典：可选=大副+外勤双接通——gemini/qwen（双席不全）降不可选。
  assert.deepEqual(bindableSeatIds(), ['opencode', 'pi', 'codex', 'zcode', 'claude', 'dsh'])
  const seats = probeFleet('', () => '1.0.0') // 探针全命中——只验清单形状
  assert.equal(seats.length, 12)
  assert.equal(seats.filter(s => s.experimental === true).map(s => s.id).join(), 'gemini,qwen')
  for (const s of seats) {
    assert.ok(s.note.length > 10, `${s.id} 缺人话说明`)
    assert.ok((s.noteEn ?? '').length > 10, `${s.id} 缺英译说明（i18n 绑定门）`)
    assert.ok(s.bin.length > 0)
    assert.equal(s.version, '1.0.0', `${s.id} 探针命中应带版本串`)
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

test('探测语义：绝对入口 existsSync 定 ok（探针失败不翻案）；版本串 best-effort', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-fleet-'))
  try {
    const fake = join(dir, 'cli-entry.js')
    writeFileSync(fake, '', 'utf8')
    // 探针失败（false）不得影响绝对路径席的 ok——文件在即真，跑不跑得动让征召首发如实报错。
    const okSeats = probeFleet(fake, () => false)
    assert.ok(okSeats.every(s => s.ok === true))
    assert.ok(okSeats.every(s => s.version === ''), '探针失败=版本未知（空串）')
    const badSeats = probeFleet(join(dir, 'absent.js'), () => '9.9.9')
    assert.ok(badSeats.every(s => s.ok === false), '绝对路径缺席=existsSync 判负')
    assert.ok(badSeats.every(s => s.version === '9.9.9'), 'ok 判负不影响版本 best-effort 取值')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('探测语义：裸名走 --version 探针（win32 无绝对入口的 PATH 形）——命中=ok+版本、未中=缺席', () => {
  // 契约席（copilot/amp…）的 detect 恒返裸名——不随本机安装态漂移，断言确定性。
  const seats = probeFleet('', bin => (bin === 'copilot' ? '2.5.0\nsecond-line' : false))
  assert.equal(seats.length, 12)
  const hit = seats.find(s => s.id === 'copilot')
  const miss = seats.find(s => s.id === 'amp')
  assert.ok(hit !== undefined && hit.ok === true && hit.version === '2.5.0', '裸名探针命中=可跑+首行版本（多行只取首行）')
  assert.ok(miss !== undefined && miss.ok === false && miss.version === '', '裸名探针未中=缺席+无版本')
})

test('版本探针可执行形态白名单：.ts 源码入口零 spawn（2026-11-17 WMP 弹窗坑——.ts 被文件关联时 cmd 会当文档打开）；.js 入口经 node 取版本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-fleet-probe-'))
  try {
    const tsEntry = join(dir, 'bin.ts')
    writeFileSync(tsEntry, '', 'utf8')
    const tsSeats = probeFleet(tsEntry) // 缺省探针——.ts 必须零 spawn（回归钉：修前每次 GET /fleet 弹一个 Media Player）
    assert.ok(tsSeats.every(s => s.version === ''), '.ts 入口=诚实空版本（不 shell 打开）')
    assert.ok(tsSeats.every(s => s.ok === true), 'ok 语义不变（existsSync 判真，探针失败不翻案）')
    const jsEntry = join(dir, 'cli.js')
    writeFileSync(jsEntry, 'process.stdout.write("9.9.9-fake")', 'utf8')
    const jsSeats = probeFleet(jsEntry)
    assert.ok(jsSeats.every(s => s.version === '9.9.9-fake'), '.js 入口经 process.execPath 直跑取版本')
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) }
})

test('席位卡三分语义（绑定门诚实证）：可绑定 / 受限·实验性 / 未检出——codex 不再裸标可绑定', () => {
  assert.equal(seatStatusOf({ ok: true }), 'ready')
  assert.equal(seatStatusOf({ ok: true, experimental: true }), 'limited') // codex 席：契约在档但本机有已知阻碍
  assert.equal(seatStatusOf({ ok: false }), 'absent')
  assert.equal(seatStatusOf({ ok: false, experimental: true }), 'absent') // 未检出优先于实验性
})
