/**
 * D29 外接代理舰长席：座席签发/身份门/契约端点。
 * - 纯面：issueProxySeat 往返（明文 token 永不落盘）/坏文件读作空表/seatByToken。
 * - 真 daemon：签席→order（块文法教学在场、永不教出口协议）→reply【命令】+
 *   【重派】块收割入账（issuedBy=proxyx-…）；伪造 token 403；**伪造 seatId 直打
 *   /tools/call 收官被拒**（在途祝福=只有 daemon 收割路径放行——Stop-if 那根刺）。
 * @module stardeck/tests/proxy-external-seat
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { issueProxySeat, seatByToken, loadProxySeats, hashToken, proxySeatsPath } from '../src/proxy-seats.ts'
import { loadDirectives } from '../src/directives.ts'
import { loadCampaign } from '../src/events.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('纯面：签发往返——token 只此一次，落盘只存哈希；二签不覆盖', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxyseats-'))
  try {
    const { seatId, token, record } = issueProxySeat(dir)
    assert.match(seatId, /^proxyx-[0-9a-z]+$/)
    assert.ok(token.length >= 32, 'token ≥32hex')
    assert.equal(record.tokenHash, hashToken(token))
    assert.equal(seatByToken(dir, token)?.seatId, seatId)
    assert.equal(seatByToken(dir, 'deadbeef'.repeat(6)), null, '错 token=null')
    assert.equal(seatByToken(dir, ''), null, '空 token=null')
    assert.ok(!readFileSync(proxySeatsPath(dir), 'utf8').includes(token), '明文 token 不得落盘')
    const second = issueProxySeat(dir)
    assert.equal(loadProxySeats(dir).length, 2, '追加不覆盖')
    assert.equal(seatByToken(dir, token)?.seatId, seatId)
    assert.equal(seatByToken(dir, second.token)?.seatId, second.seatId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('纯面：坏文件读作空表（诚实降级不炸启动）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxyseats-bad-'))
  try {
    writeFileSync(proxySeatsPath(dir), '{broken json！！', 'utf8')
    assert.deepEqual(loadProxySeats(dir), [])
    assert.equal(seatByToken(dir, 'x'.repeat(48)), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('真 daemon：签席→order→reply 收割入账；伪造 token 403；伪造 seatId 直打收官被拒（在途祝福）', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxyseat-e2e-'))
  const stateDir = join(dir, 'state')
  mkdirSync(stateDir, { recursive: true })
  // 种一个 staff-owned 活任务（指令三事件绑 staffSessionId + task_created 活体）——
  // 伪造收官若过门就会真关掉它，判据才有分辨力。
  const lines = [
    JSON.stringify({ type: 'directive_created', ts: '2026-10-21T10:00:00.000Z', directiveId: 'cmd-seed-forge', text: '种子命令（身份门考题）' }),
    // received 必须先于 approved——approved 是命令终态，其后的事件被 fold 终态守卫吞掉
    // （staffSessionId 就绑不上，ownerStaff=undefined → 身份门整段跳过，考题失效）。
    JSON.stringify({ type: 'directive_received', ts: '2026-10-21T10:00:01.000Z', directiveId: 'cmd-seed-forge', staffSessionId: 'staff-seed777' }),
    JSON.stringify({ type: 'directive_approved', ts: '2026-10-21T10:00:02.000Z', directiveId: 'cmd-seed-forge', taskId: '20261021-seed-forge' }),
  ]
  writeFileSync(join(stateDir, 'directives.jsonl'), lines.join('\n') + '\n', 'utf8')
  // 任务账本=每任务一文件（campaigns/<id>.jsonl）。
  mkdirSync(join(stateDir, 'campaigns'), { recursive: true })
  writeFileSync(join(stateDir, 'campaigns', '20261021-seed-forge.jsonl'), JSON.stringify({ type: 'task_created', ts: '2026-10-21T10:00:03.000Z', campaignId: '20261021-seed-forge', title: '种子任务', brief: '身份门考题', acceptance: '伪造收官必须被拒', priority: 'normal' }) + '\n', 'utf8')

  const port = 41110 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0', STARDECK_BRIDGE: '1', STARDECK_PROXY: '1' }
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], { cwd: repoRoot, env, stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
      if (!up) await new Promise(r => setTimeout(r, 500))
    }
    assert.ok(up, 'daemon 30s 未活')

    // ① 签席：seatId+token（token 只此一次）。
    const issue = await fetch(`${base}/warroom/api/proxy/seats`, { method: 'POST' }).then(r => r.json()) as { ok?: boolean; seatId?: string; token?: string; note?: string }
    assert.equal(issue.ok, true)
    assert.match(issue.seatId ?? '', /^proxyx-[0-9a-z]+$/)
    assert.ok((issue.token ?? '').length >= 32)
    const seatId = issue.seatId!
    const token = issue.token!

    // ② 伪造 token：order/reply 一律 403。
    assert.equal((await fetch(`${base}/warroom/api/proxy/order?token=fake`)).status, 403)
    assert.equal((await fetch(`${base}/warroom/api/proxy/order`)).status, 403)
    assert.equal((await fetch(`${base}/warroom/api/proxy/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'fake', text: 'hi' }) })).status, 403)
    assert.equal((await fetch(`${base}/warroom/api/proxy/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'no token' }) })).status, 400)

    // ③ order：块文法教学在场，出口协议永不出现；载荷带携史/账本/digest。
    const order = await fetch(`${base}/warroom/api/proxy/order?token=${token}`).then(r => r.json()) as { ok?: boolean; seatId?: string; order?: string; ledger?: string; digest?: string; base?: string }
    assert.equal(order.ok, true)
    assert.equal(order.seatId, seatId)
    assert.ok((order.order ?? '').includes('【命令】'), 'order 含命令块教学')
    assert.ok((order.order ?? '').includes('【图景】'), 'order 含图景块教学')
    assert.ok(!(order.order ?? '').includes('war_claim'), '永不教出口协议')
    assert.ok(!(order.order ?? '').includes('war_submit'), '永不教出口协议')
    assert.equal(order.base, base)
    assert.ok(typeof order.ledger === 'string' && typeof order.digest === 'string')

    // ④ 伪造 seatId 直打收官（在途祝福前哨）：必须被身份门拒——
    //    无祝福时 mgmtAllowed=true 会真关掉种子任务，此处错误文案=门的指纹。
    const forge = await fetch(`${base}/warroom/api/tools/call`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'war_close_task', arguments: { task_id: '20261021-seed-forge', verdict: '作废——冒用外接席身份' }, agentId: seatId }),
    }).then(r => r.json()) as { ok?: boolean; error?: string }
    assert.equal(forge.ok, false, '伪造 agentId 不得过门')
    assert.ok((forge.error ?? '').includes('无权'), `应被身份门拒：${forge.error}`)
    assert.notEqual(loadCampaign(stateDir, '20261021-seed-forge').status, 'closed', '种子任务未被动过')

    // ⑤ 正路 reply：【命令】+【重派】两块——重派走 blessed war_close_task 作废。
    const reply = await fetch(`${base}/warroom/api/proxy/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, text: '收到，马上办。\n\n【命令】\n盘点工作区结构并写一份 README 大纲\n（理由：舰长口谕——先摸清家底）\n\n【重派】（20261021-seed-forge）\n外勤上次跑挂了，按原任务书重跑一遍。' }),
    }).then(r => r.json()) as { ok?: boolean; seatId?: string; harvested?: { commands?: number; management?: number } }
    assert.equal(reply.ok, true)
    assert.equal(reply.seatId, seatId)
    assert.equal(reply.harvested?.commands, 1, '命令块收 1')
    assert.equal(reply.harvested?.management, 1, '重派（blessed 收官）收 1')

    // ⑥ 账本双证：命令卡 issuedBy=外接席；种子任务已被 blessed 收官。
    const directives = loadDirectives(stateDir)
    const issued = directives.filter(d => d.issuedBy === seatId)
    assert.equal(issued.length, 2, '命令卡+重派续接令都记外接席名下')
    assert.ok(issued.some(d => d.text.includes('盘点工作区结构')), '命令文本入账')
    assert.equal(loadCampaign(stateDir, '20261021-seed-forge').status, 'closed', '重派作废收官生效（blessed 路径通）')
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 500))
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 句柄竞态不致命 */ }
  }
})

