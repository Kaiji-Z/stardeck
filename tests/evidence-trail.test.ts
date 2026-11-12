/**
 * V19.12 取证轨迹判据（testsTrailVerdict）：BYOK 世界里 KillCredit 的机械
 * 天花板——tests 声明配套真实运行日志（存在 + mtime ≥ 领取时刻 + 尾部退出
 * 码行 + 与自报一致）。缺轨迹不硬拒但出注记（NO_TRAIL_NOTE）；轨迹相悖/
 * 越界/陈旧/无尾码全部打回。纯函数 + 真实临时盘双面锁定。
 * D41 前后对比截图判据（shotsVerdict）：报了 shots 逐对核存在性（越界/不
 * 存在打回）；UI 任务缺 shots 只注记不打回（判据不进 killCreditAllGreen）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { NO_TRAIL_NOTE, NO_SHOTS_NOTE, looksLikeUiTask, parseEvidence, shotsVerdict, testsTrailVerdict, type SubmissionEvidence } from '../src/tools.ts'

function ev(tests?: SubmissionEvidence['tests']): SubmissionEvidence {
  return {
    checks: [{ item: '验收项', passed: true }],
    ...(tests !== undefined ? { tests } : {}),
    files: ['a.js'],
  }
}

function tempWs(): string {
  return mkdtempSync(join(tmpdir(), 'trail-'))
}

test('无轨迹：tests 在场→注记（受理不硬拒），tests 缺席→静默放行，带轨迹无 tests→打回', () => {
  const now = new Date().toISOString()
  const noTrail = testsTrailVerdict({ trailPath: undefined, evidence: ev({ command: 'npm test', exitCode: 0, passed: 2, failed: 0 }), workspacePath: undefined, claimedAt: now })
  assert.equal(noTrail.ok, true)
  assert.equal(noTrail.ok && noTrail.note, NO_TRAIL_NOTE, 'tests 在场而缺轨迹 → 出注记')
  const blank = testsTrailVerdict({ trailPath: '  ', evidence: ev(), workspacePath: undefined, claimedAt: now })
  assert.equal(blank.ok, true)
  assert.equal(blank.ok && blank.note, '', 'evidence 无 tests 且无轨迹 → 无注记')
  const dangling = testsTrailVerdict({ trailPath: '.stardeck/evidence/tests.log', evidence: ev(), workspacePath: undefined, claimedAt: now })
  assert.equal(dangling.ok, false, '带轨迹却没报 tests → 打回（参数错配）')
})

test('轨迹存在性 + 边界：界外路径 / 不存在的轨迹 → 打回（教学文案）', () => {
  const ws = tempWs()
  try {
    const now = new Date().toISOString()
    const base = { evidence: ev({ command: 'npm test', exitCode: 0, passed: 1, failed: 0 }), workspacePath: ws, claimedAt: now }
    const escape = testsTrailVerdict({ ...base, trailPath: '../outside.log' })
    assert.equal(escape.ok, false)
    assert.match(escape.ok === false ? escape.reason : '', /工作区外/, '越界轨迹拒绝')
    const missing = testsTrailVerdict({ ...base, trailPath: '.stardeck/evidence/tests.log' })
    assert.equal(missing.ok, false)
    assert.match(missing.ok === false ? missing.reason : '', /不存在/, '缺轨迹文件拒绝')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('轨迹时间序 + 尾部退出码：陈旧轨迹 / 无尾码 / 退出码相悖 → 打回；全绿 → 放行', () => {
  const ws = tempWs()
  try {
    mkdirSync(join(ws, '.stardeck', 'evidence'), { recursive: true })
    const trailRel = '.stardeck/evidence/tests.log'
    const trailAbs = join(ws, '.stardeck', 'evidence', 'tests.log')
    const claimMs = Date.now() - 60_000
    const claimedAt = new Date(claimMs).toISOString()
    const base = { evidence: ev({ command: 'npm test', exitCode: 0, passed: 3, failed: 0 }), workspacePath: ws, claimedAt }

    writeFileSync(trailAbs, '> npm test\nok 1 - a\nok 2 - b\nok 3 - c\n0\n', 'utf8')
    const good = testsTrailVerdict({ ...base, trailPath: trailRel })
    assert.equal(good.ok, true, '全绿轨迹放行')
    assert.match(good.ok ? good.note : '', /已核对.*tests\.log/, '放行注记带核对凭据')

    writeFileSync(trailAbs, 'old run\n0\n', 'utf8')
    utimesSync(trailAbs, new Date(claimMs - 600_000), new Date(claimMs - 600_000))
    const stale = testsTrailVerdict({ ...base, trailPath: trailRel })
    assert.equal(stale.ok, false, '轨迹早于领取时刻 → 打回')
    assert.match(stale.ok === false ? stale.reason : '', /早于本次领取/, '陈旧轨迹教学点明时间序')

    writeFileSync(trailAbs, 'ok 1 - a\n( no exit code line )\n', 'utf8')
    const noTail = testsTrailVerdict({ ...base, trailPath: trailRel })
    assert.equal(noTail.ok, false, '尾部无退出码行 → 打回')
    assert.match(noTail.ok === false ? noTail.reason : '', /退出码行/, '教学点名 echo $?')

    writeFileSync(trailAbs, 'not ok 1 - a\n1\n', 'utf8')
    const contradicted = testsTrailVerdict({ ...base, trailPath: trailRel })
    assert.equal(contradicted.ok, false, '轨迹退出码 1 ≠ 自报 0 → 打回')
    assert.match(contradicted.ok === false ? contradicted.reason : '', /相悖/, '相悖教学点名打回语义')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

// ── D41 前后对比截图（shotsVerdict + parseEvidence.shots + looksLikeUiTask）──

test('D41 shotsVerdict：全部在场→核对注记；不存在/越界→打回（与取证轨迹同权）', () => {
  const ws = tempWs()
  try {
    mkdirSync(join(ws, '.stardeck', 'evidence', 'shots'), { recursive: true })
    writeFileSync(join(ws, '.stardeck', 'evidence', 'shots', 'before.png'), 'png', 'utf8')
    writeFileSync(join(ws, '.stardeck', 'evidence', 'shots', 'after.png'), 'png', 'utf8')
    const shots = [{ before: '.stardeck/evidence/shots/before.png', after: '.stardeck/evidence/shots/after.png', caption: '主题切换' }]
    const good = shotsVerdict({ shots, workspacePath: ws, uiTask: true })
    assert.equal(good.ok, true, '在场截图放行')
    assert.match(good.ok ? good.note : '', /已核对 1 对/, '放行注记带核对凭据')

    const missing = shotsVerdict({ shots: [{ before: '.stardeck/evidence/shots/before.png', after: '.stardeck/evidence/shots/gone.png' }], workspacePath: ws, uiTask: true })
    assert.equal(missing.ok, false, '报了不存在的截图 → 打回')
    assert.match(missing.ok === false ? missing.reason : '', /不存在/, '教学点名真实性')

    const escape = shotsVerdict({ shots: [{ before: '../outside.png', after: '.stardeck/evidence/shots/after.png' }], workspacePath: ws, uiTask: true })
    assert.equal(escape.ok, false, '越界截图路径 → 打回')
    assert.match(escape.ok === false ? escape.reason : '', /工作区外/, '教学点名边界')

    const unbound = shotsVerdict({ shots, workspacePath: undefined, uiTask: true })
    assert.equal(unbound.ok, false, '无工作区却报 shots → 打回（无从核对）')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('D41 shotsVerdict：UI 任务缺 shots→注记不打回；非 UI 任务缺 shots→静默', () => {
  const uiMissing = shotsVerdict({ shots: undefined, workspacePath: '/ws', uiTask: true })
  assert.equal(uiMissing.ok, true)
  assert.equal(uiMissing.ok && uiMissing.note, NO_SHOTS_NOTE, 'UI 交付无截图 → 注记（不硬拒）')
  const quiet = shotsVerdict({ shots: undefined, workspacePath: '/ws', uiTask: false })
  assert.equal(quiet.ok, true)
  assert.equal(quiet.ok && quiet.note, '', '非 UI 任务缺截图 → 零干预')
  const empty = shotsVerdict({ shots: [], workspacePath: '/ws', uiTask: true })
  assert.equal(empty.ok && empty.note, NO_SHOTS_NOTE, '空数组视同缺席')
})

test('D41 looksLikeUiTask：词表命中 title/acceptance/report 任一即 UI 任务（保守集）', () => {
  assert.equal(looksLikeUiTask('换配色', undefined, undefined), true)
  assert.equal(looksLikeUiTask(undefined, '界面响应式', undefined), true)
  assert.equal(looksLikeUiTask(undefined, undefined, '更新了前端页面'), true)
  assert.equal(looksLikeUiTask('修 README 错字', '拼写正确', '改了文档'), false)
})

test('D41 parseEvidence：shots 数组解析存活（caption 可选）；形状坏→打回', () => {
  const good = parseEvidence(JSON.stringify({
    checks: [{ item: 'a', passed: true }],
    shots: [{ before: '.stardeck/evidence/shots/before.png', after: '.stardeck/evidence/shots/after.png', caption: '主题切换' }],
  }))
  assert.equal(good.ok, true)
  assert.equal(good.ok && good.evidence.shots?.length, 1, 'shots 存活进 evidence（不列即丢弃的家法）')
  assert.equal(good.ok && good.evidence.shots?.[0]?.caption, '主题切换')
  const bare = parseEvidence(JSON.stringify({ checks: [{ item: 'a', passed: true }], shots: [{ before: 'b.png', after: 'a.png' }] }))
  assert.equal(bare.ok && bare.evidence.shots?.[0]?.caption, undefined, 'caption 缺省不落字段')

  const badItem = parseEvidence(JSON.stringify({ checks: [{ item: 'a', passed: true }], shots: [{ before: 'b.png' }] }))
  assert.equal(badItem.ok, false, '缺 after → 打回')
  assert.match(badItem.ok === false ? badItem.reason : '', /before.*after|shots 项/, '教学点名 shots 形状')
  const notArray = parseEvidence(JSON.stringify({ checks: [{ item: 'a', passed: true }], shots: 'b.png' }))
  assert.equal(notArray.ok, false, '非数组 → 打回')
})
