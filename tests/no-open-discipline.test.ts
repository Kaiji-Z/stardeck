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