test('真 daemon：代理/舰桥旗 OFF——外接席三端点 404（默认面纪律）', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stardeck-proxyseat-off-'))
  const stateDir = join(dir, 'state')
  mkdirSync(stateDir, { recursive: true })
  // 底数独占（41510 全仓唯一）：与 plan-reject 同用 41210 时 pid 同余即同港——
  // win32 双 daemon 共听串话，旗 OFF 面拿到旗 ON 的 200（并行偶发实证）。
  const port = 41510 + (process.pid % 50)
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, STARDECK_PORT: String(port), STARDECK_STATE_DIR: stateDir, STARDECK_STAFF: '0', STARDECK_BRIDGE: '0', STARDECK_PROXY: '0' }
  const daemon: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'cli.ts'), 'start'], { cwd: repoRoot, env, stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(`${base}/warroom/api/healthz`).then(r => r.ok).catch(() => false)
      if (!up) await new Promise(r => setTimeout(r, 500))
    }
    assert.ok(up, 'daemon 30s 未活')
    assert.equal((await fetch(`${base}/warroom/api/proxy/seats`, { method: 'POST' })).status, 404)
    assert.equal((await fetch(`${base}/warroom/api/proxy/order?token=x`)).status, 404)
    assert.equal((await fetch(`${base}/warroom/api/proxy/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
  } finally {
    daemon.kill()
    await new Promise(r => setTimeout(r, 500))
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 句柄竞态不致命 */ }
  }
})
