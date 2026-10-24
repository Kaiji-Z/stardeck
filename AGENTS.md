# AGENTS.md · stardeck 迭代指引

本仓库是 **stardeck（星舰甲板）——agent 舰队的作战看板与守护进程**，v0.1.0（2026-09-01 交付）。血统：[dsh-plugin-warroom](https://github.com/Kaiji-Z/dsh-plugin-warroom)（DeepSeek Harness 插件「舰桥」）的独立纪元——同一套账本/状态机/KillCredit 内核 1:1 迁移（27 模块原样、tools.ts 仅换 defineTool），脱离宿主、agent 无关。**两仓关系：本仓=主战场；插件仓=守护态（只收 bug 修复）**。新会话在此迭代前先读本文件，再按需读 `HANDOFF.md`（交付快照）与 `DESIGN.md`（决策录）。

## 开局必读

1. **边界宪法（继承自 warroom，不可违反）**：
   - **会话外的一切归 stardeck**：账本/工作区/征召/巡检/看板/验收定夺；
   - **会话内的执行归 agent 本体**：执行工具由执行者自带，stardeck 不越界；
   - **出口协议不可裁剪**：`war_claim` 令牌制（attemptId 即 capability）、`war_submit` 证据核验（KillCredit 机械判据：checks 全过 + tests 退出码 0 + 无越界文件 + **取证轨迹**——tests_evidence 指向 .stardeck/evidence/ 下的真实运行日志，存在/mtime 晚于领取/尾部退出码与自报一致三查；相悖打回，缺轨迹受理但账本注记「无取证轨迹」板上可见。BYOK 下舰桥无力重放，内容真实性归舰长翻阅——V19.12 对抗审查定案）、`war_fail`、`war_close_task`。快照测试点名断言这些段，动即 FAIL。
2. **不变量红线（随内核继承）**：attemptId 令牌制、KillCredit 证据链、JSON-text 通道（evidence/deliverables 是**字符串**，内容为 JSON）、SSE revision-only、**板是读投影**（浏览器端不提供改任务的写操作；舰长的「写」都经通道——左区 composer 下令，聚焦页答复/驳回意见经大副通道送达，板上无任务级写操作）。
3. 每轮收尾必须 `pnpm verify` PASS 并提交（tests + build + needle 三段式，含**零宿主引用负针脚**——import 层出现任何 `@deepseek-ai`/`cordis` 即 FAIL，这是独立形态的完整性铁证）。
4. 交付特性前跑 `pnpm live`（实弹门：真 opencode 外勤全链，10 项断言）；改提示词必须过快照门（见「提示词纪律」）。
5. **强制验证协议**：开发任何特性/改任何代码前，先读并遵循仓内 [`VERIFICATION.md`](VERIFICATION.md)（本仓验证体系实例：§8 参数、ACI 审计证据、缺口清单都在那）。违反其 §7 红线的产出无效；[must-ask] 项（监督设计/验收标准）不得反推填充。

## 源码地图（src/）

| 文件 | 职责 |
|---|---|
| `cli.ts` | **bin 入口**（daemon.ts 是库模块不自动起服——spawn/直跑 daemon.ts 会静默退出，入口永远是 cli.ts）。**D30 开箱面**：start 就绪自动开浏览器（--no-open 关）+ 首跑自动建快捷方式（--no-app 关；`app` 子命令恒建——win32 开始菜单 .lnk 经 PowerShell COM/darwin .command/linux .desktop，dev 态诚实拒绝）+ `connect [host]` 一行接入 |
| `connect.ts` | **一行接入代理舰长外接席**（D30）：daemon 缺席自拉起（detached spawn node 直跑 bin/stardeck.mjs，dev 态诚实报「先 start」）→ 签席 → 四宿主**声明式文件写**（claude=~/.claude.json mcpServers / zcode=~/.zcode/cli/config.json mcp.servers（CLI setting.json 在则双写+features.mcp）/ opencode=opencode.json mcp 键 / codex=CODEX_HOME config.toml 文本级摘旧表再追加）+ generic 打印块。注入家族纪律（首动备份 *.pre-stardeck/原子/幂等/坏 JSON 拒绝）；红线：注册面只含 --face proxy + STARDECK_PROXY_TOKEN（测试三查钉死） |
| `daemon.ts` | 装配层（原插件 index.ts 的对位物）：dashboard 鸭子直挂 + war_* 注册表 + MCP/工具调用端点 + 巡检 + 板 UI 静态服务 + 优雅关停 |
| `executor.ts` | 执行者适配层：ExecutorAdapter **六席**（opencode/pi/zcode/claude 已验证；codex 契约+Windows 阻碍、gemini 契约+本机无 key=实验性）+ ExecutorRegistry（进程即生命）+ executorBrief（mcp/pi-extension 双面措辞）+ spawnHeadlessOpencode/Pi/Zcode/Claude（无头框定法，大副随舰队共用；win32 .cmd 垫片禁裸 spawn，JS 入口经 node；claude 无头必带 `--dangerously-skip-permissions`——默认权限模式拒一切工具，实测确认）+ 五家注入器（bound 逐键/整表合并+首动备份） |
| `history.ts` | 会话历史只读读取器（零 token 板内弹窗）：zcode/opencode=sqlite 双表（同构 schema，node:sqlite readOnly）、pi/codex/claude=JSONL 各自解析；db 位 env 可覆盖 |
| `mcp-bridge.mjs` | stdio JSON-RPC 桥（外部 agent 的 MCP server；转发 tools/call 给 daemon HTTP；stdout 只走协议帧）。**D29 双脸**：--face war（缺省=全套 war_* 执行者面，字节不变）/ --face proxy（座席面：get_order/submit_reply/read_board/read_digest/read_ledger 恰五件，STARDECK_PROXY_TOKEN 必填，war_* 一件不出——快照锁在 tests/mcp-proxy-face.test.ts） |
| `proxy-seats.ts` | **D29 外接代理舰长席**：座席签发/校验（seatId `proxyx-<ts36>` + token 48hex 只现签发响应，落盘 sha256；proxy-seats.json tmp+rename 原子写）。身份门=在册∧**在途祝福**（daemon.proxyGateBless——仅 applyProxyReply 放行的 callTool 过门，伪造 agentId 直打 /tools/call 被拒；攻击负向测试在 tests/proxy-external-seat.test.ts）。契约端点 proxy/seats、order、reply 在 daemon.ts 路由段 |
| `proxy-loop.ts` | **D29 内置代理舰长 loop**：ai SDK streamText+tool+stepCountIs(6)（参考 lookatstudy agent-engine；@ai-sdk/openai-compatible 钉 1.0.58=spec v2 配 ai 5——v3 是 spec v4 不兼容，实测 UnsupportedModelVersionError）。tools=只读三件（进程内闭包读投影），终答交 applyProxyReply 共用收割；STARDECK_PROXY_LOOP 旗默认 OFF，失手诚实降级舰队席+战报交代；看门狗 AbortSignal.timeout。**D36 流式详情**：onReasoningDelta 思考流（GLM reasoning_content→reasoning-delta part，1.0.58 实测通）+onToolStep 第三参 detail=入参/出参摘要（summarizeStepDetail 压平截断）；**发话即应答**：dashboard POST /bridge/messages 入账成功回调 deps.bridgeKick（daemon 注入 proxyTick）——15s 哨位降兜底，实测 kick→开跑 ~1s（旧口径平均 7.5s+）；loop 收官若还有未答新话 400ms 续跑一轮 |
| `tool.ts` | **defineTool shim**（对齐 dsh-tools 契约：参数描述→JSON Schema + 执行前校验 + `invalid arguments:` 教学错误；子集=string/text/number/boolean/array） |
| `config.ts` | 独立配置：`~/.stardeck/config.json` + `STARDECK_*` env（PORT/STATE_DIR/WAR_ROOT/MODEL/EXECUTOR_BIN）+ CLI 覆盖 |
| `tools.ts` | war_* 工具 24 件（与插件仓同名同义；唯一分叉点=defineTool import）。**2026-09-23 回流批**：CommanderOps 增 releaseSpawned（requeue 先释放守卫再补征+回执消费征召结果）、staffOwnerOf 身份考古+五道身份/状态门（close/comment/deploy/orders/recall/log_report）、KillCredit 双处否决 failed>0、war_publish cron 可满足性门+goal 结算前移+campaign 连写批量单写、closeTaskInternal 定时停用（非通过语义落 enabled:false）+计划滤 deps |
| `staff.ts` | **大副外聘**（HANDOFF①落地）：staffWorklist 工单判定（纯：终态/未到点/计划待批/**澄清挂起**不出单）+ staffOrderFor 征召令（staffPersonaText 正典 + 接入面 face=mcp/http/pi-extension + relayPromptFor 内嵌 + **输入成熟度评估/澄清块/任务书块指引**；快照门在 tests/staff.test.ts）+ spawnStaffAgent（zcode/pi/claude/dsh/codex/opencode 六席 dispatch）+ **D27 代理舰长席**（proxyOrderFor 征召令+【命令】块收割拟令成卡 issuedBy=proxy-…+【定夺】块授权代定夺+PROXY_COMMAND_BLOCKS_CAP=5 防幻觉风暴；spawnStaffAgent 参数化 role:'proxy'）+ **D28 百事通**（proxyOrderFor 增账本切片/只读通道教学（只许 GET）+【图景】块 proxySceneBlocksOf（单轮 1 份/6000 字）+管理块 proxyManagementBlocksOf（撤令/重派/定时令停/绑席，单轮 3 块/理由 300 字，全直落无旗）；块头强调包裹容忍）+ **澄清协议面**（D23：inputMaturityOf 四判型预评 + clarificationBlocksOf/briefBlocksOf 块解析（五项缺一即弃；V22.4 容忍 markdown 列表变体）+ **选择题式追问**（ClarifyAsk{raw,text,options}——`A x / B y / C 你帮我定` 行内选项入账，板上点选拼装 `1A;2B` 答复，DESIGN D23 第三刀）+ staffHarvestEventsFromText 纯核心/harvestStaffDirectiveEvents glue 退场收割 + **CLARIFY_ROUNDS_CAP=2 轮数机械闸**（过限拒收+rejected 上报）+ **D24 两档制**（L0 直发/L1 签任务书——分诊后成任务书块停轮等签，签发发布单逐字照抄，重拟单携原稿+意见；renderBriefForSign 代开呈批件））；staffExecutorFor=**双席正典闸**（V19.13：可选舰队必须大副+外勤双接通） |
| `fleet.ts` | **舰队兵种面**（UI 入口绑定，2026-09-01）：probeFleet 十二席探测（绝对入口 existsSync/裸名 --version 探针）+ fleetSeatIds 校验 + **bindableSeatIds 双席判别式（adapter && staffReady——gemini/qwen 降不可选）**；daemon 持 activeExecutor 运行态（`GET/POST /warroom/api/fleet`，切换只影响后续征召，大副随舰队过 staffExecutorFor 闸）；绑定门 UI 在 fleet-gate.tsx |
| `dashboard.ts` | /warroom/api/* 全路由（板投影/board SSE/commands/trace/archive…单 prefix、handler 内自分发） |
| `events.ts`/`directives.ts`/`threads.ts`/`planets.ts` | append-only JSONL 账本 + fold（与插件仓 1:1；directives 侧 V20.1 增澄清协议三事件——requested 挂起/answered 翻 pending/brief_ready 任务书一等事件，fold 向后兼容老账本；V23 增 clarificationRounds 只读派生（每轮问答史——会议室时间轴数据面））。**2026-09-23 回流批**：四路 append 统一走 `jsonl.ts`（尾字节检测治崩断粘连+批量单写原子）；events 增 `isPassVerdict`（词头+句读边界——`includes('通过')` 子串误判退役）；dueScheduledDirectives 只认 draft；directive ID 后缀 8hex |
| `jsonl.ts` | **JSONL 追加唯一入口**（2026-09-23 对抗审查回流新模块）：appendJsonl 追加前查尾字节非换行先补 \n（崩断半行不再吞后续事件）+ appendJsonlBatch 多事件单次 write（war_publish 的 created+published[+scheduled] 写级原子） |
| `bridge.ts` | **舰桥频道账本（D26 建、D27 承运层正名）**：bridge.jsonl 三态消息（user/agent 终答全文/system 机械战报）+ fold + bridgeUnanswered 未答判定（**代理舰长**回合出勤依据）+ bridgeHistoryWindow 携史兜底（全席逻辑常驻）+ collectBridgeNoticeEvents/syncBridgeNotices 机械战报五触发（reported/clarify/retry/terminal/scheduled，dedupKey=源事件指纹幂等）；D28 增 agent 话轮 artifact 附件字段（图景引用，条件 spread 旧消息零迁移）+第六种战报 scene（图景对账失败诚实告知）。入 revision 六账本——SSE rev 变化即聊天窗/板双刷 |
| `scene.ts` | **D28 图景确定性渲染器**（纯函数）：parseSceneDraft（标题+摘要+timeline/stats/cards 围栏，强调包裹容忍）+ renderScene（模型只写草稿、布局/配色/转义全由代码算；零 `<script>` 单文件+内联 CSS；**cards 编号逐一对账 SceneContext，未知即整页拒收**——数字可溯源）。daemon 收割侧落盘 artifacts/scene-<ts36>.html 并经 /warroom/api/artifact/<id> 出线（CSP default-src 'none'） |
| `rules.ts`/`workspace.ts`/`schedule.ts`/`state.ts`/`fold-cache.ts` | 征召计划/工作区物化与释放/cron/全局态/装载缓存（1:1）。**2026-09-23 回流批**：conscriptPlan 滤 deps（statusOf 给出时跳过 dep-locked）；normalizeFront 大小写折叠（win32/darwin）+ normalizeWorkspaceKey realpath 归一（junction 别名）；workspace 增 isAutoWorkspace 双根守卫；schedule 严格解析+assertCronUsable+horizon 封顶；state 原子写（tmp+rename）；fold-cache 返回 Object.freeze |
| `prompts.ts`/`persona.ts`/`skill.ts`/`chain-note.ts` | 提示词资产单一源（快照门管辖；1:1） |
| `goals.ts`/`relay.ts`/`wake.ts`/`quota.ts` | 宿主面结构接口（faces 注入；独立形态诚实降级路径的类型载体） |
| `client/provider-presets.ts` | **D34 供应商预设注册表**（照搬 zcode 开源 config/provider/zcode-builtin.json 的 templateRules 形状：id/双语名/baseUrl/领 key 链接/常用模型——anthropic-messages 供应商换用各家 OpenAI 兼容端点，loop 只说这一种协议）。纯 UI 数据；**模型设置=独立弹窗**（舰长令：抽屉内一行摘要+「模型设置…」钮→`ModelSettingsDialog` 模态，useModalLayer 后压栈=Esc 只关弹窗；统一契约「药丸=填表、保存=唯一提交」），存储仍 config.loop 中立三件套 |
| `client/` | 板 UI 前端（views.tsx 三级布局/皮肤词典/星域/到访件…1:1，除 shell-entry 已由独立入口替代；V23 聚焦页增**会议室段**（data-stage=meeting，澄清时间轴+共识草稿常驻+成案中过程态，DESIGN D23 第四刀）；D26 reportBody 导出供舰桥消息体共用 md-lite 渲染+WarView 增 hashchange 深链监听）。**D26 舰桥**（2026-10-20）：`client/bridge.tsx`=聊天面（消息流+决策卡坞：澄清药丸/签发五项卡/验收证据卡，词汇复用 focusPage 词典；卡片为独立组件实例持各编辑态）。**i18n**（2026-09-02）：copy.ts=皮肤×语言双语层（setLang/subscribeLang 与皮肤轴共用监听；activeCopy 按两轴取典）+ copy-en.ts=war/plain 两份英典（键形与中文词典逐键对齐，tests/copy-lang.test.ts 锁完备性——缺键即 FAIL 不许静默回落）+ EN trek 词表派生第三皮肤；fleet-gate.tsx 自带双语门面文案；账本与提示词资产保持中文单一源（agent 面正典不随语言切换） |
| `client-standalone.tsx` | 板 UI 独立入口（D31 悬浮球改版）：**看板恒为基座** + 可拖拽舰桥悬浮球（点按=开关 Telegram 式聊天浮窗、拖动=移位+位置持久化；浮窗贴球择向弹出、拖动实时跟随；消息排版对齐 lookatstudy 中栏配置：AI 扁平全宽 prose/舰长右小气泡）+ 舰队胶囊；**设置唯一入口=看板设置抽屉**（皮肤/语言/明暗/字号/定夺授权全在 views.tsx SettingsDrawer）——三态壳/分屏/迷你设置弹层已退役；旗 OFF 无球纯看板；lastSeen 离页落 |
| `units.ts`/`toml.ts`/`dossier.ts`/`activity.ts`/`report-capture.ts`/`v5spike.ts`/`types.ts`/`flags.ts` | 与插件仓 1:1（v5spike 留作宿主契约考古，路由缺省不注册） |
| `steer.ts` | **pi RPC 客户端**（P0-1）：JSONL 手切帧（禁 readline——U+2028/29）+ prompt/steer/follow_up 帧 + response 按 id 关联 + agent_settled 收割；deliverViaRpc=续跑投递（板内答复/批注转达共用）；deliverViaOpencode=opencode 席 `run -s` 续跑（观察窗三态，D20） |
| `codex-shim.ts` | **Responses→chat 垫片**（V19.13）：GLM 直驱 codex 的翻译面（SSE created→output_item.done→completed）+ 回环服（`stardeck codex-shim` 启动，仅绑 127.0.0.1，key 不入 codex 配置）；codexShimProviderArgs=适配器 `-c` 五旗 |
| `backfill.ts` | **attach-map 补齐**（P1-6）：自家日志反查老会话（ses_/sess_/uuid 三席判型），daemon 启动时补缺失键、不覆盖既有 |

tests/ 与内核一一对应（68 文件 460 测，含 2026-09-23 对抗审查回流批 +29 测：war_fail 重派/B3 身份门×5/B4 failed>0/B5 cron 门/B6 发布原子/B9 守卫/B11 定时停用/A1-A8/C1-C8 等）+ `prompts-snapshots/` 快照 fixtures + `staff-snapshots/`；`scripts/verify.mjs` 三段式验收门（+opt-in 旗面双跑矩阵）、`scripts/build.mjs` esbuild 构建、`scripts/live-check.ts` 实弹门（+opt-in 大副相位）。

## 架构铁律（改代码前默诵）

- **代理舰长是席位不是进程（D29 开放职位三实现）**：席位契约三条全在 daemon 侧——喂（proxyOrderFor 载荷：携史+账本切片+digest+块文法教学）/吐（结构化块，收割审计在 applyProxyReply 单源）/一轮怎么算完（未答判定+末条消息）。三实现同权同约束：舰队 CLI 席（spawn）、**外接席**（HTTP proxy/seats、order、reply+MCP --face proxy 座席面五件，token 哈希落盘、**身份门=在册∧在途祝福 proxyGateBless**——seatId 公开，只查在册可被伪造 agentId 冒用）、**内置 loop**（ai SDK 只读三件工具，STARDECK_PROXY_LOOP 默认 OFF，失手诚实降级舰队席）。座席面/loop 教学永不出现 war_claim/war_submit（快照+e2e 双锁）；澄清代答不做（药丸卡恒舰长亲手）。
- **舰桥频道（D26 默认脸面，v0.3.0）**：聊天窗=舰队全局单频道（不选会话/项目/工作区）。舰长发话 `POST /bridge/messages` 入 bridge.jsonl → staffTick 15s 出 **chat 工单**（staffOrderFor 第四参附页：未答新话+携史 24 条+digest 速览+对话纪律；命令工单照走，chat 缺席字节不变）→ 大副终答**全文**入 bridge（收割双写：finalStaffReply 单源取文，结构化块照旧入 directives）；**逻辑常驻、物理按需**——opencode/pi 席 chat-only 轮优先 resume（deliverVia* 原语，失败退避 2 分钟回落全新 spawn 携史）；**机械战报五触发**（reported/clarify/retry/terminal/scheduled，不跑模型，dedupKey 幂等）让频道保持活着；决策卡坞（澄清药丸/签发五项/验收证据卡）走既有通道（answer/plan/close），**验收与签发定夺归舰长，经理人不代签**（eval 监督用例一正一负钉死）；`STARDECK_BRIDGE` 默认 ON（=0 回退看板先行，旗 OFF 面与 0.2.x 字节等价）。
- **一次任务的完整环流（D27 双入口）**：入口一=聊天窗说目标→**代理舰长席**（daemon proxyTick 15s 哨位框定的无头回合，proxyOrderFor：persona+携史+digest 速览+D28 账本切片 ledgerSlice；无写工具面——只读通道只教 GET）拟【命令】块→daemon 收割成 draft 命令卡（issuedBy=proxy-… 审计）并入主流；【图景】块对账渲染成沙箱图页随话轮入账（scene.ts；对账失败=scene 战报）；管理块（撤令/重派/定时令停/绑席）全直落——B3 门 managementProxyGate 支线只放行作废语义、通过语义仍锁授权旗；入口二=看板 composer 直令（POST /commands，!!/?? 前缀照旧；或经舰桥频道由大副代下=历史口径已退役）→ **外聘大副**（daemon staffTick 15s 哨位自动框定的无头 opencode，纯舰务——D26 经理人段已回滚）**输入成熟度评估**（`inputMaturityOf` 四判型预评+任务书五项自检；缺关键项/涉舰长独有上下文→最终答复输出 `【澄清】（cmd-…）` 块——选择题式，附 A/B/C 选项与「你帮我定」，daemon 退场收割入账挂起 `directive_clarification_requested`——**等澄清不出单不罚时**；舰长经 `/commands/answer` 答复（channel 区分 board/bridge）→成案单带问答史重开，`【任务书】（cmd-…）` 五项一等入账 `directive_brief_ready`，DESIGN D23）→ 分诊 `war_triage`（D24 两档：L0/L1）→ L0 直发 `war_publish` / L1 任务书块输出后停轮→系统代开呈批件→**舰长会议室可编辑签发**（`directive_brief_signed`，定稿权绝对化；舰桥签发卡同权）→签发发布单→下一轮大副发布（作物化工作区+征召）→ daemon 框定 spawn 执行者（cwd=工作区 + `.stardeck/brief.md` + 项目级 opencode.json 注 MCP 桥——**bound 工作区逐键合并**，坏 JSON 拒绝覆盖）→ 执行者 `war_claim` 拿令牌 → 干活 → `war_submit` 交证 → KillCredit 核验 → **强制人工验收**（默认 reported 呈批，`staff-auto-close` 旗默认 OFF——定案 2026-09-01；舰桥验收卡是同一通道的对话面入口）→ `war_close_task` 收官 → 归档/释放/接力征召。**定时令到点由 staffTick 自动补 `directive_dispatched`**（宿主 30s tick 的独立形态替位）；大副干不成活退场（工单未清**或舰桥未答**）自动罚 2 分钟防重试风暴，超龄（默认 30min）熔断。
- **执行者进程即生命**：ExecutorRegistry 内存态，daemon 重启=全部视为失联；巡检（15s）回收失联（记败+重派或终局）+ 补征召（conscriptPlan 工作区互斥 + maxExecutors 满编判）。三适配器：opencode/pi 已验证；codex 契约实装、实机受阻于 codex-cli 自身 Windows 缺陷与 wire_api 变更（证据链见 README「执行者适配器」，0.44 无法 spawn node 常驻 stdio MCP 服——多轮探测确认）。
- **大副不是执行者**：无 attemptId、无 war_claim/war_submit（征召令点名禁教出口协议——tests/staff.test.ts 红线断言）；产出就是账本上的分诊/计划/发布。staffWorklist 的「等」是诚实语义：计划 pending=等舰长、**澄清挂起=等舰长答复**（DESIGN D23——工单不出单，退场罚时机械豁免），不出单。
- **defineTool 契约**：parameters 产物已是 JSON Schema 形状（`{type,properties,required}`）——MCP inputSchema **直通**，不要在平铺参数层重造（R0 首弹卡死在此）；执行前校验的错误文案（`invalid arguments: …`）是 agent 自纠通道，格式不许改。
- **静态服务双布局**：client.js/index.html 的候选路径要同时覆盖 dev（`here=src/`）与构建（`here=dist/`）两种模块布局。
- **板投影命令卡字段是 `commandId`**（不是 `id`）；任务卡是 `taskId`。
- 快照门：改任何提示词措辞=高风险变更，先改源、`WARROOM_UPDATE_SNAPSHOTS=1 node --import tsx --test tests/prompts-snapshot.test.ts` 再生成、fixtures 随改动一并提交评审。
- 与插件仓的同步纪律：内核文件（tools/dashboard/events/rules/prompts/persona/skill 等 1:1 文件）在插件仓修 bug 时应回流本仓（反之亦然），改前先 diff 两仓同名文件。插件仓本地路径 `C:/Users/kaiji/vibecodingKJ/projects/dsh-plugin-stardeck`（2026-09-01 本地改名，原 dsh-plugin-warroom；GitHub 远端名未动）。

## 本地开发

```bash
pnpm install && pnpm build      # esbuild 三产物（dist/cli.mjs + client.js + mcp-bridge.mjs）
pnpm start                      # 起 daemon（默认 http://127.0.0.1:3970，开发态 tsx 直跑；大副外聘默认开）
pnpm test / pnpm verify / pnpm live   # 测试 / 三段式验收门 / 实弹门（主环关大副防双发）
STARDECK_LIVE_STAFF=1 pnpm live      # +大副相位（draft 自动成案 + 定时令到点派发，5 断言）
STARDECK_LIVE_CONNECT=1 pnpm live    # +一行接入相位（opencode 真写盘+红线三查，4 断言）
STARDECK_VERIFY_MATRIX=1 pnpm verify # +旗面双跑矩阵（全旗 OFF 面也须绿）
cd desktop && npm install && npm run dev  # 桌面壳开发态（复用主仓 dist；electron 走本地缓存钉版）
cd desktop && npm run dist               # 出 win NSIS 安装器（release/）
```

- 实弹门外置前提：本机全局 opencode 已装且配好模型（`~/.config/opencode/opencode.json` 的 provider zai-coding-plan/glm-5.3——2026-10-20 z.ai 撤 glm-5.2 换 5.3 家族，配置已追加 `options.baseURL` 钉正端点+glm-5.3 条目，见环境坑）；可用 `STARDECK_MODEL` 覆盖（**D30 舰长令：测试实弹一律 glm-5.3-flash 省 token**）。
- 实弹门用隔离 stateDir（mkdtemp），跑完自清；PASS 10/10 才算交付。
- 端口惯例：daemon 默认 3970；live 门 3971；UI 目检脚本用过 3973；connect 测试 41710/41900；desktop 烟测 3992/3993。

## 验证体系（stop-manual-testing 纪律，继承 warroom）

| 层 | 内容 | 命令 |
|---|---|---|
| 确定性断言 | node:test + assert/strict，68 文件 460 测（fold/规则/工具链/路由/SSE/快照/大副工单/对抗审查回流批） | `pnpm test` |
| 回归门 | 三段式：tests + build + needle（正针脚产品面在场 + **负针脚零宿主引用**）；opt-in 旗面双跑矩阵（VERIFICATION.md §4） | `pnpm verify`（矩阵加 `STARDECK_VERIFY_MATRIX=1`） |
| 实弹端到端 | 真 opencode/GLM 外勤全链 10 断言 + opt-in 大副相位 5 断言（证据 `.goal/evidence/live/`，gitignored） | `pnpm live`（大副相位加 `STARDECK_LIVE_STAFF=1`） |
| 监督层 | **已接**（2026-09-01 自 dsh 插件版 1:1 移植 promptfoo 体系）：三维评分（achieve/evidence/boundary ≥7 + 越界一票否决），裁判=glm-5.2+隔离提示词；无网关 env 显式 SKIP 绝不放行；接线/坑录见 `eval/README.md` | `pnpm verify:eval`（env：OPENAI_BASE_URL/OPENAI_API_KEY，本机=LookatStudy/.env 的 Z_AI_* 映射） |

2026-09-01 验证体系诊断（stop-manual-testing）：ACI 2.1/2.2/2.3 全过（无 UI 可跑/账本留痕/原生接口，证据见 `VERIFICATION.md`）；缺口 **P0×2**（监督层缺位、§8.4 监督设计+§8.5 验收标准待填）+ P1×1（回归未做 flag=on/off 双跑矩阵）。修复按 `VERIFICATION.md` 附录清单推进。

## 环境坑（本机实况，继承 warroom 坑录）

- **win32 裸 spawn `.cmd` 垫片必死**（Node 安全补丁）：npm 全局 CLI 一律走包内 JS 入口经 `process.execPath`（executor.ts 的 spawnCli/detect*Bin 已内置；detectCodexBin→`@openai/codex/bin/codex.js`、detectPiBin→`@earendil-works/pi-coding-agent/dist/bundle/cli.js`）。
- **codex-cli 0.44 Windows 无法启动 node 常驻 stdio MCP 服**（2026-09-01 八变体实证：脚本参数/-e/文件配置/-c 覆盖/摘沙箱/无空格路径全灭，仅速退进程如 `-v` 能跑、OpenAI 自带 node_repl.exe 能起）；且 codex-cli 0.152+ 移除 `wire_api="chat"`（只认 Responses 面，z.ai 无——404 实测）。→ codex 执行者实弹换机或版本考古，勿再盲试。
- Git Bash 管道吃退出码——跑门一律 `> log 2>&1` 落盘再看（后台任务别接 `; echo`，会吞退出码）。
- node 解析不了 MSYS `/tmp`（curl -o /tmp/x 成功但 node require 失败）——临时脚本放仓库相对路径。
- 杀端口进程：`cmd //c "taskkill /F /PID <pid>"`（引号包裹才不被 MSYS 吃）。
- Git Bash curl POST 中文 JSON 会乱码入账——API 抽查一律 node fetch。
- Git Bash heredoc **即使引号定界符也吃反斜杠**（`\` 落盘成 `\`，正则字符类被打残）——含反斜杠的内容用 Edit/Write 工具落，不走 heredoc（附着面轮实测确认）。
- 浏览器自动化一律 Playwright（domcontentloaded + 等待，SSE 挡 networkidle）；截图取证存 `.goal/evidence/`。**同页重载不保证拿新 client.js**——no-store 也拦不住内存缓存（接线轮两次实测确认：新构建已上盘、页面仍跑旧 bundle），UI 改后验证须 `?cb=<n>` 强变更 URL 重载。
- **执行者侧 shell 编码污染战报入账**（2026-09-02 实测确认）：老账本里 `盘点工作区…` 战报带 U+FFFD 乱码——写入时已坏（executor 用 Windows GBK 控制台 curl 拼 war_submit；stardeck 读侧恒 UTF-8 无辜，板忠实渲染）。daemon 已设哨兵：war_submit 回执遇 U+FFFD 附 warning 提示改走 MCP/UTF-8 重交；坏数据本身板面无法复原，让执行者重交。
- 按钮接线红线（2026-09-02 全量审计立）：**独立形态不许 `services.sessions?.open` 裸调**（services.sessions 缺席=静默无操作，用户视角「按钮没反应」）——一律经 openStaffPane/openAttemptPane/jumpSession 双形态助手或 standalone 分支先 return；staffTarget 门控同理（老命令可无大副会话捕获，独立形态不等它）。
- **dashboard 的 send() 真实落码**（2026-09-23 对抗审查回流 C1，反转旧家法）：statusCode 写入真 ServerResponse——400/404/409/413/500 等按码出线，状态语义不再只藏在 body ok/error；测试断言状态码是对层。daemon 层（sendJson）本就真实落码。
- **live 门/测试起 daemon 必须隔离 STARDECK_CONFIG**（指到临时目录）：P0-2 起 POST /fleet 会写配置文件——不隔离会把测试绑定泄漏进用户全局 config（实测确认一次）；另 staff 相位模型串要 fleet-aware（pi=zai/glm-5.2，其余=zai-coding-plan/glm-5.3——pi 被灌 opencode 格式串起不来，实测确认一次）。
- **z.ai coding plan 撤型迁移（2026-10-20 实弹实抓）**：网关当日撤 glm-5.2 换 glm-5.3 家族（glm-5.3/glm-5.3-flash/glm-5.3-highspeed）——裸 chat API 对 glm-5.2 仍**静默别名**到 5.3（curl 看似通，掩盖撤型），但订阅 /models 清单已无 5.2，**opencode 客户端按实时清单校验直接拒**（表象=通用「Unexpected server error」，须 `--print-logs --log-level DEBUG` 才见 ProviderModelNotFoundError），且 opencode 1.18.5 内置 zai-coding-plan 端点对 5.3 家族 404——修法=`opencode.json` 追加 `options.baseURL=https://api.z.ai/api/coding/paas/v4` + glm-5.3 条目（glm-5.2 条目保留不删），stardeck 侧 live-check opencode 面默认同步切 5.3。诊断套路在档：裸 curl 通≠opencode 通（客户端校验层+内置端点两层差异）；本地 HTTP 转发代理抓 opencode 真实请求体是终局手段（项目级 opencode.json 覆写 options.baseURL 即可截获，注意剥 /v1 前缀防路径双拼、注意旧代理进程占端口）。**glm-5.3 风格差**：终答结构化块里五项标签常带 markdown 粗体（`- **目标**：`）——briefBlocksOf 已加强调包裹容忍（staff.ts BRIEF_LABELS），新解析器对模型输出风格变化保持「解析从宽」纪律。**2026-10-23 复测**：订阅 /models 实时清单=glm-4.5/4.5-air/4.6/4.7/5/5-turbo/5.1/5.2/5.3/5.3-flash/5.3-flashx（5.2 回归清单）；chat 实测本计划可用=5.3/5.3-flash/5.2/4.7/5-turbo 全 200，**glm-5.3-highspeed 与 5.3-flashx 均 429 code 1311「订阅计划未含」**（服务端真实存在但更高档位）——模型配置窗预设只放实测可用 id（highspeed 预设已拆），写死模型 id 的预设/测试串必须先探订阅可用性。
- **派生面要过语义关**：host-workspaces 拿 war_root 扫描派生=错（内部任务目录≠用户工作区），会顶掉 HQ 弹窗手动注册区（用户实抓）；独立形态「清单缺席→手动区」本就是正解，别手痒补派生。
- Node 在 Windows 上 process.exit 时 fetch 句柄未排干会崩 libuv 断言（UV_HANDLE_CLOSING）——CLI 面用 process.exitCode 自然退场，不硬 exit。
- **esbuild 对非法类型语法静默回退**（2026-09-06 实弹确认）：`new Promise<{kind:'x' as const}>` 的类型实参里写 as 表达式（=表达式语法进类型位置，非法 TS）——esbuild 不报错、把 `<...>` 回退解析成**比较表达式** `new Promise() < {...} > (...)`，运行时才炸「Promise resolver undefined is not a function」且行号误导；类型实参保持纯类型（字面量直接写 `'timeout'`），`as const` 只用在表达式侧。tsx 不做类型检查，tsc 门口也拦不住看不见的转换——这类坑靠「同形最小复现二分」定位。
- **codex 0.153 四坑（V19.13 实弹，DESIGN D21/D22）**：①**win32 新沙箱（restricted token）拦一切 exec_command**——workspace-write 下内联/写脚本/stdin 三连拒，适配器已平台分野（win32=danger-full-access）；②**exec 一次性形态 MCP 工具不进模型工具面**（deferred/tool_search 新架构；我们的桥与标准探测服、`-c` 与 config.toml、fallback 与目录 slug 全不露）——codex 席工具通道走 **http 面正典**（zcode 同款，简报教 STARDECK_HTTP 直连）；③**GLM 直驱靠垫片**：`stardeck codex-shim`（Z_AI_* env）+ `STARDECK_CODEX_SHIM_BASE=http://127.0.0.1:3975/v1` 起 daemon——适配器自动注入 provider 五旗；要完整模型元数据可 slug 骗面（`-m gpt-5.2-codex`，垫片改写真模型）；④**CODEX_HOME 必须隔离**（用户 ~/.codex 里 0.44 时代 chat-wire provider 会让 0.153 启动即硬拒）——codex spawn 一律 `codexHomeFor(workspacePath)` 工作区内自足空 home，不读也不写用户 ~/.codex。0.153.4 隔离前缀在 `clones/codex-0153`（全局 0.44 钉版不动；live 门 codex 相位按席 bin 走 STARDECK_LIVE_CODEX_BIN，别动全局 STARDECK_EXECUTOR_BIN——会误伤主环 opencode）。
- pnpm v10 默认拦构建脚本——本仓 package.json 已带 `pnpm.onlyBuiltDependencies: ["esbuild"]`，新装依赖若含 postinstall 需补白名单。
- **verify 全量并行下真 daemon 链路测试偶发快败**（D29 实录：外接席/矩阵 ECONNRESET、任务未物化等，单跑恒绿）——spawn daemon 的测试端口底数必须全仓独占（`41xxx+pid%50` 同底数在 win32 双 daemon 共听串话，已改 proxy-external-seat 旗 OFF 面=41510）；遇败先单跑+复跑再判真回归，别急着改产品代码。
- **happy-dom 渲染 harness 缺 ResizeObserver**（D29）——板坞测量件一挂即渲染崩（测试假白屏）；client-render.test.ts 已补桩，新组件用新浏览器全局时先查 harness。
- **electron 二进制下载慢→先翻本地缓存**（D30）：`%LOCALAPPDATA%/electron/Cache` 里常已有 win32-x64 zip（本机 44.3.0 命中）——desktop/package.json 直接钉缓存版本，install.js 秒过；CN 网络备选 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- **Electron chromium 级开关须放 app 路径前面**（D30）：`electron.exe --remote-debugging-port=9224 .` 才生效，放后面成了应用自有 argv（CDP attach 拿不到页面）。
- **.mjs 里手滑 TS 注解即炸**（D30）：`const f = (): void => {}` 在纯 JS 包=SyntaxError Unexpected token——desktop/ 是纯 JS 包，写完跑 `node --check`。
- **CHANGELOG 有历史段位**（D30 注意）：文件里 0.3.0 是 warroom 时代遗留段、新版本节插文件头不覆写；整文件重写前先 `grep "^## \["` 看段位分布。
- **本机 AppData 整条是 C:→D: junction**（D30 桌面壳三雷同源）：①ELECTRON_RUN_AS_NODE 下 import.meta.url=真身小写盘符（file:///d:/）而 argv 可给 junction 别名——cli isMain 恒假静默退 0，修=argv 侧 realpathSync+大小写归一比较；②Chromium ProcessSingleton 对 junction 化 userData 挂死/锁冲突（lock=false 或 0x20）——main.mjs 在 requestSingleInstanceLock 前 `app.setPath('userData', realpathSync(...))`；③历史探针遗孤进程握锁+lockfile 残留——排障先 `tasklist|grep stardeck` 全杀再删锁。**安装轮纪律：装前杀 stardeck.exe（NSIS 对运行中实例不替换文件）、装后杀 auto-run 实例（它握真实 stateDir）。**
- **electron-builder extraResources 双布局**（D30）：daemon 静态资源候选是 dist 的**同级** public/（npm 包 files 同构）——pack 只拷 dist 会让安装版 GET / 落 API fallback（"no route: GET /"），必须连 public 一起收。

## 降级面与迭代候选（2026-09-01 更新）

已接线（本轮）：**大副外聘**（draft/定时令全自动派发，`STARDECK_STAFF` 开关）；**bound 工作区配置合并注入**（逐键合并+首动备份+坏 JSON 拒绝覆盖）；**监督层**（promptfoo 三维门，`pnpm verify:eval`，自 dsh 插件版 1:1 移植+首弹已证）；**pi 执行者适配器转正**（源码仓契约实证+实弹门相位取证）；**codex 适配器契约实装**（源码实证注入面+argv，实机受阻记录在案）。

仍降级（README 已明说）：深编制（war_deploy_unit）/中途投递的**执行者侧**注入（pi=steer 帧已通；**板上答复双席已通**——pi RPC + opencode run -s 续跑，2026-09-06；其余席待接入）/批注转达仍 pi-only（relayTo）；staff-goal 不适用；**codex 席双席接通（V19.13 垫片 + http 面 + 隔离 CODEX_HOME；工具通道=http 面，MCP 工具面待上游，见环境坑）**；**gemini/qwen 双席不全降不可选**（D22 双席正典——外勤未实弹/半证+大副通道未建，转正条件写在席卡 note）。

候选（按建议顺序）：
1. **中途投递余下席**：板上答复/批注转达扩到 zcode（`--resume --prompt` 视察汇报模式可复用）/claude（`--resume <id> -p`）/dsh（tui resume 通道）——契约已在，逐席实弹取证。
2. GitHub 仓 + npm 发布（发版需定案——**2026-09-01 项目主已示「先不发版」**；npm 首发前在 npmjs 预登记 pending publisher——参照 warroom 的 release.mjs/OIDC 惯例可整体移植）。
3. 板 UI critique 轮（impeccable 双子代理，warroom 的 35/40 口径）。
4. codex 席收尾：MCP 工具面待上游 exec 路径（deferred/tool_search 架构不露工具，DESIGN D21 双证）；`codex exec resume <uuid> <prompt>` 中途投递接线（契约已实弹在档）。
5. 模糊输入集与监督用例扩容（VERIFICATION.md P2）：从 `.goal/evidence/live/` 实弹轨迹沉淀野输入语料；每道新特性补一正一负监督用例。
