/**
 * 开箱自动化面纪律门（D31 弹窗漏网回归）：孵化真 daemon 的测试/脚本 spawn 点
 * 必须显式带 --no-open。两轮实弹教训——「start 就绪自动开浏览器」对全量 verify
 * 的每个真 daemon 测试弹一窗（舰长眼前 browser 窗口风暴），第一轮修补的审计
 * grep 又被 head 截断漏掉 local-faces/steer 两文件。此测试扫全仓 spawn 行，
 * 见无旗的 start 孵化即 FAIL——纪律不再靠人记审计名单。
 * @module stardeck/tests/no-open-discipline
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test('spawn 纪律：孵化 daemon 的测试/脚本 spawn 点必须显式 --no-open', () => {
  const offenders: string[] = []
  const scan = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (!(name.endsWith('.ts') || name.endsWith('.mjs'))) continue
      const path = join(dir, name)
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (line.includes(`'cli.ts'), 'start']`) && !line.includes(`'--no-open']`)) {
          offenders.push(`${path}:${i + 1}`)
        }
      })
    }
  }
  scan(join(repoRoot, 'tests'))
  scan(join(repoRoot, 'scripts'))
  assert.deepEqual(offenders, [], `孵化 daemon 的 spawn 点缺 --no-open（verify 每跑一次弹一窗）：\n${offenders.join('\n')}`)
})

test('token 纪律：孵化 daemon 的测试文件必须显式关大副外聘（STARDECK_STAFF=0）', () => {
  // staff 默认 ON：不关的测试 daemon 每 15s tick 有待决工单就会 spawn 真
  // opencode=真网关 token（scene-visual 曾发舰桥消息+读真实 config=潜在实弹）。
  // 文件级判据：文件里有 daemon 孵化（cli.ts start / startDaemon()）就必须出现
  // STARDECK_STAFF——scripts 豁免（live-check 大副相位、playground 均有意 ON）。
  const offenders: string[] = []
  for (const name of readdirSync(join(repoRoot, 'tests'))) {
    if (!name.endsWith('.test.ts')) continue
    const path = join(repoRoot, 'tests', name)
    const body = readFileSync(path, 'utf8')
    const spawnsDaemon = body.includes(`'cli.ts'), 'start'`) || body.includes('startDaemon(')
    if (spawnsDaemon && !body.includes('STARDECK_STAFF')) offenders.push(path)
  }
  assert.deepEqual(offenders, [], `孵化 daemon 的测试缺 STARDECK_STAFF 关断（潜在真模型 token 燃烧）：\n${offenders.join('\n')}`)
})
