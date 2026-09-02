/**
 * stardeck MCP 桥（stdio JSON-RPC，随包发布）。
 * 外部 agent（opencode/codex/…经项目级 MCP 配置）把它当 MCP server 拉起；
 * 工具调用转发给 daemon 的 HTTP 面。stdout 只走协议帧——不许 console.log。
 *
 * 环境：STARDECK_HTTP（daemon 基址，默认 http://127.0.0.1:3970）/
 * STARDECK_AGENT（执行者身份，透传给 war_* 工具的调用方判定——令牌制与
 * 账本归属都认这个 id）。
 */
import readline from 'node:readline'

const HTTP = process.env.STARDECK_HTTP ?? 'http://127.0.0.1:3970'
const AGENT = process.env.STARDECK_AGENT ?? 'anonymous'

const rl = readline.createInterface({ input: process.stdin })
const send = obj => process.stdout.write(`${JSON.stringify(obj)}\n`)

rl.on('line', line => {
  const text = line.trim()
  if (text === '') return
  let msg
  try { msg = JSON.parse(text) } catch { return }
  if (msg.id === undefined || msg.id === null) return // notification：不回帧
  handle(msg).then(send, err => send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }))
})

async function post(path, body) {
  const res = await fetch(`${HTTP}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`daemon ${path} -> HTTP ${res.status}`)
  return res.json()
}

async function handle(msg) {
  const { id, method } = msg
  const params = msg.params ?? {}
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stardeck', version: '0.1.0' } } }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') {
    const tools = await (await fetch(`${HTTP}/warroom/api/mcp/tools`)).json()
    return { jsonrpc: '2.0', id, result: { tools } }
  }
  if (method === 'tools/call') {
    const name = typeof params.name === 'string' ? params.name : ''
    const args = (params.arguments ?? {})
    const out = await post('/warroom/api/mcp/call', { name, arguments: args, agentId: AGENT })
    // 工具业务失败（ok:false）也走 MCP isError 通道——错误文案本身就是出口教学。
    return {
      jsonrpc: '2.0', id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(out.ok ? out.result : { error: out.error }) }],
        isError: out.ok !== true,
      },
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } }
}
