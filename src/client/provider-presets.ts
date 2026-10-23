/** D34 供应商预设注册表——照搬 zcode 开源实现（github.com/zai-org/ZCode，
 *  config/provider/zcode-builtin.json 的 providerConfigRules.templateRules 形状：
 *  id + 双语名 + baseUrl + 领 key 链接（apiKeyManagementUrl）+ 内置模型清单）。
 *  差异点：zcode 模板里 anthropic-messages 协议的供应商在此换用各家官方
 *  OpenAI 兼容端点——stardeck 的内置 loop 只说 openai-chat-completions 一种
 *  协议（@ai-sdk/openai-compatible）。本表是纯 UI 数据：选供应商=自动填
 *  baseUrl+模型快捷清单，存储形状仍是 config.loop 中立三件套。 */

export interface ProviderPreset {
  id: string
  name: { zh: string; en: string }
  baseUrl: string
  /** 领 key 链接（zcode apiKeyManagementUrl 同义）。 */
  keyUrl: string
  /** 常用模型 id（datalist + 快捷药丸；存储仍走自由输入）。 */
  modelIds: string[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'zai-coding',
    name: { zh: 'Z.ai 编程计划', en: 'Z.ai Coding Plan' },
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    modelIds: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.7', 'glm-5-turbo'],
  },
  {
    id: 'zai-standard',
    name: { zh: 'Z.ai 开放平台', en: 'Z.ai API' },
    baseUrl: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    modelIds: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.7'],
  },
  {
    id: 'deepseek',
    name: { zh: 'DeepSeek', en: 'DeepSeek' },
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    modelIds: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'kimi',
    name: { zh: 'Kimi（月之暗面）', en: 'Kimi (Moonshot)' },
    baseUrl: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    modelIds: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
  },
  {
    id: 'qwen',
    name: { zh: '阿里云百炼', en: 'Alibaba Model Studio' },
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/',
    modelIds: ['qwen3.8-max', 'qwen3.8-flash', 'qwen-plus', 'qwen-flash'],
  },
  {
    id: 'minimax',
    name: { zh: 'MiniMax', en: 'MiniMax' },
    baseUrl: 'https://api.minimaxi.com/v1',
    keyUrl: 'https://platform.minimaxi.com/console/access?tab=api-keys',
    modelIds: ['MiniMax-M3', 'MiniMax-M2.7'],
  },
  {
    id: 'openai',
    name: { zh: 'OpenAI', en: 'OpenAI' },
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    modelIds: ['gpt-5.6', 'gpt-5.4', 'gpt-5.4-mini'],
  },
  {
    id: 'anthropic',
    name: { zh: 'Anthropic（兼容层）', en: 'Anthropic (compat)' },
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    modelIds: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  },
]

/** 按基址匹配已存配置 → 初态高亮对应供应商（匹配不中=自定义）。 */
export function presetByBaseUrl(baseUrl: string): ProviderPreset | null {
  const norm = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (norm === '') return null
  return PROVIDER_PRESETS.find(p => p.baseUrl.replace(/\/+$/, '').toLowerCase() === norm) ?? null
}
