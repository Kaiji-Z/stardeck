/**
 * stardeck 舰桥召唤命令（由 stardeck 生成）：TUI 内 /stardeck 触发。
 * 探测舰桥在线 → 开浏览器；不在线给诚实指引。
 * 跳会话模板（与舰桥 jump 面同构）：pi --session <会话号>。
 */
const BOARD = "http://127.0.0.1:3970"

export default function (pi: { registerCommand: (name: string, cmd: { description: string; handler: (args: string[], ctx: { ui: { notify: (msg: string, level?: string) => void } }) => Promise<void> }) => void }) {
  pi.registerCommand("stardeck", {
    description: "召唤 stardeck 舰桥（作战看板）",
    handler: async (_args, ctx) => {
      const online = await fetch(BOARD + "/warroom/api/board", { method: "GET" }).then((r) => r.ok).catch(() => false)
      const { exec } = await import("node:child_process")
      if (online) {
        if (process.platform === "win32") exec(`start "" "${BOARD}/"`)
        else if (process.platform === "darwin") exec(`open "${BOARD}/"`)
        else exec(`xdg-open "${BOARD}/"`)
        ctx.ui.notify(`舰桥已开启：${BOARD}`)
      } else {
        ctx.ui.notify("舰桥 daemon 未启动——先在 stardeck 仓库运行 pnpm start（默认 http://127.0.0.1:3970）", "warning")
      }
    },
  })
}