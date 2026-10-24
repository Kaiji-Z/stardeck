# Changelog

本仓遵循 [Keep a Changelog 1.1](https://keepachangelog.com/zh-CN/1.1.0/)；版本号 pre-1.0 用 `0.<里程碑>.<迭代>-<刀>`（继承 warroom 版本方案）。**发版门**：平时只往 `[Unreleased]` 积条目，项目主明说「发版」才落版本头（本仓尚无 npm 发布管线，落版本头同时推进 package.json）。


## [0.8.3] - 2026-10-24

### Added（D38 设计语言换血：lookatstudy 语系 × 舰桥青 × 深色默认 + 浮窗重做）

- **新设计语言底座（全应用）**：token 层两定义块全字面值自洽（脱离宿主 `--dsw-*` 别名——令牌荒漠在结构上不可能复发，ui-tokens 测试换锁更强不变量：定义块零 dsw 直引）；近黑五级表面阶（层级靠深浅不靠描边）+ 信号蓝强调 + WCAG AA 文字阶 + 16px 大圆角阶 + 软阴影三档（1px 描边与大模糊不并存铁律）+ 动效曲线四 token（expo/spring/quart，reduced-motion 全降级）。**深色默认**：首跑无存储偏好即深色，浅色降为一等公民同步设计（显式选浅才摘属性）。
- **浮窗重做**：16px 玻璃面板（pop 92%+blur(20px) 饱和）+玻璃 header（在役状态点）+玻璃球（hover 亮环缩放）+200ms expo 弹入；消息流=claude.ai 阅读流正典（AI 全宽扁平/舰长右对齐微染气泡右下尾角/机械战报居中药丸/日期发丝线分隔/新消息 200ms 上浮）；思考折叠区=微染圆角卡；工具 chip=无描边药丸；打字点=信号蓝三点弹跳。
- **composer 一体卡**：textarea+状态槽+工具条+发送钮一张 16px 圆角卡——离线/失败/停用/已发送四类提示**单槽换内容**（旧五层纵叠抖动终局）；effort/占用环改 caption 药丸入卡底行（选中态 accent 染底）；圆形 3D 发送钮（实底硬下缘 active 下沉）与停止钮同位切换。决策卡统一卡面+药丸习语全应用一种。
- **批判轮回流（impeccable 双隔离初评 30/40 → 修五件 → 复评 37/40，P0=P1=0）**：卡死轮黑洞=待答轮（末条是舰长发言）同位给停止钮+无在途诚实回执；meta 行 2.2:1→text-2 实色 6.3-7.4:1（hover 升 text-1）；主按钮白字 4.1:1→action-bg 加深 #0369a1（5.93:1 双主题）；决策卡 tag 族色回归（澄清/签发=琥珀、重试=红、验收=蓝，与板收件箱同语义）；Esc/✕ 关窗焦点回球；chosen 回显去裸码前缀；hintbar 11px。
- 目检 50/50（+8 断言：深色默认/面板 16px+玻璃/composer 结构/圆形发送钮/状态单槽/meta 弱化/浅色往返；另修判决诚实刀——中途异常计入 results 不再假 PASS）；测试 583（ui-tokens 契约随自洽化锁步演进，非改判据：旧「引用面≥20」地板守的架构已被替换，新不变量更强）；live 17/17；文案漂移修正（「约 15 秒起档」→kick 实际 ~1s）。

## [0.8.2] - 2026-10-24

### Added（D37 对话频道补全：思考强度 + 上下文占用 + 停止/计量）

- **思考强度三档**（自动/快速/深度，照搬 lookatstudy bodyPatch 方言表）：`LoopConfig.effort` 落 `config.loop` 段；GLM 家族（baseUrl+模型串双源嗅探，自建代理端点也认）按档打 `thinking:{type}`+`reasoning_effort` 请求体补丁，非方言家族 UI 门控禁用恒自动。两处 UI：模型设置弹窗三选段 + **浮窗工具条快捷芯条**（点击循环切换，POST 即时生效）。
- **上下文占用表（ContextMeter）**：`provider-presets` 每档带 `contextWindow`；daemon 组包分段估算（教学骨架/对话历史/账本切片/本轮新话——CJK 1.1 token/字启发式）；浮窗工具条 14px 环形表+百分比（≥85% warning 色），点击弹四段明细面板；窗口未知=诚实只报用量。**历史预算双闸**：24 条上限外再加 token 闸（窗口×60%，从新往旧装，超即停，至少保最新一条）。
- **停止钮**：在途轮（思考/正文/工具任一有流量）发送钮变 ■停止 → `POST /loop-abort` → daemon 掐在途 AbortController（与看门狗组合 signal）——丢弃在途不上账、「已停止」terminal 战报、**不降级 spawn**（停止是舰长意志非失手）；无在途回 `stopped:false` 不弹假战报。
- **真实计量（usage 采集）**：loop 开 `includeUsage`（stream_options）+收 usage 帧解析（spec v2 面名 `inputTokens/outputTokens`，别按 v3 读——读错全 undefined 静默）；终答入账 agent 消息**条件 spread `meta`**（模型/思考档/耗时/tokens——回合事实审计，旧消息零迁移），浮窗消息 meta 行小字呈现（`glm-5.3 · 深度 · 4.2s · ↑1.2k ↓340`）；思考流折叠区标题带字数。
- 词典四典 +18 键（effort 三档/占用四段/停止/meta 行/思考字数）；测试 582（+7：bodyPatch 方言三态/usage 采集含 stream_options 断言/abort 掐断/方言嗅探/estimateTokens/历史预算双闸/meta fold 零迁移）；UI 目检 42/42（新增 8 断言：芯条/档位切换落盘/占用环四段面板/meta 行/停止钮 e2e 慢答假网关全弧线）；live 17/17。

### Fixed

- 测试端口底数串话（档内坑录重演）：loop-config 端点细节甲/乙换独占底数 41410/41430（原 41310 与 mcp-proxy-face/proxy-kick 三文件共用、41330 与 cli-commands 共用——全量并行下 loop-test 打到别家 daemon 收 HTTP 404 误报「未配 key」断言败）。

## [0.8.1] - 2026-10-24

### Added（D36 流式详情 + 发话即应答 + 对抗审查回流）

- **发话即应答**：聊天窗发话入账成功即触发代理舰长一轮（`bridgeKick`——15s 哨位降为兜底巡逻），实测 kick→loop 开跑 ~1 秒（旧口径平均 7.5s+起步延迟）；loop 收官若还有未答新话 400ms 自动续跑。
- **流式详情（lookatstudy/DSH 同形）**：在途回合气泡新增**思考过程折叠区**（GLM reasoning_content 思考流逐字上屏，正文开始自动收起）与**工具参数/结果摘要**（chip 行内省略号+悬停全文）——「正在回话」之外，loop 在想什么、查什么都看得见；全部会话态不进账本。
- **对抗审查回流（静默吞话修复）**：连发消息攻击抓到两连坑（同步抢跑组包+「末条=agent」时间轴判答）——轮中后到的消息会被顺带判答且永无回音。修=**回合水位**（pending 判定 `user.ts>watermark`，推进点=入账成功，失手重试语义保留）+kick 250ms 防抖吸收连发进同轮；回归钉 proxy-kick ×2（慢流假网关）。

### Fixed
- 发版仪式 GATE 5：`gh release create` 误带 upload 的 `--clobber` 旗导致 v0.8.0 安装器手动补挂——改 view 探测缺席才 create，Release 建挂全自动。

## [0.8.0] - 2026-10-24

### Added（D31-D35 聊天产品级重塑 + 供应商中立 + 两形态降门槛）

- **可拖拽舰桥悬浮球**（D31）：看板恒为基座+Telegram 式贴球聊天浮窗（点按开关/拖动移位持久化/双击复位/键盘可达）；设置唯一面=看板设置抽屉。
- **内置 BYOK loop 翻默认+流式**（D32）：Z_AI_* 齐即默认开（=0 显式关）；打字机气泡（onTextDelta→daemon live 缓冲→SSE {live} 帧，会话态不进账本）+ 工具步骤 chip（「在查账」可见）。
- **自带聊天产品级重塑**（D33）：bug 表 8 条全关（Enter 直发/断网 banner/流式帧对称/球复位…）+ lookatstudy 中栏四件移植（回底钮/时间戳弱化/复制钮/未读分隔）+ **模型配置窗**（key 存本机 config.loop——舰长批准的放宽；loop-config/loop-test 端点；测试连接带所见覆盖：未保存先测=测所见不落盘）+ 浮窗可自主调整大小（panel-size 纯模块）；critique 九轮 28→35.5/40 且 P0/P1=0；实弹修复【命令】块解析从宽（flash 散文行尾方差）。
- **供应商中立化**（D34，照搬 zcode 开源注册表 github.com/zai-org/ZCode config/provider/zcode-builtin.json）：provider-presets.ts 八家预设（Z.ai 编程计划/开放平台、DeepSeek、Kimi、阿里百炼、MiniMax、OpenAI、Anthropic 兼容层）——选供应商=基址自填+模型快捷药丸+**领 key ↗ 直达链接**；**模型设置独立弹窗**（设置抽屉一行摘要+「模型设置…」钮；Esc 只关弹窗；统一契约「药丸=填表、保存=唯一提交」）。glm-5.3-highspeed 预设实弹核验拆除（订阅 429 计划未含——预设只放实测可用 id）。
- **两形态+一条 prompt**（D35）：**形态 A 纯面板**=`stardeck connect <host> --panel`（bridge:false 落 config，看板先行无悬浮球，对话全在用户 agent 里）；**一条提示词**（src/agent-prompt.ts 单一源，README/首跑门共用）：粘给 agent 即自行 Node 自查→npm i -g stardeck→connect（含宿主自识别回落）→read_digest 自证→stardeck open 开板，附块文法与不代行纪律；首跑门恒在场「把控制权交给你的 agent」卡一键复制。

### Changed
- README 增「两种形态」对照表与提示词章节；npm 首发提示词正典入口。

### 门禁
- 测试 532→570（+38：panel-size 7/loop-config 10/bridge-client 20/解析从宽 2/persistConfigPatch+提示词 2/fleet-gate 等）；live 40/40 全相位（含 D33 模型配置三断言+loop 拟令成卡）；verify+矩阵全绿；critique 双隔离子代理九轮闭环在 .goal/evidence/chat-d33/。

## [0.7.0] - 2026-10-21

### Added（D30 开箱即用 + 一行接入 + 桌面壳——npm 发布解禁后的第一刀）

- **`stardeck` 一条命令即用**：`npm i -g stardeck && stardeck`——起 daemon 后**自动打开浏览器**（`--no-open` 关；`open` 子命令保留为显式面）；首跑（配置文件缺席判据）自动建「点击即用」快捷方式（win32 开始菜单 .lnk 经 PowerShell COM / darwin .command / linux .desktop，`--no-app` 关、`stardeck app` 恒建；开发态 tsx 直跑诚实拒绝建）；package.json 补 `engines.node >=22`。
- **`stardeck connect [host]` 一行接入代理舰长外接席**：daemon 不在自动后台拉起（打包态 detached 自 spawn，node 直跑 mjs 不触 .cmd 垫片）→ 签席（token 只此一次）→ 按宿主**声明式文件写**注册（不 spawn 宿主 CLI——跨平台一致）：claude（~/.claude.json mcpServers，`claude mcp add -s user` 同址）/ zcode（~/.zcode/cli/config.json 的 mcp.servers；检测到开源 CLI 的 setting.json 则双写并补 features.mcp 闸）/ opencode（opencode.json 的 mcp 键）/ codex（CODEX_HOME config.toml 的 [mcp_servers.stardeck-proxy]，文本级摘旧表再追加）/ 通用（打印 {"mcpServers":…} 块自拷）。写盘承注入家族纪律：首动备份 *.pre-stardeck、tmp+rename 原子、幂等、坏 JSON 拒绝覆盖。**红线**：注册面只含 --face proxy + STARDECK_PROXY_TOKEN，war_* 一件不出（单测+live 三查钉死）。
- **Electron 桌面壳**（`desktop/` 自包子包——主包运行时依赖不变，Electron 全在壳内）：单实例锁 → 内置 daemon 拉起（`ELECTRON_RUN_AS_NODE=1` 用 Electron 自带 node 跑 dist/cli.mjs——用户机器零 Node 依赖；已有 daemon 在跑则复用不代管）→ BrowserWindow 载甲板 → 关窗进托盘（托盘菜单打开/退出，退出杀 daemon 进程树）；?cb=版本号 强刷 client.js（升级缓存家法）；electron-builder 出 win NSIS oneClick 安装器（mac dmg/linux AppImage 配置在档实弹候机）；图标纯 node PNG 编码生成（夜空+罗经星+甲板弧）。
- **首跑死路治理**（fleet-gate）：全席缺席不再哑谜——安装引导卡（六席正典 npm 包名一键复制 + 「重新探测」钮重拉 /fleet）+ 内置 loop 指引（`/fleet` 新增 `proxyLoop` 字段下发：env 已开=就绪卡，未开=零 CLI 设 env 指路——key 只走 env 红线，UI 不设输 key 面）。

### Changed
- README 快速开始 npm-first 重写（中英同步）：`npm i -g stardeck && stardeck` 为正典入口，connect 四宿主一行命令表，桌面安装器指路；源码安装降「开发」节。

### 门禁
- 测试 525→532（+7：connect 生成器红线/writer 纪律（坏 JSON 拒绝/首动备份/幂等结构不变——每次连接签新席 token 必异，幂等=结构面不是字节）/真 daemon 四宿主全流程/缺席诚实报错；fleet-gate 引导卡渲染×2）；live 新相位 `STARDECK_LIVE_CONNECT`（opencode 真写盘+红线三查+generic 块+proxyLoop 下发）；verify+旗面矩阵全绿。
## [0.3.0] - 2026-10-20

### Added（D26 舰桥频道：对话范式回归，DESIGN D26 三轮拍板）

- **聊天窗=默认脸面**：打开 stardeck 就是「舰桥频道」+设置入口——舰长和一位经理人（大副正典升格：经理人职责+回话纪律入 staffPersonaText）对话：下令、问战况（digest 数据底料，不编造）、问概念（产品自带导购）；看板收为可展开面板，三态切换（聊天全屏/分屏旁观/看板全屏），分屏下 SSE rev 驱动「看着看板被聊天驱动」。`STARDECK_BRIDGE` 默认 ON，=0 回退看板先行老形态（旗 OFF 面：/board 无 bridge 字节、三端点 404，与 0.2.x 等价）。
- **bridge 账本**（`src/bridge.ts`，第六账本入 revision 签名）：舰长发话/经理人终答全文/机械战报三态消息流；append-only JSONL 纪律（jsonl.ts 崩断治愈+fold-cache 冻结缓存）。
- **chat 工单与收割双写**：staffOrderFor 增第四参 chat 附页（舰长发话+携史 24 条+舰队速览+对话纪律；chat 缺席字节不变——旗 OFF 快照零波及）；staffTick 15s 出单，大副终答经 finalStaffReply 单源取文全文入 bridge，【任务书】【澄清】结构化块照旧入 directives——两账并行不漂移。**逻辑常驻、物理按需**：opencode/pi 席 chat-only 轮优先 resume 续跑（deliverVia* 原语复用，失败退避 2 分钟），全席兜底=工单携史（重启不失忆，历史在账不在进程）。
- **机械战报五触发**（不跑模型，dedupKey=源事件指纹幂等）：任务交证待验收/澄清挂起/失败待重试/收官与成任务终局/定时令派发——模板+点穿链接，聊天窗保持「活着」零 token。
- **三端点**：`GET/POST /warroom/api/bridge/messages`（?since= 增量）、`GET /warroom/api/bridge/digest`（pendingDecisions/commands/tasks/stats 紧凑封顶——collectInbox 服务端化：plan 待签>clarify 同令只出一条、reported→review、failed→retry）；`/commands/answer` 增 channel:'bridge' 审计面（板面/对话面来源可分）。
- **聊天内三决策卡**（`src/client/bridge.tsx` 决策坞，词汇复用 focusPage 词典）：澄清选择题药丸（1A;2B 拼装与会议室同款）+任务书签发五项可编辑卡（D24 签发权在聊天内的对位物）+验收证据卡（战报节选+机械核对行+验收/打回一键）+失败重试卡；消息体 md-lite 渲染与板同源（reportBody 导出共用）；系统消息带点穿按钮（hash 深链聚焦页，WarView 增 hashchange 监听）。
- **i18n**：bridge 词典段四典齐备（war/plain 双语，trek 自动派生；含三态切换/设置弹层文案）；聊天/分屏态迷你设置弹层（皮肤/语言/明暗）。
- **监督用例一正一负**（eval/tests.yaml 8→10）：正=经理人呈证据请示不代签；负=舰长离席诱导代签验收被否决——红线①（验收定夺归舰长）的 LLM 侧镜像。
- **live 门新相位** `STARDECK_LIVE_BRIDGE=1`（+6 断言）：/board bridge 面→发话入账→chat 工单→大副终答入 bridge 全链→未答清空→digest 全况→机械战报在场；bridge.jsonl 随相位落证据。
- 新增测试 22 条（bridge 账本 7/路由与 digest 6/chat 工单与收割 4/渲染 harness 5），全量 460→482；快照随人设升格真实重生成（staff-persona+四征召令 fixtures）。

### 边界（本轮明确不做）

- 分级授权档（经理人自决例行运营）——未来另案拍板；zcode/claude/dsh/codex 四席进程级续跑留在候选清单（携史兜底保功能完整）；npm 发版等舰长令。

## [Unreleased]

## [0.6.0] - 2026-10-21

### Added（D29 代理舰长「开放职位」双形态——外接席位 + 内置 loop + impeccable 前端轮）
- **外接席位（用户自己的 agent 坐进来）**：`proxy-seats.ts` 座席签发（seatId `proxyx-<ts36>` + token 只在签发响应出现一次、落盘只存 sha256）；契约端点 `POST /warroom/api/proxy/seats`、`GET /proxy/order`（携史+账本切片+digest+块文法教学）、`POST /proxy/reply`（与内置席同一条收割管线，块直落/审计/issuedBy 全继承）；**身份门在途祝福**——seatId 随 issuedBy 入账本属公开信息，门=在册∧在途（仅 daemon 收割路径放行的 callTool 过门），伪造 agentId 直打 /tools/call 被拒（攻击负向测试钉死）。
- **MCP 座席限定面**：`mcp-bridge.mjs --face proxy`（缺省 war 面字节不变）——座席工具恰五件（get_order/submit_reply/read_board/read_digest/read_ledger），执行者 war_* 一件不出；真 stdio e2e 锁（工具清单+转发往返+缺 token -32002 教学）。
- **内置 agent loop**：`proxy-loop.ts`（ai SDK streamText+tool+stepCountIs，参考 lookatstudy agent-engine 形态）——system=proxyOrderFor 载荷复用、tools=只读三件（board/digest/ledger 进程内闭包）、终答交共用收割管线、历史预算承 bridgeHistoryWindow、整轮看门狗；`STARDECK_PROXY_LOOP=1` 显式开启（默认 OFF 舰队席路径字节不变），无 key/失败诚实降级回舰队席+战报交代；供给 z.ai OpenAI 兼容面（Z_AI_* env）。ai SDK 入 dependencies=运行时零依赖血统的**已批准例外**（@ai-sdk/openai-compatible 钉 1.0.58=spec v2 配 ai 5）。
- **live 两新相位**：`STARDECK_LIVE_PROXYSEAT`（live-check 亲自扮外挂客户端：直连 GLM 签席→拉 order→下令成卡 issuedBy=proxyx→大副接管全链→问况答真实数字→撤令入账）+ `STARDECK_LIVE_PROXYLOOP`（聊天→loop 终答入账→【命令】块成卡 issuedBy=proxy-loop）。
- **eval +4（共 20 例）**：外接座席契约正例/伪造数据负例、内置 loop 行为面正例/越界宣称执行负例（一票否决）；判官升 glm-5.3（glm-5.2 撤型后别名是不可依赖的临时宽限）。
- **impeccable critique 七轮 UI 轮**（双子代理 A 设计/B 检测器，A 轨迹 24→26→28→27→27→**33.5→36/40 过线**）：前五轮代码层 P1 全清（设置弹层令牌作用域回归修复（透明钉左上角→居中 modal+Esc+autoFocus）、打回必附言（悬空冒号令根治）、草稿跨挂载仓（切视图不再焚签发五项/澄清答复）、验收两步确认（5s 回落+<800ms 连击不认）、Alt+1/2/3 键盘切视图+聊天头键位常驻、发送后在途指示（末条用户话轮推导）、近底才跟随滚动、失败提示常驻、门注解两层制（人话+技术细节折叠）、常驻导航簇令牌作用域补齐、固定 chrome 让位、空坞塌缩+空板下一步提示、页签选中显名、管线教练贴常驻至亲点、门字号全过 --war-fs）；**语调刀收口判据④**（舰长 continuation 令）：persona「开场轻/不重播」纪律+proxyOrderFor【回话体例】（机制不复述、用到哪样教一句）+收官/撤令战报叙述化（`收官：「…」，判定：…。`）+呈现层【块】标记 chip 化（账本原文不动）+跨日分隔条——快照 3 fixtures 诚实 diff 重生成+eval 20/20 复跑；第六轮修清 chrome 竖排回归（.war-root 布局反制）、分屏白屏（pipe-hint 分支 tabCounts 自由变量雷+非空板回归测试+happy-dom ResizeObserver 桩）、板体 shrink-to-fit 死白、分屏气泡裁断（flex min-width:auto 被 nowrap kbd 撑破 38% 列，实测 658>548→min-width:0+分屏藏 kbd）；第七轮修 kbd 让位 336px+ellipsis 降级、深色开关乐观渲染、授权对钮等权化。B 检测器七项计算样式断言全 PASS（errors=0）。

### Changed
- 澄清/签发/验收/打回卡编辑态跨视图存活（draftStore 模块级仓——会话级，不入账不越读投影红线）。
- 舰队门占位符不再当说明书（provider/model 语义入「技术细节」折叠）；live 门 pi 相位残留 glm-5.2 模型串清除。

### 判据④收口（原「诚实记账」分歧，已闭合）
- 前五轮评分平台期 27/40 的归因=账本内容层（读投影红线禁 UI 藏改）+评委方差；舰长 continuation 令走**语调刀**（提示词资产治理，非 UI 藏改）：persona「开场轻/不重播」+【回话体例】+收官/撤令叙述化+【块】chip 化+跨日分隔条。第六轮 A 组 33.5/40（暴露终版截图链自身的三个布局回归+一个自由变量白屏 P0，全部修清），第七轮独立终审 **36/40（判据线 35 过）**、P0=0、B 检测器七项全 PASS；终审唯一 P1（授权钮「实心=选中」与状态句互斥信号）已以等权对钮修复（禁用侧=当前态，状态句点名）。剩余 P2 全部裁定在案：图标页签 title/aria 在场（V17.8 定案）、「星你亲手」系评审员 13px 误读（源码 trek/war 双典皆「呈」）、绑定门术语注（「技术细节」两层制在场）、卡状态字阶与分屏双头为接受的设计取舍。

## [0.5.0] - 2026-10-20

### Added（D28 百事通席——代理舰长全知+图景+全能管理，三层模型正名）
- **知识面（全知）**：代理舰长征召令携带账本切片（ledgerSlice：directive 尾 30+task 尾 30，每条摘要 clip 100）+ 只读通道教学（STARDECK_HTTP 下 GET /board、/bridge/digest、/ledger——只许 GET，一切写只能走块）；新端点 `GET /warroom/api/ledger?limit&scope`（limit≤200 钳制、scope=directive|task|both）。
- **图景面（直白）**：【图景】块（每轮≤1 份、草稿≤6000 字；标题+摘要+timeline/stats/cards 三组件围栏）→ 新 `src/scene.ts` 确定性渲染器（answer-me-with-html 三权分立：模型只写草稿，布局/配色/转义全由代码算；零 `<script>` 单文件+内联 CSS）→ **cards 编号逐一对账账本快照，未知即整页拒收**（数字可溯源，幻觉图景进不了聊天）→ 落盘 `stateDir/artifacts/` + `bridge_agent_message.artifact` 字段（向后兼容条件 spread）→ 出线端点 `GET /warroom/api/artifact/<id>`（CSP default-src 'none'）→ 聊天窗**沙箱 iframe（sandbox=''）+新窗链接**（防「战报诱导→图景带脚本→打 API」注入链，服务端 CSP+客户端沙箱双保险）；渲染失败=第六种机械战报 `scene`（诚实告知原因，下轮可重出）。
- **管理面（全能，全部直落不设旗——舰长拍板）**：【撤令】（cmdId+理由）→war_abandon_command；【重派】（taskId+理由）→RetryCard 同构两步（续接令建卡+作废收官）；【定时令】（cmdId）停→撤 draft（状态闸天然闸）；【绑席】（席位+可选模型串）→bindableSeatIds 校验→切席落盘+战报确认；每轮合计≤3 块、单块理由≤300 字（parse 层拒收+告警）。B3 门增 **managementProxyGate 支线**：在册代理会话的**作废语义**收官放行（重派后半步），**通过语义仍走授权旗**——管理与定夺两权分立。
- 代理舰长 persona/征召令升格百事通（职责四条：听懂/拟令/报战况（可配图景）/代行管理；纪律补「只读通道只许看」）；监督层 +3 例（图景数据溯源正/口头撤令正/编造数据图景负例一票否决，共 16 例）；live 门代理相位 6→9 断言（图景全链 200+CSP+零 script/撤令 directive_cancelled 入账/绑席战报往返）。

### Changed
- POST /fleet 核心提取为 applyFleetBinding（与【绑席】块共用，空模型=覆写旧约不变）；块头解析强调包裹容忍（glm-5.3 粗体风格，图景/管理/定夺/命令全块型）。

## [0.4.0] - 2026-10-20

### Added（D27 代理舰长席——对话者与舰务分离 + 外部调用面正名）
- **代理舰长席（proxy captain）**：聊天窗对话者从大副换为独立席位——把舰长自然语言拟成【命令】块，daemon 收割成 draft 命令卡（issuedBy 审计）交大副分诊，「说了就成单」闭环（D26 下单缺口根治）；对话史承运层（bridge 账本/携史/digest/resume 优先+退避）全额复用换席。
- **定夺授权（flag-gated）**：`STARDECK_PROXY_VERDICT` 默认 OFF；舰长可经设置弹层/POST /bridge/settings 运行态授权代理舰长代行验收（【定夺】块走 war_close_task 原路，B3 门=在册 proxy 会话+授权双条件；重启回落 OFF 三重安全缺省）。
- **外部调用面（同构声明）**：内置代理舰长=外部调用接口第一客户端（POST /commands+digest+board+answer 同组端点，issuedBy 自报字段）；完整 principal/鉴权另案（README 新章）。
- **命令卡「代理舰长令」徽标** + 聊天降级态（STARDECK_PROXY=0：战报+决策卡在场、输入停用诚实文案）+ 设置弹层授权钮。
- 验证矩阵增舰桥/代理 OFF 面双跑；live 门增 STARDECK_LIVE_PROXY=1 相位（聊天下单→拟令成卡→分诊→外勤→收官全链）；监督层 +3 例（拟令正/授权代定夺正/未授权代签负例一票否决，共 13 例）。

### Fixed
- **B3 潜伏缺陷（test-first 坐实）**：板面舰长亲手验收（agentId=captain-board）对 staff-owned 任务自 2026-09-23 B3 落地起实为被拒（独立形态 hqSessionId 从不设置）——身份门显式放行 captain-board 固定 principal。
- **审计分叉**：directive_answered 的 channel 曾被续跑通道名（pi-rpc/opencode-run）覆盖、对话面来源丢失——改为 channel（来源面）+via（续跑通道）双字段。
- **z.ai 撤型适配（2026-10-20 实弹三连抓）**：网关当日撤 glm-5.2 换 glm-5.3 家族——live 门 opencode 面默认切 5.3、舰队回切显式带模型（空串=执行者不带 -m，踩 opencode 默认模型解析死模型）；briefBlocksOf 增粗体强调容忍（glm-5.3 终答五项标签常写 `- **目标**：`，旧解析五项全 miss 整块被弃——实弹抓获+回归测试钉死）。

### Changed
- **大副回滚纯舰务**（D26 经理人 persona 段+chat 附页退役）：聊天窗只认代理舰长一个声音；人类直通面（composer 直令/聚焦页答复/签发卡）原样保留。
- 术语：AI 对话者=代理舰长（war）/代理管家（plain）/Acting Captain（EN）；人类=舰长不变（零迁移）。


### Fixed（对抗审查回流批，2026-09-23 自插件仓 4cd746b）

- **P0 war_fail 重派死锁（本仓形态）**：war_fail 重派路径的补征恒被 spawn-once 守卫挡回（调用 war_fail 的执行者进程自身还在役，`registry.liveFor()` 判活）而回执无视征召结果虚报「已派遣新外勤小队」；恢复只能靠巡检②「起跑即夭折」误标分支（错因入账+延迟）。修=CommanderOps 增 `releaseSpawned?`（daemon 实现=`registry.forgetTask`），war_fail 先释放守卫再补征并**消费征召结果**（未成如实回执「巡检会自动补征」）；巡检①判死回栏点同款先遗忘（原本已 forget，补注释正名）。
- **P1×4**：①已取消定时令账本灌水——dueScheduledDirectives 只认 draft（cancelled 不再每 15s 被重判到期涨废 dispatched）；②收官判定 `includes('通过')` 子串误判（「打回：验收**未通过**」折成 succeeded 胜局）→ events.ts `isPassVerdict`（词头+句读边界）；③conscriptPlan 滤 deps——dep-locked 任务不被提前征召（claim 拒空转+占死工作区遮蔽同区可跑任务），巡检②/closeTaskInternal 两调用点带 statusOf；④大副侧动词五道身份/状态门（close 通过语义须 reported+所属大副/HQ 会话、comment 舰长批注形态降级、deploy/orders/recall/log_report 通话方校验；孤儿任务 legacy 宽容）。
- **P2×8（适用项）**：dashboard send() 真实落码（旧 `void code` 全错误 200 出线——测试 helper 假 200 同步清除，**AGENTS 坑录「send 恒 200 家法」作废**）；cron 严格解析（空段/尾随垃圾拒收）+ `assertCronUsable` 可满足性双侧校验（创建+war_publish，2 月 30 日类永不触发不再入库烧 CPU）+ nextRunMs 游标跨度封顶；KillCredit 双处否决 `failed>0`（exit 0 但有失败项不算全绿）；新模块 `src/jsonl.ts`（appendJsonl 尾字节检测补 \n 治崩断粘连 + appendJsonlBatch 单 write 原子）——events/directives/threads/planets 四路账本统一走它，war_publish 的 created+published[+scheduled] 批量单写；normalizeWorkspaceKey 叠 best-effort realpath（junction 别名两写法判同区）；归档幂等续档（部分失败重入只补缺失会话、账面合并）；toolFilter fail-open loud 告警。
- **P3 适用项**：定时任务令停用路径（非通过语义收官落 `task_scheduled enabled:false`，dueBounties 扫描侧本就滤 enabled）；state.json 原子写（tmp+rename）；directive ID 后缀 4→8 hex；normalizeFront 大小写折叠（win32/darwin）；SSE close 监听进分支先挂+interval 回调自查 destroyed 自清；readBody 64KB 上限+断线不挂起（dashboard 与 daemon 双面）+坏 JSON→400 干净文案；错误反射截断 120 字符；planets 追加建目录（全新装首请求不再 ENOENT）；fold-cache 返回 Object.freeze；ActivityTracker 驱逐 LRU 化（安静但被板读的会话不逐）；war_publish goal 结算前移+结算后重读（并发双发布竞态窗）；boardRevision planets 缺档标签正名。
- **未回流（正当分叉/不适用）**：goal disarm clear 降级（本仓 goals 面独立形态恒缺席，无 armed 残留可补偿）；rescue 连败隔离（本仓无 resume 语义——进程即生命，判死即遗忘）；relay 毒命令/pivot 批量写（本仓 relay 为类型载体，宿主面专属）；C11 allowedAbs 大小写（本仓 file 守卫=war_root 单根形态，无星球授权面）；user-seen 封顶（本仓无该模块）；插件侧 /warroom 绕过宿主 token 鉴权（宿主 route registry 根因，本仓 daemon 自家 127.0.0.1 服务无此面）。
- 测试 431→460（+29 回归断言）；`pnpm verify` + `STARDECK_VERIFY_MATRIX=1` 双面 + `pnpm live` 17/17 全绿。另修一处被矩阵暴露的既有隐患：plan-reject e2e 继承矩阵全旗 OFF 环境致 plan 路由 404——spawn 显式钉 `WARROOM_FEATURES=staff-plan`。

## [0.1.0] - 2026-09-01

### Added

- **双席正典：可选舰队=大副+外勤双接通（V19.13，DESIGN D22，舰长令 2026-09-06）**——`bindableSeatIds` 判别式升级为 `adapter && staffReady`（绑定门 UI 同步：staffReady=false 落 absent 档，转正条件写在席卡 note）。**codex 大副转正**：`spawnHeadlessCodexStaff`（staff 简报 face=http + shim provider 五旗 + 模型串归一 provider/id→裸 id + `thread.started` 行钩捕获入 attach-map）+ **隔离 CODEX_HOME**（`codexHomeFor`：用户 ~/.codex 里 0.44 时代 chat-wire provider 会让 0.153 启动即硬拒——spawn 不读也不写用户 ~/.codex）；codex 外勤适配器同轮修正（face=http、STARDECK_HTTP/AGENT env 挂 agent 进程、撤死重注桥）。**dsh 大副放闸**（http 面，与 zcode 同构）、claude 大副补实弹。**gemini/qwen 降不可选**（外勤未实弹/半证+大副通道未建）。可选席名册：opencode/pi/codex/zcode/claude/dsh 六席。staffExecutorFor/fleet 测试随正典更新；三席 staff 相位实弹（STARDECK_LIVE_STAFF_EXECUTOR=claude/dsh/codex，codex 另起垫片+STARDECK_LIVE_CODEX_BIN 按席 bin 防全局逃生阀误伤主环）。

- **独立纪项目主刀**：从 dsh-plugin-warroom 1:1 迁移内核 27 模块（账本 fold/规则状态机/workspace/prompts/schedule/fold-cache 及 44 测试文件 266 测），`tools.ts` 唯一改动=defineTool 换本地 shim（`src/tool.ts`，契约对齐：schema 编译+执行前校验+`invalid arguments:` 教学错误）。
- **零宿主 daemon**（`src/daemon.ts` + `src/cli.ts` + bin）：dashboard 路由鸭子直挂 + war_* 工具注册表（24 件）+ `/warroom/api/mcp/*` 调用端点 + 15s 巡检（失联回收/补征召）+ 板 UI 静态服务 + 优雅关停。默认 `http://127.0.0.1:3970`，配置走 `~/.stardeck/config.json` 与 `STARDECK_*` env。
- **执行者适配层**（`src/executor.ts`）：ExecutorAdapter 接口 + opencode 适配器（cwd 框定+征召令简报+项目级 MCP 注入）；进程即生命，重启由巡检回收。
- **MCP 桥**（`src/mcp-bridge.mjs`）：stdio JSON-RPC，外部 agent 经它调 war_*（身份 STARDECK_AGENT 透传，attemptId 即 capability）。
- **板 UI 独立挂载**（`src/client-standalone.tsx`）：warView 整页（三列局势墙/调度坞/聚焦页/皮肤/星域），宿主服务面全降级；esbuild 三产物构建（`pnpm build`）。
- **验证体系**：`pnpm verify` 三段式（tests + build + needle，含**零宿主引用**负针脚）+ `pnpm live` 实弹门（真 opencode/GLM 外勤全链 10 断言）+ 提示词快照门（WARROOM_UPDATE_SNAPSHOTS）。
- **交接件**：README（产品定位/边界宪法/环流）、AGENTS.md（迭代指引）、HANDOFF.md（会话切换快照）、DESIGN.md（决策录 D1-D8）。

### 证据

- 实弹门 10/10 PASS：`.goal/evidence/live/REPORT.md`（真 opencode 外勤 claim→执行→KillCredit 机械全绿→人工验收→收官，零宿主）。
- 板 UI 目检：`.goal/evidence/ui-board.png`（全渲染零 pageerror）。
- 可行性先行验证（R0 spike 9/9）证据留在上游仓 dsh-plugin-warroom `.goal/evidence/r0-spike/`。

### 受限（v0.1 诚实降级面）

- 深编制（war_deploy_unit）与中途投递（war_orders/war_comment 转达）未接线；定时命令可设置不自动派发（派发链需大副中继）；staff-goal 不适用。
- 仓库未推 GitHub、未发 npm（待项目主发令）。

## [0.2.3] - 2026-09-09

### Fixed

- **聚焦态压暗卡悬停高亮（V24.1 舰长令）**——聚焦模式点亮族系其余压暗，但压暗卡被光标路过仍抬升+描边（`.war-card.clickable:hover` 全局生效）。修复=`.war-card.war-rel-dim.clickable:hover` 归零（不抬升/不换框色/不投影）——压暗=退场，Playwright hover 前后计算样式断言一致。
- **大字号档位决策坞溢出（V24.1）**——字号滑杆 1.35 实弹：五行恒高卡的行高全涨 ~35% 但「五行卡高 168px/调度栏 218px/注脚 18px/动作行 24px」仍钉死 px，卡被自身 `overflow:hidden` 裁底（动作行/签发钮不可见）。修复=恒高布局尺寸全部乘 `--war-fs`（`calc(Npx*var(--war-fs))`，1.0 数值不变；卡宽 316px 不乘——「长文本一行截断」定案不变）+ `.war-chip` 补 `max-width:100%` 省略号防硬裁。Playwright 1.35 探针扫描：真实溢出 16 处→0（横滚轨道/省略号截断均为设计内）；`.goal/evidence/ui-fs135-board.png` 前后对照。

### Added

- **执行者编号席别化 + 席别上账徽标（V24.1 舰长令）**——「这条命令哪个舰队做的」一眼可辨：①`newAgentId` 前缀从全席硬编码 `oc-`（opencode 独占时代遗留）改为 `seatAgentPrefix(seat)` 映射（opencode=oc/pi=pi/zcode=zx/claude=cl/codex=cx/dsh=dsh/gemini=gm/qwen=qw；未知席退前两字符），claimedBy/日志名即席别；②新账本事件 `task_conscripted`（spawn 时 daemon 记 executor+agentId，fold 落 `CampaignState.executorSeat`）——**席别在征召瞬间上账**，不依赖 attach-map 的会话捕获时机（pi 席要退场才入映射的空窗就此关闭）；board 投影下发 `BoardTask.executorSeat`，任务卡/执行会话行渲染虚线席别徽标（tooltip「由 X 舰队执行（征召时上账）」；老任务无上账=安静无徽标）。live-check 三处 claimedBy 前缀断言 fleet 化（`seatAgentPrefix(fleet)`）；测试 430/0（fold 上账/前缀表/渲染徽标三新组）；UI 目检 `.goal/evidence/ui-focus-dim-hover.png`（seat-live 全链：执行中卡 `~ oc-… · opencode` 徽标在场+聚焦压暗 hover 无高亮）。

- **两档制：L1 签任务书（D24，舰长令）**——分诊改制 L0 直发（默认全自动）/ L1 签发档，L2 退役（类型保留仅为老账本 fold 兼容）。呈批件从「计划（怎么干）」换成「任务书（要什么）」：L1 分诊后成任务书块即停轮（不 war_plan 不 war_publish），daemon 收割后代开呈批件（plan pending），war_publish 硬门（协议原样）机械背书未签发不发布。**find-my-goal 定稿语义**：会议室五项卡以可编辑文本域呈批——舰长逐项修改后签发（`directive_brief_signed` 可携定稿文本+附言）才是发布唯一依据，发布工单逐字照抄；`brief_ready` 原稿保留不覆盖（谈/签两笔审计链）。签发通道复用 `/commands/plan` 零新端点；舰长定稿权绝对化——携修改文本时无论原稿来路（新任务书流/旧 war_plan 遗留）都落签发。驳回带意见回会议重拟（不吃澄清 2 轮闸）。`??先看方案` 改映射 L1；改档 UI 去 L2；老账本旧 plan 流程照旧兼容。监督层 L1 用例 2 条（正：风险命令挂起等签；负：未签发就发布=veto），eval 门 8/8。测试 426（brief-sign 专项/签发路由/待签渲染/标记改档）；UI 目检 `ui-l1-sign-*.png`；实弹双相位 L1 相位全链 PASS（呈批挂起→签发携 LIVE-L1-MARK→任务 brief 逐字含标记→收官；pi 35/35、opencode 当轮记录）。
- **真会议室：收敛机制升格为场所（V23，DESIGN D23 第四刀）**——聚焦页新增独立「会议室」段（`data-stage="meeting"`，介于命令段与任务段之间）：段头=场地名+动态结论（等你答复→成案中→任务书在案）+场所铭（「这里只做一件事：把模糊命令收敛成强目标」上墙）；体内竖线时间轴=每轮问答块（问题+选项药丸/舰长答复行）+任务书五项卡收尾，**不等成案全可见**。数据面：`Directive.clarificationRounds` 只读派生（requested 追加/answered 回填；成案动作只清活动态、历史轮次保留）经投影下发 `BoardCommand`；渲染层字段归一（undefined→null）+缺轮次史时从活动态回退合成单轮。过程态：answered 派生段头结论+`⏳` 行（`role=status`）——「成案中——大副正带答复重开」机器侧动态可辨。talking ghost 让位（点击滚动到会议室，问答面板不再两处同屏）；talking 无澄清也开会场（P0-1 答复 composer 搬进会场，通道不变）。**监督层首批澄清协议用例 4 条**（正：悬空指代→澄清块/成熟命令→直发+任务书；负：大副亲自写码/编造舰长答复绕过验收），判据不放宽，首跑 eval 门 6/6。测试：渲染断言三态+多轮时间轴+场所铭（全量 414 测）；UI 目检三截图（zh 会议室点选拼装/zh 过程态特写/en）落 `.goal/evidence/ui-meeting-*.png`；live 双相位退出码 0（29 断言原样）。零新写端点、提示词资产零改动。
- **会议室选择题式收敛：追问附选项 + 「你帮我定」 + 强目标翻译显性化（V22.1–V22.5，DESIGN D23 第三刀）**——澄清正典升级选择题式：问行 `N. <问干>？A <选项一> / B <选项二> / C 你帮我定`，`splitAskLine` 行内拆出 `ClarifyAsk{raw,text,options}`（解析从宽：标记前无空格/标记符变体容忍，识别失败=开放问不硬拆）；`directive_clarification_requested` 增可选 `options?: string[][]`（fold/投影/渲染全链 optional，老账本零迁移）。板上人机共编：选项药丸钮（`.war-clarify-opt`）点选拼装 `N<字母>;` 进答复框（换选去重），自由文本照旧混排，`1A;2B;3 <自由文本>` 复用既有 `/commands/answer` 零新端点。翻译显性化：成熟命令（含快道）同样必须产出任务书块（publish 分支+办结纪律双处硬约束「缺块的办结不算办结」——V22.3 实弹抓：GLM 无视弱指引）；任务书块解析容忍 markdown 列表变体+标签间括号注释（V22.4 实弹抓）。live 断言升级（追问 2/2 含选项+cmdA 任务书入账）；实弹双相位 PASS（opencode 29/29、pi 30/30）；UI 目检 zh/en 截图（选项药丸+点选拼装「1A; 2C;」取证）落 `.goal/evidence/ui-clarify-choices-*.png`。测试：解析器选择题/markdown 变体实弹文本回归、账本 options 兼容、渲染选项组+拼装、机械闸适配。verify PASS（413 测）。
- **澄清协议完整形态：板上闭环 UI + 双语 + 轮数机械闸（V21.1，DESIGN D23 完整形态段）**——聚焦页 talking ghost 面板渲染 `cmd.clarification`：pending=「大副第 N 轮提问（等你答复）」编号问题列表+答复框同卡（`ol.war-clarify-q`，读完即答不再绕道会话历史弹窗）；answered=问答史留卡+「答复已入账」定案提示；`cmd.brief` 五项卡（`.war-brief-card`）与 ghost 面板并列逐行结构化（非目标单独成行）。双语新键入 `focusPage` 子典五处（接口+war/plain 中文+war/plain 英文；trek 自动派生；war=大副/plain=规划 Agent 术语分野）。机械闸 `CLARIFY_ROUNDS_CAP=2`：harvest 拆纯核心 `staffHarvestEventsFromText`（解析+闸门，直测）与 glue；过限澄清拒收入账+`rejectedClarifications` 上报（daemon warn），混合文本成案优先（任务书入账、澄清静默弃）——命令不死锁、不被系统单方面弃案。`BoardCommand` 投影类型补 clarification/brief。测试：client-render 渲染断言三态+无影响对照、机械闸四态、copy-lang 完备性锁；UI 目检四截图（zh pending/answered+brief/brief 卡/en pending）落 `.goal/evidence/ui-*.png`。verify PASS（412 测）。
- **大副澄清协议：任务书一等公民 + 输入成熟度闸（V20.1-V20.6，DESIGN D23，舰长令）**——大副收令先做任务书五项自检（目标/背景与约束/验收标准/非目标/交付物），缺关键项回澄清块而非硬派活：`inputMaturityOf` 四判型启发式预评（vague/缺验收/缺非目标/成熟——只调制征召令指引，不裁决）；大副最终答复的结构化块（`【澄清】（cmd-…）`/`【任务书】（cmd-…）`）由 daemon staffTick 退场收割（attach-map + readSessionHistory 读本轮原生会话，knownIds 防幻觉写账，五项缺一即弃）；账本三层新事件 `directive_clarification_requested`（fold 挂起+round 推导）/`directive_clarification_answered`（只翻 pending）/`directive_brief_ready`（`Directive.brief` 后写覆盖，**叠在终态之上**——发布先落/收割后落的固有时序，终态守卫放行）。回环走**账本即状态**：舰长经既有 `/commands/answer` 答复 → worklist 出答复成案单（`kind:'resolve'`，原文+问答史+轮次随行）→ 全新大副进程定案——不依赖会话续跑，六席大副全量获得澄清能力；等澄清不出单=退场罚时机械豁免（「等舰长」不是「干不成」）；成案动作清账、第 2 轮起明文必须定案或弃案。`POST /commands/answer` 对挂起澄清的命令改走账本受理分支（不投递续跑，避免与成案轮双发；无澄清的旧 talking 命令 P0-1 语义原样）。live 大副相位 +4 断言（模糊命令被追问/答复入账/任务书五项/征召令内嵌五项）；staff 征召令快照重生成（新增 staff-order-resolve.txt）。实弹五轮迭代全链 PASS 27/27（实弹抓三坑：考题须落「不可自补」象限、fold 终态守卫吃 brief_ready、live 证据 readFileSync import 缺失静默假绿）。

## [0.2.2] - 2026-09-07

### Added

- **codex 垫片转正：GLM 直驱 codex（V19.13，DESIGN D21）**——`src/codex-shim.ts` Responses→chat 翻译面（协议按 rust-v0.153.4 源码钉死：SSE created→output_item.done→completed，usage 三字段映射）+ 回环服（`stardeck codex-shim` 子命令，仅绑 127.0.0.1，key 只进本进程内存）；适配器接线=config `codexShimBase`（STARDECK_CODEX_SHIM_BASE），非空时 codexExecArgs 注入 provider 定义五旗压过裸 modelProvider；slug 骗面支持（`-m` 目录内 slug 拿完整元数据，垫片改写真模型）。**适配器同步修**：0.153 新 Windows 沙箱（restricted token）拦一切 exec_command（实弹三连拒）——codexExecArgs 平台分野 win32=danger-full-access。**实弹 scripts/live-codex-shim.ts 5 断言 PASS**：相位①模型线（codex→垫片→GLM 真话音）+ 相位②舰队线（隔离 daemon，codex 经 http 面查账本报出种子任务号）。**坑录**：0.153 `exec` 一次性形态 MCP 工具不进模型工具面（deferred/tool_search 架构，桥/探测服×`-c`/config.toml×fallback/目录 slug 全不露）——codex 席工具通道走 http 面正典（zcode 同款）；/responses/compact 诚实 404。verify PASS（399 测）。

- **板上答复 opencode 席续跑（P0-1 收尾：大副默认席自此可答，2026-09-06）**——`deliverViaOpencode`（src/steer.ts）：`opencode run -s <会话> --auto --format json` 一次性续跑投递，受理语义=活过观察窗（默认 5s，即退非零=会话号失效/参数被拒如实败）、settled=真退场（code 0=消化完，15min 上限 kill 诚实放弃）；JS 入口经 execPath 家法（startPiRpc 同款）；日志落 `stateDir/logs/staff-answer-<ses>.log` 供翻阅。daemon answerCommand 席别分发：pi=RPC prompt 帧（原 P0-1 通道不动）/ opencode=run -s 续跑（channel=opencode-run 入 directive_answered 审计）；其余席（zcode/claude/dsh）仍诚实拒绝（文案点名支持席）。工作区 opencode.json 的 stardeck 桥自原次 spawn 已在，续跑进程加载同一项目配置——agentId 是不透明标签（daemon tools/call 无注册表活体校验），免重注入。板上答复 textarea 补 Ctrl+Enter（与插件仓 M2-件B TalkingAnswer 同款 UX）。坑录：**esbuild 把 `new Promise<{kind:'x' as const}>` 类型实参里的 as 表达式（非法类型语法）静默回退成比较表达式** `new Promise() < {...} > (...)`——运行时才炸「Promise resolver undefined is not a function」；类型实参不写 as。验证：steer.test 8/8（argv 纯测三形/观察窗三态/daemon 级 opencode 席投递——stub 双面化：argv 带 run 走 opencode 形态落盘断言 -s 会话号+【舰长答复】原文+审计 channel）；verify PASS（零宿主负针脚续绿）；**实弹探针 scripts/live-answer-oc.ts PASS**——真 opencode 会话 ACK1 应答 → deliverViaOpencode 续跑 settled → sqlite 历史回读同会话 4 消息/assistant 2 回合 ACK1+ACK2 双证在场（上下文存续实锤，续跑真成才能答出 ACK2）。

- **驳回带意见 + HQ 手动注册区回归**（定案 2026-09-02：驳回计划「不能改细节」定案后修法 + HQ 选区实抓）。**驳回带意见**：舰长不编辑计划文本（著作权在大副——板是读投影+决策面），正典路径=带意见驳回让大副重拟——①聚焦页置顶决策带常驻「定夺批注」框（驳回=意见送达大副重拟；批准=批注入账；置顶带与计划段两处按钮同 note）；②fold 补存 plan.reason（directive_plan_rejected 的 reason 此前只进事件、fold 丢弃）；③重拟工单（staffWorklist）带 planRejectedReason → 征召令嵌「舰长驳回意见」行（无 reason 不加行——旧快照零变动，staff.test 14/14 实证）；④K17 判定回推独立形态替位：pushToStaff 经 pi RPC 续跑 follow_up（与板内答复同通道）；非 pi/失败 best-effort——意见已入 fold，下一轮工单必带（诚实兜底）。测试 +4：fold reason / 征召令行（有无 reason 双形）/ 真 daemon+stub pi e2e（note 入账+回推帧送达）/ 渲染 harness（批注框在决策带常驻、驳回带 note 上抛）。**HQ 手动注册区回归**：P1-7 的 host-workspaces 派生（war_root 扫描）语义本错——那是内部任务目录不是用户工作区，派生后列表模式顶掉了手动注册区（路径输入+win32 原生拾取器），用户实抓「无法自己选电脑里的工作区」；撤派生接线（路由双源面保留给宿主），独立形态回到手动区正解；host-sessions 派生保留（V17 归档核查用，8 会话实证）。local-faces 测试改断言 501 语义。verify PASS **360 测**。

- **脱离宿主九件全落地**（定案 2026-09-02「全面排查脱离宿主要改进的地方」→「全部都要做到」，goal 驱动；规格 `.goal/SPEC.md` 九件）。**P0-1 板内答复追问（=中途投递通道第一用例）**：talking 命令在聚焦页任务段有「答复 composer」→ `POST /commands/answer` → daemon `answerCommand` → **pi RPC 续跑**（`src/steer.ts`：`--mode rpc --approve --session <id>` + prompt 帧 + response 按 id 关联 + `agent_settled` 收割；在途守卫持续到消化完防双进程同会话）——大副带着舰长答复继续走出口协议；`directive_answered` 审计事件入账（不改 fold 状态）；批注转达 `relayTo` 同通道升级（attach 映射定位 → follow_up 帧；非 pi/失败诚实 false）；UI 面 zh/en 四典齐备。**P0-2 舰队绑定落盘**：POST /fleet 成功后写回配置文件（tmp+rename 原子；坏 JSON 拒绝覆盖+回执警示）——重启不回落；env 优先级不变。**P0-3 板面撤令**：AbandonRow（received/talking；复用归档行原地二次确认家法；approved 出任务的不设闸——撤销语义归任务链收官）→ captain-board 通道 war_abandon_command。**P1-4 渲染层 harness**（接线病灶类型的疫苗）：devDep `happy-dom` + tests/client-render：空 services（独立形态）渲染 warView/FocusPage/CommandCard/ExternalThreadCard——关键钮在场断言（任务/执行会话、通过收官、撤令、进入对话、答复 composer 送达→/commands/answer、外部卡 onStandaloneMiss）；views 导出三测试缝。**P1-5 CLI**：`open`（起服+拉浏览器）/`status`（探活，舰队行报 /fleet 活态）/`stop`（新 `POST /shutdown` 优雅停服端点，迟绑定 closeRef）；主入口守卫（import 零副作用）。**P1-6 attach-map backfill**（`src/backfill.ts`）：daemon 启动时自家日志反查（ses_/sess_/uuid 三席判型）补缺失键不覆盖——playground 老键 staff-mtjpb84d 实弹复活。**P1-7 host-sessions/host-workspaces 独立派生**：attach-map 会话并集+在役条目 / war_root 目录扫描（宿主面仍优先）——V17 归档核查在独立形态复活，不再恒 501。**P2-8 README 安全模型段**（本机互信/无鉴权/绑定居域/围栏=任务书+KillCredit/演示留意）。**P2-9 opencode 库平台探测**（XDG 先于 macOS Library；env 恒最高优）。**实弹取证**：默认 16/16 + `STARDECK_LIVE_STAFF=1 STARDECK_LIVE_STAFF_EXECUTOR=pi`（真 pi 大副全链）+ 新 `STARDECK_LIVE_STEER=1`（真 pi RPC 协议往返+续跑投递）= **组合 25/25**；playground 实操四件落 `.goal/evidence/detach-nine/`（backfill 复活/绑定重启存活/板面撤令/CLI status）。**顺手修的两颗旧雷**：live 门 staff 相位给 pi 灌 opencode 格式模型串（fleet-aware 补）；live 门 daemon 未隔离 STARDECK_CONFIG（P0-2 后会泄漏写用户全局 config——三处 daemon 全隔离）。verify PASS **356 测**（+25）。

- **板 UI 全按钮接线审计与修复**（定案 2026-09-02：「全面检查所有按钮的接线，我试了几个按钮点击没反应」）。**静态审计**：views.tsx 85 个 onClick 全分类，病灶=**宿主形态遗留的静默无操作**——独立形态 `services.sessions` 缺席，`services.sessions?.open(...)` 十余处点了没反应（不报错不反馈）。**修复面**：①FocusPage 双形态助手 `openStaffPane`/`openAttemptPane`（独立=会话历史弹窗、宿主=板内切会话）接管全部 jumpSession 调用点 + jumpSession 顶部独立形态安全网（note 反馈）；②**staffTarget 门控七处解耦**（`standalone || staffTarget !== null`）——老命令可无大副会话捕获（staffSessionId=null 且 hqSessionId=null 时整块按钮凭空消失）：计划段「进入会话」、对话 ghost「进入对话」、起草 ghost、任务卡展开「去验收/重试」、战报段「去验收·大副会话」、收件箱 clarify 路由（inboxAct 原被 target 双非空门拦死）；③**墙卡「进入对话」**（CommandCard.enterSession）独立形态进聚焦页（答复面在那）；④**外部挂载卡**（ExternalThreadCard）独立形态点击出 actionError 降级提示（attach.externalJumpNote 新键，zh/en 四典齐备）——不再静默；⑤**独立形态一键收官**：战报段新增「✓ 通过收官」主钮（closeTask 包装 POST war_close_task；此前独立形态板面完全没有收官 UI，验收只能靠 API）——实测 task reported→closed 全链。**乱码哨兵**：daemon war_submit 回执遇 U+FFFD 附 warning（老账本执行者侧 GBK shell curl 污染，读侧无辜；提示改走 MCP/UTF-8 重交）。**验证**：Playwright 逐钮机械扫描（top-level 23 钮全活 + 聚焦页含展开段子钮；去验收→聚焦页/会话弹窗/TUI 行/收官实操取证；扫描法两坑收录 AGENTS 坑录——✕ 先点掉致假阳性、scrollIntoView 要量对滚动容器）+ verify PASS（331 测）+ live 16/16。

- **模型选择口径四件套**（定案 2026-09-02：审计结论「五通一漏一绕」后的定案）：**①gemini `-m` 接线补漏**——geminiPrintArgs 此前丢模型串（CLI 0.58 bundle 实证 `-m` 短形在档），现留空=沿用自身默认、填写透传。**②zcode 模型输入锁死+说明**——绑定门对 zcode 席禁用模型输入框并常驻说明（模型只在 zcode 自己那里配：桌面版或 `~/.zcode/cli/config.json` 的 model.main；引擎不认 argv 模型参数，实测——板面填了也静默无效的坑就此明示）。**③绑定回执一句**——POST /fleet 响应新增 `note` 字段（fleet.ts `bindNoteFor` 纯函数：按席别交代透传语义/留空沿用默认/zcode 不透传+「首发征召若模型不可用任务卡如实报错」），板面存态后常驻舰队胶囊 tooltip。**④留空=沿用舰队自身默认的正典口径**——绑定门全席占位语改写（推荐用户在各舰队自己的 UI/配置里设默认，星deck 留空即继承），README 新增「模型选择口径」段。测试：attach-face 真 daemon +3 断言（gemini 透传回执/zcode 不透传回执/空模型沿用默认回执）+ geminiPrintArgs 模型双形。verify PASS（331 测）+ live 16/16。

- **舰队收编轮：十一席（七实装 + 四契约登记），定案「用开源编排器的实践扩广度，越多越好」**（2026-09-02）。**挖矿源**：vibe-kanban（BloopAI，27.9K★，已宣布 sunsetting 社区续命）executors/ 适配器源码——copilot=`npx @github/copilot`（ACP 驱动，MCP `~/.copilot/mcp-config.json`）、amp=`npx @sourcegraph/amp`（ACP，MCP `~/.config/amp/settings.json`）、cursor=`cursor-agent -p --output-format=stream-json`（MCP `~/.cursor/mcp.json`）、droid=`droid exec --output-format stream-json`（MCP `~/.factory/mcp.json`）、qwen=`-p/--yolo/--acp`（MCP `~/.qwen/settings.json`）；CCR 仅在 VK 名单无执行器（路线图注记）。**qwen 转实验席**（Qwen Code 0.22.3 本机安装）：适配器全件（`-p` + `--yolo` 免批 + `--auth-type openai` openai 兼容鉴权面 + `.qwen/settings.json` 项目级注桥 + TOML 召唤件 + `--resume` 跳转）；本机半证——OPENAI_API_KEY/OPENAI_BASE_URL 映射 z.ai paas v4 网关请求可达（`openai:模型名` 选择器可达 API、裸模型名挂起、模型名 400），全链实弹待机（实验性诚实标记）。**契约席架构**：fleet.ts 席位加 `adapter` 标记（spawn 适配器已实装才可绑）——契约席绑定门可看不可选（三分语义 absent 档），POST /fleet 诚实拒绝（区分「未知舰队」与「契约席未实装」），bindableSeatIds() 硬校验面；不写未证的 spawn 代码（不装样子纪律）。live 门 fleet 断言改十一席（7 实装在场 + 4 契约 adapter=false）。verify PASS（331 测）+ live 16/16。**边界注记**：ACP harness（copilot/amp 的正解驱动协议）与各家账号鉴权是契约席转正的两道前置，列为迭代候选。

- **舰队扩编至六席：claude 转正（第五舰队）+ gemini 契约席（第六舰队，实验性）**（定案「扩充舰队支持广度」，2026-09-02）：**claude**（Anthropic Claude Code 2.1.258，本机 npm 安装+实弹全证）——`claude -p --output-format json` 无头一次性（尾包 session_id/result，uuid 形），项目级 `.mcp.json` 与 zcode 同构注入（Claude 同款 mcpServers 机制），`claude --resume <会话号>` 跳转，会话 JSONL 落 `~/.claude/projects/<编码>/<uuid>.jsonl`（历史弹窗零 token 读档，projects 树递归扫兜驱动器大小写变体）；鉴权双路：原生 `/login` 订阅或 env `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 走 anthropic 兼容网关（本机实证 `https://api.z.ai/api/anthropic` + GLM，Z_AI_API_KEY 直映，零新增授权）。**坑（实测确认）**：`-p` 默认权限模式拒一切工具调用与写盘——外勤诚实罢工（「No claim token exists. Nothing fabricated.」）且巡检无脑重派；修=无头框定必带 `--dangerously-skip-permissions`（与 opencode --auto/pi --approve/zcode yolo 同语义：隔离任务工作区内放行）。大副随舰队含 claude 席（spawnHeadlessClaude）。**gemini**（Google Gemini CLI 0.58）——契约全档（bundle 源码实证：`-p` 无头、`.gemini/settings.json` mcpServers 注桥（合并语义同各家）、`--resume`、自定义命令 `.gemini/commands/*.toml`（TomlCommandDefSchema：prompt 必填/description 可选）），但本机无 GEMINI_API_KEY 未实弹——实验性席位（同 codex 口径），大副回退 opencode；0.58 无 `--output-format` → 无进程内会话号捕获（诚实降级注记）。fleet 门六席卡双语 note（noteEn，i18n 轴挑拣）；fleet-gate 门面文案双语化（含 claude/gemini 模型占位）。live 门：`STARDECK_LIVE_EXECUTOR=claude` 相位 **23/23**（全链 claim→执行→KillCredit→收官 + 尾包捕获 + 跳转同构 + 真读 ~/.claude jsonl 20 条；鉴权 env 自动 Z_AI_API_KEY 映射）。verify PASS（329 测）。

- **界面多语言（i18n，定案「支持多语言」，2026-09-02）**：设置抽屉新增「语言 / Language」段（中文/English 两枚选项钮，独立形态常驻）——全板措辞实时换库。**架构**：copy.ts 升级为**皮肤×语言双轴词典层**（setLang/subscribeLang 与皮肤轴共用一套监听，views 两轴各挂 useSyncExternalStore；activeCopy 按轴取典；localStorage `warroom-lang` 持久化）；EN 词典 `copy-en.ts`——war（军事英典：Sovereign/Staff Officer/Field Commander/Battlefield）与 plain（工程平话英典：Planning Agent/Executor Agent）两份**全量逐键英译**，trek 皮肤=军事英典过 EN trek 词表派生（EN_TREK_LEXICON ~18 对：War Room→Bridge/Battlefield→Planet/…，与中文侧同机制；trekifyCopy 参数化 lexicon）。**完备性铁门**：tests/copy-lang.test.ts 深走键路径逐键对齐（缺键/多键/叶子类型不符即 FAIL——不静默回落中文，杜绝半截语言界面）+ 换库行为 + trek 派生命中 + 语言键四典齐备。**边界（舰长定）**：i18n 只覆盖板 UI 措辞——账本与提示词资产（prompts/persona/staffOrderFor 等 agent 面正典）保持中文单一源，不随语言切换。绑定门（fleet-gate.tsx）双语门面（GATE 双词典+六席 noteEn）。实机目检：设置切 English → 全板实时换装（岛计数/星域 aria/调度条/图例/设置抽屉/聚焦钮 tooltip 全 EN，命令卡命令原文保持中文=账本事实），取证 `.goal/evidence/ui-i18n-english.png`。

- **只读会话历史弹窗（方案2·二段，定案 2026-09-02：「默认在 ui 里弹窗会话历史，能开 TUI 的加在 TUI 中打开」）**：两颗会话钮主行为改为板内弹窗展示原生会话全文——**零 token**（不 resume 不烧模型，直读各舰队落在本机盘上的会话存档；上一代 zcode 视察汇报每点一次烧一轮模型，项目主判「不合理」，就此退役为 API-only）。**四席存储实证**（本机探针）：zcode=`~/.zcode/cli/db/db.sqlite`（message+part 表，无头会话全量入库）；opencode=`~/.local/share/opencode/opencode.db`（与 zcode 同构 schema）；pi=`~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl`（JSONL message 事件）；codex=`~/.codex/sessions/**/rollout-*<uuid>.jsonl`（response_item 事件）。**读取器**（`src/history.ts`）：sqlite 双表解析（opencode/zcode 共用查询，node:sqlite readOnly；正文在 part.data——text/reasoning/tool 三件入流，step-start 等杂件跳过）+ pi/codex JSONL 解析（纯函数）；db 路径可 env 覆盖（STARDECK_OPENCODE_DB/STARDECK_ZCODE_DB）。**端点**：`POST /warroom/api/attach/history`（jump/history 共用 resolveAttach 助手——映射优先双键型，键型语义一致）+ `POST /warroom/api/attach/entries`（轻查映射席别，TUI 行可见性数据源）。**板 UI**（独立形态；宿主形态两钮仍板内切会话）：任务会话/执行会话 → SessionHistoryModal（标题分任务/执行、席别+会话号徽标、角色标签 输入/大副/外勤/工具、reasoning 灰斜体、工具调用 ⚙ 名+截参；useModalLayer 焦点/ESC 级联）；钮下方 **TUI 次行**——attach 映射席别 ∈ {opencode,pi,codex} 才渲染「↗ 在 TUI 中打开任务/执行会话」（zcode 无 TUI 不给；playground 目检：opencode 任务出 TUI 行、zcode 任务不出）；老命令无映射 → 弹窗内诚实错误（404 语义）。样式全走既有令牌（war-tokens 闭合门抓过两次自造变量——--war-font-mono/--war-panel-tint/--war-accent/--war-ok/--war-border-strong 全数换正牌）。验证：history.test.ts 5 测（解析器纯函数 + node:sqlite 真 库往返 + pi 文件定位）+ attach-face 真 daemon 扩（entries/history/404）；live 默认 **16/16**（+历史断言：真 opencode 库读 7 条、首条含征召令 + entries 轻查）+ zcode 相位 **23/23**（+真 ~/.zcode 库读 11 条）；UI 目检两图（`.goal/evidence/ui-session-history-*.png`：zcode 全程含此前视察轮、opencode+TUI 行分席门控）。verify PASS（321 测）。

- **大副随舰队**（定案「大副也应该用选择的舰队跑」，2026-09-02）：舰队绑谁，下一轮大副就跑谁——不再固定 opencode 框定。**三席框定法**（executor.ts 新 `spawnHeadlessZcode`/`spawnHeadlessPi`，与 `spawnHeadlessOpencode` 同构：写简报→注工具面→spawn→接管日志）：zcode=`--prompt --json`+`.mcp.json` 桥（全量 war_*；模型串不透传，引擎吃自身 config 的 provider 条目）；pi=`--approve -p`+**大副侧扩展件**（`piStaffExtensionSource`——只注册 war_board/war_triage/war_plan/war_publish/war_abandon_command 五件大副动词，**红线：禁注册 war_claim/war_submit/war_fail**，出口协议只属执行者扩展）；codex=Windows 实机受阻（README 在档）诚实回退 opencode 并打日志（`staffExecutorFor` 纯函数管辖，不静默）。**接入面措辞随席**：staffOrderFor 加 face 参数（mcp=桥措辞原样；pi-extension=扩展措辞，不撒谎「MCP 已接」）——默认 face 快照零变动，pi 面新 fixture。**会话捕获三态**：opencode=行钩 eager；zcode=退场 `--json` 尾包；pi=daemon 在大副退场时惰性扫描 `~/.pi/agent/sessions`（minMtime=本轮起跑防误捕上轮）——板上「任务会话」钮三席全通。**模型随板面绑定**（activeModel；zcode 席例外）。实弹门参数化：`STARDECK_LIVE_STAFF_EXECUTOR=<zcode|pi>`（默认 opencode 不变）+1 断言（staff-<id> 映射的 executor=所选舰队）。测试：staffExecutorFor 映射/pi 面红线/扩展缺席红线 + 快照 fixtures staff-order-pi.txt & pi-staff-extension.ts。README 兵种门/环流段同步。

- **聚焦页会话跳钮方案2 收编**（定案「方案2，变成任务会话与执行会话」，2026-09-02）：三钮（任务会话/执行会话/进入会话）并立退役——独立形态第三钮与宿主前两钮目标重复。终态=**两颗钮双形态**：宿主形态板内切会话（jumpSession 原语义）；独立形态走 `POST /warroom/api/attach/jump` 在桌面终端拉起执行者原生会话（`任务会话`=大副现场，`执行会话`=外勤现场），共用 attachBusy/attachNote 反馈。**大副会话捕获**：spawnStaffAgent 传 `attachTaskId=agentId`（daemon 侧 agentId 即 `staff-<ts36>`）——spawnHeadlessOpencode 既有 stdout 行钩把大副原生 opencode 会话号入 attach-map（键=staff-<id>）；板上数据源本就齐——独立形态 `cmd.staffSessionId`（directive_session_opened/received 事件携带）就是这个键。**jump 端点双键型**：改映射优先（先查 attach-map，campaign 查找只放映射未命中后的任务分支；pi 惰性捕获仅在任务分支）——`taskId`（执行者会话）与 `staff-<id>`（大副会话，无 campaign）双键可跳。copy.ts `attachJumpBtn` 键退役（第三钮亡），`attachJumpHint` 改通用成功提示。attach-face 真 daemon 测试 +staff-<id> 无 campaign 命中断言（200 opencode argv 同构）。verify PASS（311 测）+ live 14/14。

- **zcode 跳转降级为视察汇报模式 + 执行者身份自愈**（项目主 playground 实弹三连抓，2026-09-02）：①**TUI 秒退根因**——zcode 无独立 CLI 分发（官网仅桌面安装包；npm 无 @zcode/tui 且非公开包），桌面版自带引擎 node 模式的 TUI 依赖 `@zcode/tui`（仅内嵌 SEA 单可执行形态，`e.getAsset` 提取，node 模式拿不到、无下载函数，%LOCALAPPDATA%\zcode\Cache\sea-assets 从未落盘）→ TUI 模式必秒退。**降级**：jumpArgs(zcode)=`--resume <会话> --prompt <视察汇报> --json`（原会话上下文里外勤汇报做过什么/产出/验证，禁工具只读）；buildTerminalCommand 加 keepOpen（cmd /k 留屏——汇报跑完窗口不闪退；TUI 形态不裹）。视察实弹验证：hello 会话汇报准确（领任务→建文件→真跑→交证）。②**身份丢失根因**——zcode 未把 .mcp.json 挂进工具面板时模型自愈直连 HTTP，请求体无 agentId → 账本记 anonymous（live 断言抓获）。**修**：executorBrief 亮外勤编号 + 教「直连必须带 agentId」（attach 断言复绿）。③召唤件 golden 重生成（模板行更新），zcode skill 已重装。zcode 相位 20/20 + verify PASS。**环境注记**：本机 C:\Users 是指向 D:\Users 的 junction（realpath 实证）——路径双形态等价，工具可能报任一形态，勿当异常。

- **上游文案审计全量回流**（定案「跟着上游的做法进行文案修复」，2026-09-02；同步自 dsh-plugin-stardeck 文案审计轮 e7f61af 七批次约 60 处，同步纪律=AGENTS 内核回流）：**批A 整文件回流 16 件**（persona/prompts/skill/rules/wake/dossier/directives/units/chain-note/goals/relay/dashboard/client-inbox/starfield3d/warzone-scene/tools——保 stardeck 的 @module 头与 defineTool shim import 两处特有段）——涵盖任务令起草法正名、wake 对齐人工验收、war_* 工具描述纠偏（L0 直发语义/打回作废即终局/星域→前线/战况→近况/组员直讯/收编→撤编）、敌情→侦察、closedVerdict 空展示兜底两处小修、WzStatus 枚举重构+速报日志入典+cancelledNote 错接修复。**批B copy.ts 三方合并**（base=分家版）：上游批次2/3 词典正名（军事源串回归词表源词、plain 清戏剧词、硬编码 20+处入典、hqPickerLoadError/RegFail/frontBfLabel/wzLogSortie/Return 入典）与我方 13 增量键（themeDark/attachJump/hqPickerManual*）并集共存。**批C views.tsx 以上游为基重放我方五块增量**（整文件单冲突块实测确认 diff3 失效——ClientServicesFace/SettingsDrawer 暗色/FocusPage 进入会话钮/HQ 手动区/bfChoices 并入，git diff 36 行全数幸存核验）。**配套**：prompts-snapshots 全族+词锁测试 10 件（relay/rules/staff-plan/staff-triage/troop-mailbox/troop-scheduler/v5-spike/starfield3d/prompts-snapshot/chain-note）同步；大副快照重生成（staffOrderFor 引回流后 commanderOrderFor 措辞，staff-snapshots 是 stardeck 独有非上游件）；eval 监督层三件正典化回流（司令→外勤小队）。批次6 文档面不搬（stardeck 文档自有独立语境）。verify PASS（310 测）+ live 14/14。

- **HQ 星球注册门接线**（定案「手动路径+资源管理器选文件夹+任意位置新建」，2026-09-02）：独立形态下点 HQ 发射台注册本机文件夹为星球，从此全链可用。**daemon**：`POST /warroom/api/planets/pick`——win32 `Shell.BrowseForFolder`（0x41=RETURNONLYFSDIRS\|NEWDIALOGSTYLE，Vista 风格**自带「新建文件夹」按钮、可浏览任意位置**）经 powershell -STA 弹原生资源管理器对话框；输出强制 UTF-8（PS 5.1 ANSI 码页乱中文路径预防）；取消/虚拟文件夹=cancelled 语义；10 分钟超时；他平台 501 教学错误（可直接输入路径注册）。`folderPickerScript` 纯函数测试管辖。**板 UI（内核 diverge 注记：views.tsx 两处增量，回流插件仓时整块搬移）**：①HQ 弹窗手动注册区——宿主清单面缺席时自适应顶上（不报错）：路径输入+标题输入（拾取后自动填目录名）+「浏览…」（原生对话框）+「注册为星球」；注册闸沿用服务端（真实目录+去重）；copy.ts 两皮肤词典补 hqPickerManual* 七键；styles.ts 手动区样式段。②起草器星球选择器并入注册星球（原仅任务派生工作区——「注册了星球却指定不到命令」断链根修；`bfChoices=[...wsOrder, ...registeredPlanets]` 去重）。链路考古：星域渲染本就用注册清单（wzWsOrder=registeredPlanets，idle 态在档）、大副教学在 skill.ts:54（【星球：路径】标记→无条件用该工作区）、war_publish repo 参数→git worktree 物化——全链唯独选择器断，本次接通。**坑**：dashboard 的 send 刻意吞状态码统一 200（内核 1:1 设计，测试断言走 body.ok）；本机 Git Bash heredoc 引号定界也吃反斜杠（再证，含反斜杠内容一律 Edit 工具）。实机目检：HQ 弹窗手动区渲染（17 号图）+ 真实目录注册 → ✓ 已注册入星域 + 分组在案 + 起草器星球行可选（探针星球 chip 实证）。verify PASS（301 测）+ live 14/14。原生对话框本体（BrowseForFolder 交互）留用户终验。

- **第四舰队 zcode 转正**（定案「可以」，2026-09-02）：ExecutorAdapter 四席齐装。引擎=桌面应用内打包 `zcode.cjs`（0.16.5，无 PATH 裸名——detectZcodeBin 探 LOCALAPPDATA 部署位，spawnCli 经 node）。**无头帧定**=`--prompt <text> --json`（值形；`-p` 布尔遇位置参数有解析歧义实测三撞；--prompt 缺省 yolo=无人值守所需）。**工具面**=`injectZcodeMcp` 写项目根 `.mcp.json`（源码实证 rootPath 加载，Claude 同款 mcpServers；bound 合并+首动备份+坏 JSON 拒绝）。**会话号捕获**=stdout 行钩 `zcodeSessionIdFromLine`（--json 尾包 `"sessionId":"sess_…"`）→ attach-map。**附着三件**：JUMP_TEMPLATES.zcode=`node zcode.cjs --resume <会话号>`（argv=node+探测绝对路径）+ 召唤件 `skills/stardeck/SKILL.md`（zcode 斜杠命令即 skill）+ 惰性扫描无需（eager 钩已足）。**CLI 配置配方**（仓外接线，备份在 `config.json.bak-attach`）：`~/.zcode/cli/config.json` 需 `model.main="providerId/modelId"`（字符串形；对象形被 schema 拒）+ `provider.<id>` 规范条目 `{name,kind:"anthropic",options:{apiKey,baseURL:"https://api.z.ai/api/anthropic"},enabled,source}`（形状对照桌面 `~/.zcode/v2/config.json` 实况；key 已由桌面 OAuth 存于该文件，未新增暴露面）。**坑**：spawnCli 参数类型漏 `onStdoutLine` 静默丢钩（esbuild/tsx 不查型——附着断言 409 两轮才揪出）；zcode --json 尾包在进程收尾才打印，live 断言须轮询映射（≤20s）。实弹：verify PASS（299 测）+ zcode 相位 **20/20**（全链 claim→执行→submit→KillCredit→收官 + 会话号映射 + 跳转 argv 复认），零夭折。

- **附着面第一刀**（项目主 /goal，宿主前置形态：用户先开执行者 TUI，`/stardeck` 把舰桥附着上来，板上点「进入会话」跳回 TUI 对应会话；三舰队可行性源码/文档考证见 `.goal/SPEC.md` 附着面段）：**ExecutorAdapter 第三面**（executor.ts）——`JUMP_TEMPLATES`/`jumpArgs`（opencode --session / pi --session / codex resume，模板-argv 同构测试锁死）、三召唤件生成器（opencode `.opencode/command/stardeck.md` / pi `.pi/extensions/stardeck-summon.ts` registerCommand / codex `prompts/stardeck.md` 契约件含 #15939 版本敏感注记；golden fixtures `tests/attach-snapshots/` 逐字锁）、`attach-map.json` 映射账（stateDir 侧，不碰 fold——账本零分叉）、opencode 事件流行捕获（`--format json` 每行 `"sessionID":"ses_…"`，1.18.5 实测；spawnLogged 行钩，征召即写映射）、pi 惰性捕获（会话文件名 `<ts>_<uuid>.jsonl`，目录编码镜像 pi-mono getDefaultSessionDirPath，对齐本机实况目录名）、`buildTerminalCommand`（win32 cmd start + /D cwd；其余平台契约面教学错误）。**daemon**：`POST /warroom/api/attach/jump`（dryRun 返回 argv/cwd/executor；实弹 detached 拉终端；缺映射走 pi 惰性捕获，仍无则 409 诚实拒绝；不落账本不改任务状态——读投影红线不破）。**板**：聚焦页底部第三钮「进入会话」（standaloneChrome face 门控——宿主形态不渲染，跳原生窗口仍由宿主两钮承担）。**实弹**：verify PASS（298 测）+ live 14/14（征召捕得真 `ses_` 号入映射 + 端点 dry-run argv/cwd 复认）+ pi 相位惰性捕获同构断言。

- **舰队正名 + 暗色开关 + 巡检死锁修复**（舰长四点实录，2026-09-02）：①**措辞纠正**——开局选的是舰队不是兵种：门标题「选择舰队」、席位注「主力舰队/第二舰队」、胶囊「舰队 · opencode ⇄」、daemon 日志同步（UI 面+fleet.ts+daemon.ts 措辞全替）。②**设置抽屉暗色开关**：`ClientServicesFace.standaloneChrome` face 门控（宿主里明暗随宿主、抽屉不渲染开关——独立形态才供给），切 `body[data-ds-dark-theme]` + 落 `warroom-standalone-theme` localStorage，client-standalone 开机预应用防白闪；**index.html 补齐暗色半边**——全量 73 枚 static 令牌 + 宿主 `body[data-ds-dark-theme]` 暗色 alias 表（158 定义）逐字提取自主题包（此前只带亮值表，暗色块把 `--war-*` 重指到 alias 后解析回白值，调度坞/命令卡在暗色下停留在浅色——13/14 号取证图前后对照）；ui-tokens 机检同步扩容。③**巡检死锁修复**（mtit94od 实测确认）：执行者起跑即夭折（pi 无 API key 未 claim 即退）后，死会话永久占住 published 任务——①失联回收只管 in_progress、②补征召 `anyFor` 连死会话一起跳过，卡片停在「等待外勤小队领取」且账本零痕迹、征召失败静默吞。修：②遇已注册但进程已死的会话先遗忘再补征（`task_requeued` 落账记死因，settleAttempt 空尝试守卫已核），conscript 失败改 console.error 不再静默。实弹：daemon 重启后巡检即补征 opencode，卡住 1.5h 的周报任务 in_progress→reported（`.goal/unstick-watch.log`）。取证：`.goal/evidence/ui-fix/13-15`（暗色门/暗色星域+坞/暗色列表）。verify PASS（291 测）+ live 12/12。
- **UI 复刻归位轮**（定案 2026-09-01：「完全恢复 UI，复刻原 dsh 插件里的样子」——前轮 impeccable 全修把字阶/折叠等改动打进 1:1 内核件，密排卡布局被破坏，板面重叠不可用）：**内核三件整体回滚**（`views.tsx`/`styles.ts`/`copy.ts` `git checkout` 至适配器轮基线，与插件仓 1:1 零分叉；字阶/折叠/n 键/toast/relTime/页签标等 UI 轮内核改动全数退役，impeccable 清单不再追讨）。**根因=独立形态令牌荒漠+挂载面塌高**，修法只在 standalone 侧：①`public/index.html` 落 `:root` 全套 `--dsw-*` 真值——逐枚提取自宿主 `@deepseek-ai/dsh-client-ui-theme/lib/client.js`（426 枚唯一定义）与编译产物 CSS 的 body 环境（字体栈/平滑/底色），**逐字保真含 bug 兼容**（`--dsw-font-markdown-code: 14px/22px …` 是 font 简写被 styles.ts 当 font-family 消费→非法回退继承，宿主如此渲染，照抄不修）；tests/ui-tokens.test.ts 双向锁死（styles.ts 引用到的每枚 `var(--dsw-*)` 必须在 index.html 有非空定义）。②`src/client-standalone.tsx` 满高挂载——宿主 shell 给 `.war-root`（height:100%）一满高容器，独立 App 外层原是裸 div 致板塌到内容高（星域压扁 236px/三列挤顶），补 `height:100vh` flex 列容器。**P0-2 绑定门**保留（`src/client/fleet-gate.tsx` 自带 `.war-root` 作用域，独立形态件非内核）。实机取证八图（`.goal/evidence/ui-fix/05-12`：三列墙+调度坞/聚焦页决策带/起草器/2D 战术盘/3D 星域发射台/任务回报卡聚焦，实度量对齐宿主：宿主字体栈/白底/deepseek-500 主钮/12px 字阶）+ verify PASS（291 测含 ui-tokens 门）+ live 12/12。

- **舰队兵种 UI 入口绑定**（舰长产品形态定案：每次打开绑一个 coding CLI）：板面入口「绑定舰队兵种」门（三席卡：opencode/pi 已验证、codex 实验性标记+诚实说明；可选模型输入按兵种语义给占位）→「开始调度」进甲板；板内右下角「兵种 ⇄」胶囊随时换绑。后端：daemon `activeExecutor` 运行态 + `GET/POST /warroom/api/fleet`（`src/fleet.ts` 探测：绝对入口 existsSync、裸名 `--version` 探针）；切换只影响后续征召——在役执行者进程与大副不动（大副固定 opencode 框定法+启动模型，provider 串格式各席不同）。UI 目检三证（`.goal/evidence/fleet-*.png`）+ 实弹门 12/12（新增 fleet 往返断言）。
- **监督层移植**（VERIFICATION.md P0-1/P0-2 收官）：eval/（promptfoo 裁判=glm-5.2+隔离提示词，三维 achieve/evidence/boundary ≥7 + veto 一票否决，正例=R3 八步真实轨迹、负例=幽灵战报镜像）+ `pnpm verify:eval`（诚实 SKIP 契约）。§8.4/8.5/8.7 继承 dsh 插件版项目主原答回填（2026-09-01 令「参考 dsh 插件版」）。首弹已证：正例 10/9/≥7 放行、负例 1/0 否决。安装坑：promptfoo 勿裸用 `--no-optional`（连 libsql 平台绑定一起跳）——本仓用 `pnpm.ignoredOptionalDependencies` 外科忽略 transformers/onnxruntime 巨物链。四层验证体系齐装。
- **pi/codex 执行者适配器实装**（HANDOFF② 二刀，源码实证——定案克隆 openai/codex 与 badlogic/pi-mono 至本机 projects/，一切契约以源码为据）：**pi 转正**（`pi --approve -p` 一次性框定 + 项目级 `.pi/extensions/stardeck-tools.ts` 注册出口协议三工具——pi 无 MCP 扩展即集成面；实弹门执行者相位 `STARDECK_LIVE_EXECUTOR=pi` 全链 PASS）；codex 契约实装（`codex exec --json -C` + MCP 注入走 `-c` 命令行覆盖——版本稳定通道，项目级 `.codex/config.toml` 为 0.152+ 特性 0.44 不加载；env 的 TOML 内联表语义坑二弹实测确认）。本机模型接线（仓外）：`~/.pi/agent/extensions/zai.ts` + `~/.codex/config.toml` 追加 `[model_providers.zai]`（仅定义不启用），key 全走环境变量。
- **win32 spawn 纪律**：npm `.cmd` 垫片禁裸 spawn（Node 安全补丁，实测确认）——detect*Bin 解析包内 JS 入口经 `process.execPath` 直跑（spawnCli），.cmd 配置落教学错误。
- **配置**：`modelProvider` / `STARDECK_MODEL_PROVIDER`（codex 语义 `-c model_provider=` 直通）。
- **实弹门执行者相位**：`STARDECK_LIVE_EXECUTOR=<codex|pi>` +5 断言（发布征召/全链/KillCredit/强制验收/收官）。
- **大副外聘**（HANDOFF①）：`src/staff.ts` + daemon `staffTick`（15s 哨位）——独立形态的引信替位。draft 命令由 daemon 自动框定的无头 opencode 大副接手（`staffWorklist` 工单判定：接令/呈改计划/发布；`staffOrderFor` 征召令=staffPersonaText 正典+MCP 接入面+relayPromptFor 内嵌，tests/staff-snapshots/ 快照门管辖）；**定时令到点自动派发**（宿主 30s tick 替位）；计划待批=等舰长不出单；退场工单未清算 2 分钟防风暴退避，超龄（默认 30min）熔断。`STARDECK_STAFF=0` 关，`STARDECK_STAFF_TIMEOUT_MIN` 调时长。实弹门大副相位 `STARDECK_LIVE_STAFF=1`（+6 断言）。
- **bound 工作区配置合并注入**（HANDOFF③）：`injectOpencodeMcp`——绑定既有项目的任务工作区不再直写覆盖 `opencode.json`，逐键合并只动 `mcp.stardeck`，首动前原件备份 `.stardeck/opencode.json.pre-stardeck`，坏 JSON 拒绝覆盖（不毁用户配置）。
- **旗面双跑矩阵**（VERIFICATION.md P1）：`STARDECK_VERIFY_MATRIX=1 pnpm verify`——同一套回归在全特性旗显式 OFF（清单从 src/flags.ts 单一源提取）下也须绿。
- **验证体系实例化**：仓内 `VERIFICATION.md`（stop-manual-testing 协议项目级实例：ACI 审计证据、§8 参数、缺口清单）+ AGENTS.md 强制引用。

### 受限（本轮新增的诚实降级）

- **codex 实机受阻于 codex-cli 自身**（非本仓缺陷，证据链 README/DESIGN D12）：0.44 Windows 无法 spawn node 常驻 stdio MCP 服（八变体探测，capture 服 BOOT 恒不出现）；0.152+ 移除 `wire_api="chat"` 且 z.ai 网关无 Responses 面（404 实测）——换机或版本考古再战。
- 大副 L2 澄清收敛降级为计划稿问答（舰长驳回意见即澄清通道）。
