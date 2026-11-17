/**
 * 舰队共享凭证翻译面（fleet-creds.ts）的确定性回归：族检测、各族 env 发射、
 * 生效条件（fleetInject/key/baseUrl 缺席=零注入）、z.ai anthropic 面改译单一源
 * （dshDeepseekBaseUrl 迁移后 executor re-export 面）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fleetEnvFor, fleetFamilyOf, dshDeepseekBaseUrl } from '../src/fleet-creds.ts'
import { dshDeepseekBaseUrl as dshDeepseekBaseUrlViaExecutor, childEnv } from '../src/executor.ts'

test('族检测：预设六族 + 自建代理 unknown（不猜方言）', () => {
  assert.equal(fleetFamilyOf('https://api.z.ai/api/coding/paas/v4'), 'zai')
  assert.equal(fleetFamilyOf('https://api.z.ai/api/paas/v4'), 'zai')
  assert.equal(fleetFamilyOf('https://gw.z.ai/v1'), 'zai', 'z.ai 子域同族')
  assert.equal(fleetFamilyOf('https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(fleetFamilyOf('https://api.openai.com/v1'), 'openai')
  assert.equal(fleetFamilyOf('https://api.moonshot.cn/v1'), 'moonshot')
  assert.equal(fleetFamilyOf('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'dashscope')
  assert.equal(fleetFamilyOf('https://api.anthropic.com/v1'), 'anthropic')
  assert.equal(fleetFamilyOf('https://my-gw.local/v1'), 'unknown', '自建代理零注入')
  assert.equal(fleetFamilyOf('not a url'), 'unknown', '非 URL 形态零注入')
})

test('生效条件：fleetInject 关 / key 空 / baseUrl 空 → 恒零注入（行为与旧版字节等价）', () => {
  assert.deepEqual(fleetEnvFor('https://api.z.ai/api/coding/paas/v4', 'sk-x', false), {})
  assert.deepEqual(fleetEnvFor('https://api.z.ai/api/coding/paas/v4', '', true), {})
  assert.deepEqual(fleetEnvFor('', 'sk-x', true), {})
  assert.deepEqual(fleetEnvFor('   ', '  ', true), {})
})

test('z.ai 族：pi(ZAI_API_KEY) + claude/opencode(ANTHROPIC_* 改译面) + dsh(DEEPSEEK_* 改译面)', () => {
  const env = fleetEnvFor('https://api.z.ai/api/coding/paas/v4', 'sk-zai', true)
  assert.equal(env.ZAI_API_KEY, 'sk-zai')
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic', 'OpenAI 面→anthropic 面改译（dshDeepseekBaseUrl 同源）')
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-zai')
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-zai')
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-zai')
  assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.z.ai/api/anthropic')
  // key trim 入 env（窗口保存同款卫生）
  const env2 = fleetEnvFor('https://api.z.ai/api/paas/v4/', '  sk-y  ', true)
  assert.equal(env2.ZAI_API_KEY, 'sk-y')
})

test('deepseek / openai / moonshot / dashscope / anthropic 族发射', () => {
  const ds = fleetEnvFor('https://api.deepseek.com/v1', 'sk-ds', true)
  assert.equal(ds.DEEPSEEK_API_KEY, 'sk-ds')
  assert.equal(ds.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1')
  assert.equal(ds.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic', 'claude 席走 deepseek 官方 anthropic 面（dsh 0.2.2 wire 正典）')
  const oa = fleetEnvFor('https://api.openai.com/v1', 'sk-oa', true)
  assert.deepEqual(oa, { OPENAI_API_KEY: 'sk-oa', OPENAI_BASE_URL: 'https://api.openai.com/v1' })
  assert.deepEqual(fleetEnvFor('https://api.moonshot.cn/v1', 'sk-m', true), { MOONSHOT_API_KEY: 'sk-m' })
  assert.deepEqual(fleetEnvFor('https://dashscope.aliyuncs.com/compatible-mode/v1', 'sk-q', true), { DASHSCOPE_API_KEY: 'sk-q' })
  const an = fleetEnvFor('https://api.anthropic.com/v1', 'sk-an', true)
  assert.equal(an.ANTHROPIC_BASE_URL, 'https://api.anthropic.com/v1', 'anthropic 族原样端点不改写')
  assert.equal(an.ANTHROPIC_AUTH_TOKEN, 'sk-an')
})

test('dshDeepseekBaseUrl 单一源迁移：executor re-export 与 fleet-creds 同一实现', () => {
  assert.equal(dshDeepseekBaseUrlViaExecutor, dshDeepseekBaseUrl, 're-export 面=同一函数（迁移保 API）')
  assert.equal(dshDeepseekBaseUrl('https://api.z.ai/api/coding/paas/v4'), 'https://api.z.ai/api/anthropic')
  assert.equal(dshDeepseekBaseUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1', '非 z.ai 域透传')
})

test('childEnv 合并序：process.env ← credEnv ← 席位专属（config>env 纪律，席位专属恒最高）', () => {
  const prev = { ...process.env }
  process.env.TEST_CRED_VAR = 'from-shell'
  try {
    const env = childEnv({ TEST_CRED_VAR: 'from-config', STARDECK_AGENT: 'cred-should-lose' }, { STARDECK_AGENT: 'seat-wins', STARDECK_HTTP: 'http://x' })
    assert.equal(env.TEST_CRED_VAR, 'from-config', 'credEnv 覆盖 shell 同名项')
    assert.equal(env.STARDECK_AGENT, 'seat-wins', '席位专属压过 credEnv')
    assert.equal(env.STARDECK_HTTP, 'http://x')
    const noCred = childEnv(undefined, {})
    assert.equal(noCred.TEST_CRED_VAR, 'from-shell', 'credEnv 缺席=纯继承（字节等价面）')
  } finally {
    if (prev.TEST_CRED_VAR === undefined) delete process.env.TEST_CRED_VAR
    else process.env.TEST_CRED_VAR = prev.TEST_CRED_VAR
  }
})
