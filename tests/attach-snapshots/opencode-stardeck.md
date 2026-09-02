---
description: 召唤 stardeck 舰桥（作战看板）
---
舰长要召唤 stardeck 舰桥。逐步执行，不要跳步：
1. 用 shell 探测舰桥是否在线：curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3970/warroom/api/board（200 即在线）。
2. 在线：用 shell 打开浏览器（Windows: start "" "http://127.0.0.1:3970/"；macOS: open "http://127.0.0.1:3970/"；Linux: xdg-open "http://127.0.0.1:3970/"），然后只回复「舰桥已开启：<url>」。
3. 不在线：回复「舰桥 daemon 未启动」并给出本机 stardeck 仓库的启动方式（仓库目录内 pnpm start），不要伪造成功。