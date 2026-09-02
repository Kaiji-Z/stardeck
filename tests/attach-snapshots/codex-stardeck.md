<!-- 适用性注记：codex custom prompts 机制版本敏感（0.117 起 /stardeck 可能不再出现在斜杠菜单，
      见 openai/codex#15939 #15941；上游正转向 /skill 体系）。若失效请按当时版本机制重装。 -->
召唤 stardeck 舰桥（作战看板）。执行：
1. 探测舰桥在线：curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3970/warroom/api/board。
2. 在线：打开浏览器（Windows: start "" "http://127.0.0.1:3970/"；macOS: open "http://127.0.0.1:3970/"），回复「舰桥已开启」。
3. 不在线：回复「舰桥 daemon 未启动」+ 本机 stardeck 仓库启动方式（pnpm start）。不要伪造成功。
跳会话模板（与舰桥 jump 面同构）：codex resume <会话号>。