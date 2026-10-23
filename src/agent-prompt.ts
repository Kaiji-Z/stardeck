/** D35 一条提示词（形态 A 入口）：用户把这段话粘给自己的 agent，agent 自行
 *  安装→connect→自证→开板。学习 Context7/Playwright MCP 的 README 一行流，
 *  但更进一步——命令让 agent 自己跑，用户全程不碰终端。
 *  零依赖纯模块（connect.ts 与 client/fleet-gate.tsx 共用单一源；connect.ts
 *  载 node 内建不可入 client bundle）。 */

export const AGENT_INSTALL_PROMPT_ZH = [
  '帮我安装并接入 stardeck（agent 舰队看板——装好后你将坐上它的「代理舰长」席）：',
  '1. 检查 Node ≥ 22（node -v）；没有就先帮我装 Node 22+。',
  '2. 运行 npm i -g stardeck。',
  '3. 运行 stardeck connect zcode（按你的宿主替换：claude / opencode / codex / zcode；不确定自己宿主就跑 stardeck connect，把打印的 mcpServers 配置块粘进你的 MCP 配置并让我确认）。',
  '4. 重启你自己让 MCP 生效，然后调 read_digest 工具验证连通（应返回舰队速览 JSON）。',
  '5. 运行 stardeck open 给我打开看板窗口（或告诉我地址 http://127.0.0.1:3970/）。',
  '之后你就是代理舰长：每轮先调 get_order 拿工作令（内含块文法教学）；下令落【命令】块、讲态势落【图景】块、管理意图落【撤令】【重派】【绑席】块；终答全文经 submit_reply 交给系统收割入账。签名与验收定夺永远留给我亲手，不代行。',
].join('\n')

export const AGENT_INSTALL_PROMPT_EN = [
  'Install and connect stardeck for me (an agent-fleet operations board — you will take its "acting captain" seat):',
  '1. Check Node >= 22 (node -v); install Node 22+ first if missing.',
  '2. Run: npm i -g stardeck',
  '3. Run: stardeck connect zcode (replace with your host: claude / opencode / codex / zcode; if unsure, run `stardeck connect` and paste the printed mcpServers block into your MCP config, then ask me to confirm).',
  '4. Restart yourself so the MCP server loads, then call the read_digest tool to verify (it should return a fleet digest).',
  '5. Run `stardeck open` to show me the board window (or tell me the address http://127.0.0.1:3970/).',
  'From now on you are the acting captain: call get_order each round for the work order (it teaches the block grammar); issue orders as [command] blocks, status overviews as [scene] blocks, management intents as the matching management blocks; deliver every final reply via submit_reply. Sign-offs and acceptance verdicts stay with me, always.',
].join('\n')

export function agentInstallPrompt(lang: 'zh' | 'en' = 'zh'): string {
  return lang === 'en' ? AGENT_INSTALL_PROMPT_EN : AGENT_INSTALL_PROMPT_ZH
}
