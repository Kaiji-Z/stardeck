/**
 * 舰队共享凭证翻译面（纯函数，2026-11-17 舰长令「key/url 在 stardeck 配一次、
 * 各 CLI 舰队调用」）：config.loop 的单份 BYOK 凭证（baseUrl+apiKey）按 baseUrl
 * 判供应商族，发射各 CLI 认识的标准环境变量；daemon 在 spawn 咽喉把它合并进
 * 子进程 env（credEnv 覆盖 process.env 同名项——与 mergeLoopEnv「config>env」
 * 同纪律）。
 * 覆盖面与盲区（诚实面）：pi=ZAI_API_KEY / DEEPSEEK_*；claude=ANTHROPIC_*（z.ai
 * 域自动改译 /api/anthropic 端点）；dsh=DEEPSEEK_*；opencode 按其供应商配置取
 * 标准 env（anthropic/openai 面）。两席明确不吃注入：codex（GLM 直驱的 key 走
 * codex-shim 垫片侧）、zcode（模型/鉴权由其自身 config 管理）——席位卡如实
 * 注记。未知供应商族=零注入（不猜网关方言）；key/baseUrl 缺席或 fleetInject
 * 关=零注入。
 * 本模块保持零依赖纯函数（client 侧也 import fleetFamilyOf 出覆盖面提示——
 * 同 agent-prompt.ts 的 node/client 单一源家法）。
 * @module stardeck/fleet-creds
 */

/** 供应商族（baseUrl 主机域判定；unknown=自建代理/未知网关——零注入不猜）。 */
export type FleetFamily = 'zai' | 'deepseek' | 'openai' | 'moonshot' | 'dashscope' | 'anthropic' | 'unknown'

/** baseUrl → 供应商族（纯）：z.ai 域（api.z.ai 及子域）、deepseek.com、
 *  api.openai.com、moonshot、dashscope（aliyuncs）、api.anthropic.com；
 *  其余 unknown。 */
export function fleetFamilyOf(baseUrl: string): FleetFamily {
  let host = ''
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return 'unknown'
  }
  if (host === 'z.ai' || host === 'api.z.ai' || host.endsWith('.z.ai')) return 'zai'
  if (host.endsWith('.deepseek.com')) return 'deepseek'
  if (host.endsWith('.openai.com')) return 'openai'
  if (host.endsWith('.moonshot.cn') || host.endsWith('.moonshot.ai')) return 'moonshot'
  if (host.endsWith('.aliyuncs.com') && host.split('.')[0] === 'dashscope') return 'dashscope'
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic'
  return 'unknown'
}

/** dsh 0.2.2 的 DEEPSEEK_BASE_URL 改译（纯，测试管辖）：llm-deepseek 已换
 *  Anthropic Messages wire——z.ai 域的 OpenAI 面（…/coding/paas/v4 等）改译
 *  同域 /api/anthropic（claude 席同款端点，2026-11-12 实弹 200）；非 z.ai 域
 *  与显式 DEEPSEEK_BASE_URL 原样透传（自定义网关自负责）。
 *  2026-11-17 自 executor.ts 迁入（实现单一源；executor 原位 re-export 保 API）。 */
export function dshDeepseekBaseUrl(zaiBaseUrl: string): string {
  try {
    const u = new URL(zaiBaseUrl)
    if (u.hostname === 'z.ai' || u.hostname === 'api.z.ai' || u.hostname.endsWith('.z.ai')) {
      return `${u.protocol}//${u.hostname}/api/anthropic`
    }
  } catch { /* 非 URL 形态：透传，让上游自己报错（诚实面） */ }
  return zaiBaseUrl
}

/** 共享凭证 → 舰队子进程 env（纯，daemon spawn 咽喉消费）。生效条件=
 *  fleetInject 开 ∧ key 非空 ∧ baseUrl 非空；族内按各 CLI 认识的标准变量发射：
 *  - zai：ZAI_API_KEY（pi）+ ANTHROPIC_*（claude/opencode，z.ai 域改译
 *    anthropic 面）+ DEEPSEEK_*（dsh，dshDeepseekBaseUrl 同款改译）；
 *  - deepseek：DEEPSEEK_* + ANTHROPIC_*（api.deepseek.com/anthropic 正典面，
 *    dsh 0.2.2 wire 同源）；
 *  - openai：OPENAI_API_KEY/OPENAI_BASE_URL；
 *  - moonshot/dashscope：各自 key 变量；
 *  - anthropic：ANTHROPIC_* 原样端点。 */
export function fleetEnvFor(baseUrl: string, apiKey: string, fleetInject: boolean): Record<string, string> {
  const base = baseUrl.trim()
  const key = apiKey.trim()
  if (!fleetInject || key === '' || base === '') return {}
  const anthropicFace = dshDeepseekBaseUrl(base)
  switch (fleetFamilyOf(base)) {
    case 'zai':
      return {
        ZAI_API_KEY: key,
        ANTHROPIC_BASE_URL: anthropicFace, ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: key,
        DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: anthropicFace,
      }
    case 'deepseek':
      return {
        DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: base,
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: key,
      }
    case 'openai':
      return { OPENAI_API_KEY: key, OPENAI_BASE_URL: base }
    case 'moonshot':
      return { MOONSHOT_API_KEY: key }
    case 'dashscope':
      return { DASHSCOPE_API_KEY: key }
    case 'anthropic':
      return { ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_BASE_URL: base }
    default:
      return {}
  }
}
