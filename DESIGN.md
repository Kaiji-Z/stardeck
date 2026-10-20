# DESIGN.md · stardeck 决策录

按时间序追加；每条=背景 → 定案 → 理由。端口期（V0.1，2026-09-01）八条如下。

## D1 独立新仓（弃 monorepo-in-repo）

**背景**：stardeck 方向初议时倾向在本仓（dsh-plugin-warroom）孵化 monorepo（packages/core+daemon+plugin）。项目主 2026-09-01 改意：直接开新项目仓、插件留原仓。
**定案**：新仓 `stardeck` 独立立项；插件仓进守护态（只收 bug 修复）。
**理由**：前提变了——插件=稳定制品、stardeck=主产品。一仓一身份，README/CI/npm/版本号互不牵扯。分叉漂移（核心两边各一份）两步对策：短期靠「1:1 文件改动先 diff 两仓」纪律；远期本仓沉淀 core 包后插件改为依赖之，一次收编消灭双维护。

## D2 品牌=stardeck

**定案**（项目主 2026-09-01 选定）：stardeck · 星舰甲板。deck 双关=星舰飞行甲板（agent 起降调度）+ deck of cards（一副任务卡=看板卡组）——同时命中「舰队指挥」与「看板」两大产品特点；star- 全对产品正典词表（星域/星球/星舰）。npm `stardeck` 实查可用。淘汰记录：starboard/taskforce/wardroom/flightdeck 等被占；warboard/starlanes/stardock/bridgehead/sitroom 可用但语义偏弱或未织入看板特点。

## D3 defineTool 本地 shim（tool.ts）

**背景**：tools.ts 是 dsh-tools `defineTool` 的唯一宿主 import；其契约=参数描述→JSON Schema 编译 + 执行前校验（ToolArgsError `invalid arguments: …`）。
**定案**：写子集 shim（string/text/number/boolean/array + author 输出 schema 直通），错误文案格式与 dsh 对齐。
**理由**：全盘 vendor dsh-tools 的 schema 引擎（2000+ 行 DSL）不成比例；而校验错误是 agent 参数自纠的教学通道（B2 契约案教训：schema 与教学词不一致+静默剥参=agent 空转到死），格式必须保真。R0 实测确认：defineTool 产物 parameters 已是 `{type,properties,required}` 形状，MCP inputSchema 直通即可——在平铺层重造会产出空 schema，agent 端校验全拒。

## D4 daemon 装配层（cli.ts 入口 / 巡检语义）

**定案**：daemon.ts 是库模块（导出 startDaemon），cli.ts 是唯一入口；巡检（15s）双职责=失联回收（执行者进程死+任务 in_progress → 记败+重派/终局）+补征召（conscriptPlan 工作区互斥 + maxExecutors 满编）。
**理由**：独立形态下「进程即生命」——执行者是 daemon 的子进程，活性定义比 dsh 宿主（「已建会话」≠搁浅、重启才搁浅）更硬更简单，巡检不需要 B1 的 resume/nudge 复杂度。坑：spawn daemon.ts 会静默退出（库模块无顶层副作用）——入口必须是 cli.ts。

## D5 MCP 面=stdio 桥按工作区注入

**定案**：daemon 不开 MCP HTTP 端点给执行者；征召时把 `mcp-bridge.mjs`（stdio JSON-RPC）写进任务工作区的项目级 opencode.json（env 带 STARDECK_HTTP 回连地址 + STARDECK_AGENT 执行者身份）。
**理由**：stdio 是各 agent CLI 支持面最宽的 MCP 形态（opencode 实证）；身份随工作区配置注入，attemptId 令牌制天然承接 capability 语义。STARDECK_AGENT 透传到 daemon 的 tools/call → requireAgent，账本归属（claimedBy）即认它。

## D6 执行者适配器：opencode 先行

**定案**：ExecutorAdapter 接口（spawn 框定：cwd+简报+MCP 注入）+ opencode 首适配（`run --auto --format json --dir`）。征召令= prompts.ts 正典 commanderOrderFor + MCP 出口教学段（增量见 D7）。
**理由**：本机 opencode 已装已配模型（zai-coding-plan/glm-5.2）+ remote MCP 支持好 + `--auto` 免权限卡壳；R0 与 live 门两轮实弹全链证据。codex/pi 照接口续接（pi RPC 最干净，还自带中途投递通道）。

## D7 独立形态的出口教学增量

**定案**：执行者简报在正典征召令之后追加「stardeck MCP 接入面」段：war_claim/war_submit/war_fail 的参数形与 evidence JSON 形逐字给出。
**理由**：dsh 形态下宿主把工具 schema 喂给 agent；独立形态工具经 MCP 桥到达，桥给的是 JSON Schema——教学段是语义层补充（令牌完整携带/证据不伪造）。该段在快照门管辖外（executorBrief 是新资产，属本仓），改动需配 executor 测试。

## D8 零宿主引用负针脚 + 诚实降级面

**定案**：verify 门负针脚扫 src/tests/bin/scripts/public 的 import 层——任何 `@deepseek-ai`/`cordis` 出现即 FAIL。v0.1 降级面在 README 明说：深编制/中途投递未接线、定时命令不自动派发（需大副中继）、staff-goal 不适用、goals/relay/wake/quota 留作降级路径的类型载体（不删）。
**理由**：独立形态的完整性必须机检锁死（注释级提及无害，import 级零容忍）；降级面写明比静默缺失诚实——「面在但不撒谎」。

## D9 大副外聘=按需 spawn 的引信替位（2026-09-01，HANDOFF①）

**背景**：独立形态没有宿主 relay 面——draft 命令与定时令（到点 `directive_dispatched`）都无人处理，v0.1 靠「能调 MCP 的外部 agent」手动中继。候选形态：常驻大副会话 vs 按需 spawn。
**定案**：`src/staff.ts` + daemon `staffTick`（15s 哨位）——工单判定（`staffWorklist`：终态/未到点/计划待批不出单）非空且大副不在役 → 框定 spawn 一轮无头 opencode（作战位 `<stateDir>/staff`，复用 `spawnHeadlessOpencode` 框定法）；轮内办结即退场，下一轮按新工单再起。
**理由**：与「执行者进程即生命」同构——无常驻会话状态可失联，挂死由超龄熔断（默认 30min）兜底；等舰长定夺（计划 pending）不出单，轮次天然贴合「分诊→呈批→（批准后新一轮）发布」的断点多轮语义。退场工单未清算罚 2 分钟（防 received-未分诊单的 15s 重试风暴）。大副红线：无 attemptId/war_submit，征召令点名禁教出口协议（快照+断言双门）。已验证（live 门大副相位 5 断言：两轮大副接力、定时令到点派发、外勤全链、KillCredit、收官）。

## D10 bound 工作区配置=逐键合并+首动备份（2026-09-01，HANDOFF③）

**背景**：v0.1 对任务工作区直写覆盖 `opencode.json`——全新工作区无害，bound（绑定既有项目目录）会毁用户配置。
**定案**：`injectOpencodeMcp`：无既有文件=直写；有=JSON.parse 后只覆写 `mcp.stardeck` 一项（其余键含 `mcp.*` 原样），首动前原件备份 `.stardeck/opencode.json.pre-stardeck`（只备一次保最初原貌）；坏 JSON 拒绝覆盖抛教学错误（征召失败走排队/巡检补征，不静默丢配置）。
**理由**：AGENTS 候选③曾议「写 .stardeck/opencode.json+文档指引用户并轨」——但 opencode 不发现该路径，等于把合并负担推给用户；程序化逐键合并才是「stardeck 不越界毁用户世界」边界的如实执行。幂等性必要：同工作区二次征召 agentId 变更，必须可刷新。

## D11 codex/pi=面在但不撒谎（2026-09-01 上午，HANDOFF② 首刀）

**背景**：候选②要求续接 codex/pi 适配器；本仓交付机只装了 opencode——未实弹的 CLI 接线（参数面/配置面）写出来就是臆造，违背 R0「验证先行」精神。
**定案**：`ADAPTERS` 注册表三席：opencode 实弹；codex/pi 的 spawn 落教学错误。**（同日午后被 D12 取代：定案克隆上游源码仓后契约实证，适配器实装。）**

## D12 源码实证的适配器实装 + pi 扩展面（2026-09-01，HANDOFF② 二刀）

**背景**：定案把 codex/pi 上游仓克隆到本机（`projects/codex`=openai/codex、`projects/pi-mono`=badlogic/pi-mono），「实际迭代」适配器。臆造禁令由此升级为可验证作业：一切 CLI 旗标/配置格式/协议帧以源码与文档为准并注明出处。
**定案**：
- **pi**：`pi --approve -p`（一次性；`--approve`=无头放行项目扩展，security.md:29）+ 项目级 `.pi/extensions/stardeck-tools.ts` 注册 war_claim/war_submit/war_fail（pi 无 MCP，扩展即集成面；typebox 契约 extensions/types.ts:449）。简报走 `pi-extension` 接入面措辞分叉（executorBrief face 参数）。中途投递预留 RPC 模式（prompt/steer/follow_up/agent_settled，rpc.md 全文实证）。
- **codex**：`codex exec --json -C --sandbox workspace-write` + MCP 注入走 **`-c` 命令行覆盖**（版本稳定通道；项目级 `.codex/config.toml` 是 0.152 特性，0.44 不加载——实测确认）；TOML 值语义坑：args 用 JSON 数组语法可、env 必须内联表 `k = "v"`（JSON 冒号语法被当字符串，二弹实测确认）。模型供应商直通 `-c model_provider=X`（config 新增 `modelProvider`/`STARDECK_MODEL_PROVIDER`）。
- **win32 spawn 纪律**：npm `.cmd` 垫片禁裸 spawn（Node 安全补丁）——detect*Bin 解析包内 JS 入口，spawnCli 统一经 `process.execPath`；.cmd 配置给教学错误。
**实弹战果**：pi 全链 PASS（实弹门执行者相位 5 断言）；codex 受阻于 codex-cli 自身——0.44 Windows 无法 spawn node 常驻 stdio MCP 服（八变体探测：capture 服 BOOT 文件从不出现），0.152+ 移除 chat wire 且 z.ai 无 Responses 面——诚实记录，换机/版本考古再战。
**理由**：验证先行的落地形态=「源码证据→实装→单测锁死→实弹取证」四段；实弹被外部依赖挡住时，把阻塞点钉到证据级精度比降级断言更有迭代价值。

## D19 codex 0.153.4 版本考古：MCP 阻碍解除，模型层成唯一锁（2026-09-06）

**背景**：上游 codex 高频迭代（0.44→0.153.4 跨 100+ 小版本），按元首令拉最新稳定版复核适配面。0.153.4 装隔离前缀（`clones/codex-0153`，全局 0.44 钉版不动），上游克隆 checkout `rust-v0.153.4`，探测脚本 `.goal/codex-probe/`（capture 服 BOOT 判据承 D12 八变体法）。
**定案（证据五条）**：
- **MCP spawn 阻碍已解除**：0.153.4 换 rmcp 客户端（tokio::process）——Windows 上 node 常驻 stdio MCP 服完整握手成功（BOOT 出现 + initialize→initialized→tools/list 全链，LOG-*.txt 在案）。**两条通道都验：CODEX_HOME config.toml 与我们适配器的 `-c` 三键注入（生产通道）都直通**。0.44 阻碍是版本缺陷非形态缺失，此判定成立。
- **适配器契约零破坏**：`exec --skip-git-repo-check --json --sandbox workspace-write -C -m -c` 全部实弹受认；JSONL 事件流带 `thread.started`（thread_id=UUID，backfill 捕获判型兼容）；rollout 落盘布局不变（`sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`，history 读取器兼容）；顶层 `codex resume [SESSION_ID] [PROMPT]` 在（跳窗契约兼容，且新增 `--last`/线程名）。
- **chat wire 永久移除**：`wire_api="chat"` 运行时硬拒（"no longer supported"，官方迁移指引 discussion 7782；源码 `WireApi` 枚举仅剩 Responses）。中途投递契约转活：`codex exec resume <uuid> <prompt>` 已存在（待接线）。
- **模型层=本机唯一残余锁**：z.ai 无 Responses 面（`{Z_AI_BASE_URL}/responses` 404 复测 2026-09-06）且 codex 只认 Responses——GLM 直驱 codex 仍不可行。解锁路三选：本机 Responses→chat 垫片代理（自写 node 垫片或 LiteLLM）/ z.ai 出 Responses 面 / 换 OpenAI 鉴权机。
**理由**：版本考古的价值在把「阻碍」钉到证据级——0.44 时代的「codex 阻碍=环境锁」结论要随版本更新重判；这次 MCP 面已解锁，工具桥、会话捕获、跳窗、投递四条契约全部就绪，只差模型供给一刀。

---

## D20 板上答复 opencode 席：run -s 续跑的受理语义（2026-09-06，P0-1 收尾）

**背景**：P0-1（2026-09-02）板上答复只走 pi RPC——大副默认席 opencode 反而被拒（「其余席的续跑通道待接入」）。插件仓 M2-件B 同期在宿主形态用 followup 收件箱实现了同语义（方向独立演进，结论同构：板上作答→会话续跑）。

**定案**：
- **通道**：`opencode run -s <会话> --auto --format json --dir <工作区> <答复文本>`——一次性续跑进程，与 pi RPC 的差异=无受理回执面（opencode CLI 无早期 ack）。**受理语义改为「活过观察窗」**：默认 5s 内非零即退（会话号失效/参数被拒）=如实败；活过窗=受理成立，settled=真退场（code 0=消化完），15min 上限 kill 诚实放弃（pi 同款）。即退 0（窗口内速答完成）=受理且已消化。
- **免重注入**：工作区 opencode.json 的 stardeck 桥自原次 staff spawn 已在；续跑进程加载同一项目配置。agentId 是不透明标签（daemon tools/call 无注册表活体校验，缺省 anonymous）——旧 agentId 照用，不重写配置。
- **审计**：directive_answered 事件 channel='opencode-run'（pi 路径 'pi-rpc' 原样）；单飞守卫（answering set）持续到 settled——防双进程续跑同一会话文件。
- **wrapper 共用**：`【舰长答复】<文本>\n（请继续按既定流程推进…）`——pi/opencode 同一段（措辞属 daemon 层非提示词资产，快照门不涉）。

**坑（已录 AGENTS）**：esbuild 对 `new Promise<{kind:'x' as const}>` 的非法类型实参静默回退成比较表达式——运行时「Promise resolver undefined is not a function」且行号误导；同形最小复现二分定位。

**证据**：steer.test 8/8（观察窗三态 stub 级 + daemon 级 opencode 席投递——stub 双面化按 argv 分形）；verify PASS；实弹 scripts/live-answer-oc.ts——真 opencode 会话 ACK1 → 续跑 settled → sqlite 历史同会话双回合 ACK1+ACK2（上下文存续实锤）。

**余下席（候选①续）**：zcode（`--resume --prompt` 视察汇报模式）/claude（`--resume <id> -p`）/dsh（tui resume）——契约在档，逐席实弹后放开拒绝闸。

---

## D21 codex 垫片转正：GLM 直驱 codex 的解锁刀（2026-09-06，V19.13）

**背景**：D19 判定「模型层成唯一锁」（chat wire 永久移除 + z.ai 无 Responses 面）。解锁刀=Responses→chat 垫片：codex 说 Responses、垫片翻译成 chat/completions 打 z.ai，GLM 话音直驱 codex。

**定案**：
- **垫片**（src/codex-shim.ts）：翻译纯函数（请求/应答双面，协议形状按 rust-v0.153.4 源码钉死——SSE 帧按 data JSON 的 `type` 判型，最小闭合面 created→output_item.done→completed，usage 字段 input_tokens/output_tokens/total_tokens）+ 回环 HTTP 服（仅绑 127.0.0.1，key 只进本进程内存永不入 codex 配置）。启动=`stardeck codex-shim`（--upstream/--key 或 Z_AI_* env，缺 key 拒启）。适配器接线=config `codexShimBase`（env STARDECK_CODEX_SHIM_BASE），非空时 codexExecArgs 注入 provider 定义五旗（压过裸 modelProvider）。
- **slug 骗面**：`-m` 传目录内 slug（如 gpt-5.2-codex）可拿完整模型元数据，垫片 `model` 参数把实际请求改写真模型——glm-5.2 与目录 slug 双验均可完成回合（fallback 元数据也能跑，前者仅报一条 metadata warning）。
- **win32 沙箱分野**：0.153 新 Windows 沙箱（restricted token）把 exec_command 全拦（实弹三连拒：内联/写脚本/stdin 全灭）——workspace-write 在 win32 等于废人。codexExecArgs 平台分野：win32=danger-full-access（stardeck 执行者本与 opencode/pi 同级全权），其余平台维持 workspace-write。
- **工具通道=http 面正典（zcode 同款）**：实弹双证（我们的桥 24 工具 + 标准探测服 1 工具）——0.153 `exec` 一次性形态下 MCP 工具**不进模型工具面**（deferred/tool_search 新架构，`-c` 与 config.toml、fallback 与目录 slug 四组合全不露）。codex 席的 stardeck 工具通道走 HTTP 直连（简报教法与 zcode http 面同款），MCP 工具面待上游 exec 路径修复后再换回。
- **已知限**：/responses/compact 压缩面未实现（诚实 404，长会话触发时 codex 报错不崩）；翻译为整件直达（无增量 delta——codex 兼容）。

**证据**：codex-shim.test 6 测（翻译双面+服务器集成+provider 五旗）+executor-face 扩测（沙箱分野/垫片优先/裸 provider 压制）；实弹 scripts/live-codex-shim.ts 5 断言 PASS——相位①模型线（codex→垫片→GLM 真话音「收到」）+相位②舰队线（隔离 daemon 种子任务，codex 经 http 面查账本报出 ZEBRA-PROBE 任务号——不经账本链不可能知道）。

**理由**：垫片把「等 z.ai 出 Responses 面」的不可控等待变成 3975 端口上的一把本地锁；MCP 工具面不进模型列表是上游 exec 形态的新阻碍，但 zcode 已立 http 面正典证明这不是席位级障碍——codex 席自此实用可用。

## D22 双席正典：可选舰队=大副+外勤双接通（2026-09-06，舰长令）

**背景**：舰长令——「大副和执行一定要都接通到舰队选择才行；只有外勤能接通、大副不能接通的舰队不能作为稳定舰队」。此前 codex/dsh 绑定后大副由 opencode 代跑（staffExecutorFor 资格闸），gemini/qwen 挂实验性可绑但双席都未实证。

**定案**：
- **可选判别式**：`bindableSeatIds = adapter 实装 && staffReady`——staffReady=大副+外勤双通道实弹接通。POST /fleet 硬校验 + 绑定门 UI（fleet-gate seatStatusOf：staffReady=false 落 absent 档，说明由席卡 note 承载）。
- **codex 大副转正**（新 dispatch spawnHeadlessCodexStaff）：staff 简报 face=http（exec 形态 MCP 工具不进模型面——D21 双证，不注桥）+ shim provider 五旗 GLM 直驱 + 模型串归一（provider/id→裸 id，dsh 同款）+ `thread.started` 行钩捕获会话号入 attach-map（键=staff-<id>）。executor 侧同轮修正：codexAdapter 简报改 face=http、STARDECK_HTTP/AGENT env 直接挂 agent 进程、撤死重注桥。
- **dsh 大副放闸**：dispatch 已在（staff.ts），staffExecutorFor 放行 dsh——http 面通道与 zcode 同构。
- **claude 大副**：dispatch 与资格闸早已在（mcp 面，.mcp.json 注桥），本轮补实弹。
- **gemini/qwen 降不可选**：adapter 在场但 staffReady=false（外勤未实弹/半证+大副通道未建）——席卡诚实说明转正条件，契约档案保留。
- **可选席名册（V19.13 后）**：opencode / pi / codex / zcode / claude / dsh 六席；copilot/amp/cursor/droid 契约席照旧。

**证据**：staffExecutorFor/fleet 双测更新（22 测）；三席 staff 相位实弹（`STARDECK_LIVE_STAFF_EXECUTOR=codex|dsh|claude`，codex 带 shim+按席 bin 变量 STARDECK_LIVE_CODEX_BIN 防全局逃生阀误伤主环 opencode）——结果见本轮 verify 记录。

**理由**：大副是舰队的参谋岗，绑定门把「能干活」当可选标准却放行「只能干活不能参谋」的席，等于舰长每次都要吃一行「大副由 opencode 代跑」的暗降级——双席正典把这个语义摆上台面：接不通就别选，选了就全通。

---

## D23 大副澄清协议：任务书一等公民 + 舰长命令的输入成熟度闸（2026-09-08，舰长令）

**背景**：舰长诊断——项目直接落地了「下令→分诊→执行」的后半程，缺了「对话想清楚」的前半程。大副拿到的命令是舰长随手打的自然语言，垃圾进垃圾出：缺验收标准的命令被硬派活，外勤以高效率做错事。relayPrompt 里「提问卡片问舰长」的澄清教学在独立形态机械缺位——外聘大副是无头一次性进程，问题问完即随进程蒸发，无人接住。

**定案**：
- **任务书（brief）一等账本事件**：`directive_brief_ready`（五项：目标/背景与约束/验收标准/非目标/交付物），fold 入 `Directive.brief`（后写覆盖）。任务书先于计划存在、独立于发布审计在案——计划稿只留结果，任务书留下「怎么谈拢的」。
- **澄清回环走「账本即状态」，不走会话续跑**：大副无头退场时 daemon 经 attach-map + `readSessionHistory` 读其最终答复，解析结构化块入账——`【澄清】（cmd-…）` 编号列表 → `directive_clarification_requested`（fold 挂起、round 由 fold 推导重放稳定）；`【任务书】（cmd-…）` 五项标签 → `directive_brief_ready`。舰长经既有 `POST /commands/answer` 答复 → `directive_clarification_answered` → worklist 出**答复成案单**（`kind:'resolve'`，携带原文+问答史+轮次）→ 全新大副进程带完整上下文定案。选重开而非续跑（deliverViaRpc/run -s）的三个理由：①账本即状态是本仓家法，冷启动上下文由工单原文携带，不依赖会话文件存活；②与成案轮天然无双发；③**全席通用**——不挑 pi/opencode 的续跑通道，zcode/claude/codex/dsh 大副同轮获得澄清能力。
- **输入成熟度预评（启发式，非裁决）**：`inputMaturityOf` 四判型（vague/missing-acceptance/missing-nongoals/mature），关键词启发式只调制征召令指引（缺什么点什么），最终问不问由大副按起草法自行判断——无歧义细节可自行补全的照常成案，不强问（问多了仪式吃掉小任务）。
- **等澄清不出单=罚时豁免**：worklist 对 pending 澄清零出单，staffTick 退场罚时分支（length>0）天然不触发——「等舰长」不是「干不成」，不罚。答复后 answered+未呈计划才出成案单；成案动作（triaged/plan_opened/decomposed）清账，常规路由接管。多轮收敛由 fold 累计 round，第 2 轮起征召令明文「必须定案或弃案，不得再问」。
- **五项缺一即弃**：任务书块解析强排完整性——半本任务书比没有更危险（误导成案轮）；澄清块零问题同样弃块，工单重试语义接管。
- **收割防幻觉写账**：块点名的命令号必须在本轮工单在册（knownIds），未知号一律忽略。
- **第一刀不做会议室 UI**：问题可见性走既有板上答复面（talking 命令卡）+ 大副会话历史弹窗；板=读投影不动，舰长写操作只经 composer/答复通道。投影字段与专用会议 UI 留给后续刀。

**边界**：不碰 war_* 出口协议 24 件、不碰 KillCredit、无新依赖、账本向后兼容（旧日志无澄清/任务书事件照常 fold；`directive_answered` P0-1 语义原样保留，澄清答复走独立事件类型）。

**完整形态段（2026-09-08 第二刀，V21.1）**：
- **板上闭环 UI**：聚焦页 talking ghost 面板直接渲染 `cmd.clarification`——pending=「大副第 N 轮提问（等你答复）」+编号问题列表（ol.war-clarify-q）+答复框同卡（读完即答，不再绕道会话历史弹窗）；answered=问答史留卡+「答复已入账」定案提示。`cmd.brief` 五项卡（war-brief-card）与 ghost 面板并列：目标/背景与约束/验收标准/非目标/交付物逐行结构化（非目标是防跑偏的关键项，单独成行）。「等舰长」的板面可辨性由既有 ghost 卡（⚠+等你答问 warn 态）承载。
- **双语**：新键入 `focusPage` 子典（接口+warCopy/plainCopy/enWarCopy/enPlainCopy 五处；trek 词表自动派生），皮肤术语分野照三皮正典（war=大副、plain=规划 Agent）；copy-lang 完备性锁自动管辖。
- **机械闸**：`CLARIFY_ROUNDS_CAP=2`——与征召令纪律「第 2 轮起必须定案」同数。harvest 拆纯核心（`staffHarvestEventsFromText`：解析+闸门，可直测）与 glue（`harvestStaffDirectiveEvents`：attach-map+history 读取）；过限澄清请求不入账、`rejectedClarifications` 如实上报（daemon console.warn）。混合文本（任务书+澄清同卡）成案优先：任务书入账、澄清静默弃（都成案了就不该再问，无需告警）。命令停在 answered 态、成案单持续出——不死锁、不被系统单方面弃案。
- **证据**：UI 目检四截图（zh pending/zh answered+brief/zh brief 卡/en pending）落 `.goal/evidence/ui-*.png`（人可读亲看）；渲染断言入 client-render.test（pending 问题列表+答复框同卡/answered 问答史/brief 五项/无澄清不受影响）；机械闸三态单测（撞闸/未超限/恰在闸上/混合成案优先）。

**第三刀（2026-09-08，V22.1–V22.5）：选择题式收敛——追问附选项 + 「你帮我定」 + 强目标翻译显性化**。舰长定调会议室形态：**目标指向明确的场所，不为聊天而聊天**——所有人都为了一件事：把模糊命令做成强目标；**全席可用**（账本即状态回环本就不挑席，维持）；**2 轮闸保持**；追问从开放题升级**选择题式**（选项降低舰长打字成本，「你帮我定」=委托大副自答的信号）；**强目标翻译显性化**（成熟命令的审核+翻译产出任务书也是显性动作，入账可见）。
- **正典格式**：问行 `N. <问干>？A <选项一> / B <选项二> / C 你帮我定`（至多 3 问；给不出候选=开放问照旧）；舰长答复语法 `1A;2B;3 <自由文本>`，复用既有 `POST /commands/answer`，无新端点。事件侧 `directive_clarification_requested` 增可选 `options?: string[][]`（问 i 的选项数组；「你帮我定」原样入账），fold/投影/渲染全链 optional——老账本零迁移。
- **解析从宽**：`splitAskLine` 认 ` A` 标记段（`/\s?A[.、::]?\s+(\S.*)$/`，容忍标记前无空格——GLM 实测风格）、按 ` / ` 拆项剥 B/C 前缀；标记识别失败=开放问（text=整行，不硬拆）；无选项=开放问（options=[]）。任务书块同轮补**markdown 列表变体**容忍（`- 目标：…` 且标签间插括号注释，V22.4 实弹抓：GLM 不守纯标签行）。
- **板上点选拼装（人机共编）**：选项渲染药丸钮（`.war-clarify-opt`，选中 `.war-clarify-opt-on`），点选即把 `N<字母>;` 拼进答复框（再点同题他项=换选，去重不堆叠），自由文本照旧可混排——选择题降的是打字成本，不是表达自由；`war-clarify-opt` 令牌全部取自已定义 CSS 变量（war-tokens 闭包测试管辖）。
- **翻译显性化（V22.3 实弹抓）**：GLM 对成熟命令无视『也要输出任务书』的弱指引——publish 分支与办结纪律双处强化为硬约束「**发布成功后，最终答复末尾必须输出该命令的任务书块；缺块的办结不算办结**」，成熟命令（含快道）的任务书 `directive_brief_ready` 照常一等入账（live 断言 cmdA 翻译显性化）。
- **收割闸适配**：机械闸照旧（2 轮上限对选择题/开放题一视同仁）；knownIds 防幻觉照旧。
- **证据**：live 双相位 PASS（opencode 29/29、pi 30/30，断言升级：追问 2/2 含选项+cmdA 任务书入账）；UI 目检 zh/en 截图（`.goal/evidence/ui-clarify-choices-{zh,en}.png`——选项药丸+点选拼装「1A; 2C;」取证，Playwright 断言 6 钮/选中态/拼装串/零 pageerror）。

**第四刀（2026-09-08，真会议室）：收敛机制升格为「场所」**。舰长定的三条差距（场所感弱/共识不可见/过程态缺席）一次性收敛，全程零新写端点、提示词资产零改动：
- **场所感**：聚焦页新增独立「会议室」段（`data-stage="meeting"`），插在命令段与任务段之间——命令→对话→任务的时间顺序长在布局上；段头=场地名+动态结论，段首一行**场所铭**（「这里只做一件事：把模糊命令收敛成强目标。」——舰长定调上墙）。
- **共识常驻（时间轴）**：会议室体内是竖线时间轴——每轮问答一块（问题+选项药丸/已答复的舰长答复行），任务书五项卡作为会议产物收尾，**不等成案全可见**。数据面=新增 `Directive.clarificationRounds` 只读派生（requested 追加、answered 回填；成案动作只清 clarification 活动态，历史轮次保留），经投影 `clarificationRounds` 下发 `BoardCommand`；渲染层对字段缺席先归一（undefined→null）再从活动态**回退合成单轮**——老投影/夹具不空转（`undefined !== null` 为 true 的 JS 陷阱实弹一抓，全 FocusPage 渲染崩、四田测齐红才照出）。
- **过程态**：`clarification.status==='answered'`（答复已入账、成案单在途）派生两处显示——段头结论「成案中——大副正带你的答复重开」+ 体内 `⏳` 行（`role=status` 播报）；成案动作落账后自然消失，历史转档案。
- **ghost 让位**：任务段 talking ghost 不再展开问答面板（防两处同屏），点击滚动到会议室；talking 无澄清（大副还没开问）也开会场——空场给预期行，P0-1 答复 composer 从 ghost 面板搬进会场（通道不变）。
- **监督层首批澄清协议用例**：eval/tests.yaml 增 4 条——正例两条=协议两腿（悬空指代→该出澄清块；成熟命令→直发+任务书五项入账），负例两条=职能越界（大副亲自写码宣称完成）与回环诚实性（编造舰长答复/绕过验收收官）；判据不放宽（正=三维≥7 无 veto，负=veto 或任一维<7，无真判决 JSON 双向都不过）。首跑 6/6 全过。
- **证据**：渲染断言三态+多轮时间轴+场所铭+role=status（client-render，全量 414 测）；UI 目检三截图（zh 会议室点选拼装/zh 过程态元素特写/en 会议室）落 `.goal/evidence/ui-meeting-*.png`；live 双相位退出码 0（29 断言原样无回归）。

## D24 两档制：L1 签任务书（2026-09-08，舰长令）

**背景**：会议室（D23）落地后，L1/L2 的立身之本——「舰长不放心大副的定义，用批『计划』补定义不可控」——被正面接管。计划呈批成了冗余器官：呈批件是「怎么干」的计划（大副的纸上谈兵，舰长通常秒批），而舰长真正在乎的「要什么」（任务书）反而不经批准；且与定位口号「别人管 plan，我们管作战会议+交账」自相拧巴。舰长定案 B 案：**分诊改制两档制，L2 退役，L1 的呈批件从「计划（怎么干）」换成「任务书（要什么）」**，并注入 find-my-goal 定稿语义——出了强目标文字，用户还有最后的修改权。

**定案**：
- **两档制**：L0 直发（默认全自动，事后 KillCredit+强制人工验收兜底）/ L1 签任务书（签发档：事前刹车，供不可逆删除、删改共享或系统文件、大范围重构等风险动作）。L2 退役（深编制本就半死；类型保留 'L2' 仅为老账本 fold 兼容，分诊正典与改档 UI 不再产出）。
- **呈批件=任务书本身**：L1 分诊后按起草法成任务书块即停轮（不 war_plan 不 war_publish），daemon 收割后**代开呈批件**（`directive_plan_opened`，文本=五项渲染）；war_publish 硬门（plan approved 才放行——工具侧协议原样）机械背书「未签发不发布」。war_plan 协议保留但新流程不再路由。
- **定稿修改权（find-my-goal 语义）**：会议室里五项卡以**可编辑文本域**呈批；签发（`directive_brief_signed`，可携逐项修改文本+附言）是发布的唯一依据，发布工单「逐字照抄不改写」；`brief_ready` 原稿保留不覆盖——谈的是什么/签的是什么，两笔审计链。签发通道复用既有 `/commands/plan`（approve 携可选 brief 五项；reject 带意见回会议重拟），零新端点。
- **舰长定稿权绝对化（实弹抓）**：大副可能按 war_plan 工具描述遗留走旧呈批来路（直呼 war_plan 而非输出任务书块）——签发门对两条来路收敛：携修改文本时无论原稿在不在都落签发（发布逐字照抄签发文本）；未携修改且原稿在 → 照原稿签发；旧 plan 流程无修改 → 维持旧发布语义。驳回重拟（plan_rejected → 重拟工单携原稿五项+意见）**不吃澄清 2 轮闸**——那是舰长主动驱动的收敛，机械封顶是替舰长做主。
- **??先看方案 改映射 L1**（原强制 L2，其语义由签发流吸收）；composer「先看方案」档位卡文案同步签发语义；改档 UI 只剩 L0/L1。
- **会议室门条件扩展**：待签/已签命令状态常停在 received（无澄清翻转）——`meetingActive` 纳入 awaitingSign 与 briefSigned，否则签发后整段消失（UI 目检实抓）。

**边界**：war_* 24 件零改动（硬门/工具面原样）、KillCredit 与 SSE 语义不碰、persona/skill 资产不动（relayPromptFor 分诊段属 staff 正典，快照重生成随提交）、依赖零新增。老账本双向兼容：旧 plan 流程（呈批件=计划稿、无任务书）照旧走决策带批准/发布；历史 L2 卡照常显示。

**证据**：426 测（新增 brief-sign 专项 7 测：fold 两笔审计链/待签不出单/签发发布单逐字/重拟单携意见/markers；路由签发 4 测含定稿权绝对化与 400 面；渲染待签 2 测）；staff/prompts 快照重生成随提交；UI 目检 `ui-l1-sign-*.png`（zh/en 待签可编辑卡、签发后定稿卡+结论翻转，Playwright 断言签发 POST 携舰长定稿文本）；实弹双相位 L1 相位全链 PASS（?? 命令→呈批挂起不发布→API 签发携 LIVE-L1-MARK 修改→发布任务 brief 逐字含标记→外勤交卷收官；pi 相位 35/35、opencode 见 CHANGELOG 当轮记录）。

**理由**：L1 的不可替代位置是「在开工前、用最低认知负担（五项卡逐项看+改）给不可逆动作一个事前刹车」；刹车闸门上放的东西应该是舰长真正在乎的「要什么」，而不是通常秒批的「怎么干」。两档制之后五段语义彻底干净：命令与任务之间的全部对话（澄清+签发）都发生在会议室，任务段之后全是工作。

---

**理由**：委托式的代价是每跳有损转译，而最大的损耗发生在入口——命令的模糊性如果在计划层被消化，误差是 minutes；漏到执行层，误差是整轮征召。stardeck 的差异化主张由此从「别人管分工，我们管交账」扩为「**别人管 plan，我们管作战会议+交账**」：plan mode 在别家长在执行 agent 身上（自己澄清自己，既当运动员又当裁判），本仓把澄清职能还给参谋岗——大副的正名。

---

## D25 Jev（System One）适配调研：定位收窄为「参谋信号」——五个 advisory 落点 + 两段 spike（2026-09-23，舰长令「研究可能性」；**议案待批，未实施**）

**背景**：插件仓 HANDOFF（2026-09-23）对 Jev 有初判（最强契合=分诊预判「明显 L0 一次前向直接放行省整轮大副」）。舰长令本仓调研可行性。本条目为调研定案：外部核实（官方文档/独立实测/开源生态）+ 本仓接缝核对，结论对初判做了一处核心修正。

**调研核实的事实底座**（来源：TypeSafe 官方文档与 launch post、OpenRouter 指南、独立实测三份 [TrueStandard 108-claim / Every / Near Here]、HN 49765348、开源模型卡）：

- **本体**：TypeSafe AI（Diogo Almeida，ex-OpenAI InstructGPT/GPT-4）2026-09-15 发布，$40M DCVC。非生成式：入参=`state`+typed `questions`，出参=类型化答案+概率分布+置信度，零文本零 JSON 解析。三原语：**Choice**（≤255 选项，回选项+逐项概率+confidence）、**Score**（2-10 级有序量表，回概率加权分位+confidence）、**Noul**（是非断言，回单一概率，无独立 confidence——阈值自理：`noul>0.9 放行 / <0.1 拒 / 中间带交人`）。**单调用内多问并行求值，时延几乎不随问题数增长**——对本仓 fan-out 场景（逐条筛、逐项问）是最有用的工程性质。
- **商业面**：`POST api.typesafe.ai/v1/systemone`（或 OpenRouter 双面）；$0.042/MTok 输入、输出免费；32k 上下文；70-500ms。发布 8 天，waitlist/alpha，官方自认定价「无法证明不是补贴的」。
- **诚实的边界**（官方自查+独立实测双确认）：①「零幻觉」=schema 合规（不可能输出名单外的值），不是正确性——创始人自己承认可 "confidently wrong"；②RLCD 校准声明**无公开数据**（无 ECE/Brier/可靠性曲线），独立 108-claim 实测 ECE 与便宜 chat 模型打平（0.066 vs 0.061/0.067）——但**难例（对抗近似）上 Jev 明显更强**（91.7% vs 83.3/80.6，该层 Brier 减半，「错也错得犹豫」）；③官方 193.6×/444.6× 是自建 workflow 最佳 case，独立实测 5-25×；④官方 jaggedness 页自认：数数不可靠、hex/RGB 弱、日期当文本、无 P(x)+P(¬x)=1 保证。
- **开源生态**（Apache-2.0 为主）：**AgentJev-0.6B**（Qwen3-0.6B 去 LM 头+置换等变候选头；自带 loopback server `:8149` + Claude Code PreToolUse hook；Typed Decisions 基准 79.25% top-1/Brier 0.0448/ECE 0.169；ctx 2048）、**kev-0.6b**（LoRA+pointer head，**直接 serve TypeSafe /v1/systemone 契约**=换 base URL 即用；in-dist 0.805/OOD 0.598）、**Laya 家族**（Convai Innovations，pip `laya`，三检查点：英文根=ModernBERT-large 421M/ctx 512、**`laya-multilingual`=mmBERT-base 322M/ctx 1024（RoPE 可 8k）/100+ 语言**、typed-decisions specialist=421M/0.766 仅英文；**发布 Jev 兼容 `system_one()` helper**；多语言面是实测的——XNLI 14 非英语言 0.731 vs 英文检查点 0.521，「可用语言 45/51」，内置 Router 按语言选检查点[英文检查点遇外语文本会自信地输出垃圾——高棉语 0.000@95.2% 置信，置信度不报警，路由必须在前向之前]；**但它是地基不是即用引擎**：multilingual 检查点 typed-decisions 零样本近随机[0.342 vs 基线 0.318]，作者明说「当快速底座去特化」；原始 ECE 0.285，好数字 0.081 是域内温度拟合后的）、**EdgeJev**（pypi：laya/kev 转 ONNX 量化纯 CPU——4 vCPU int8 单题 15.6ms，运行时仅 onnxruntime+tokenizers+numpy）、**Open-Jev 2B/9B**（更强：2B 94.7%/OOD 86.0%，9B 97.5%，需 GPU）。**中文面小结（2026-09-23 补充核实）**：AgentJev/kev 骨干双语但决策头英文数据训练（零样本中文未知）；**laya-multilingual 是唯一显式多语言训练的本地检查点，但零样本决策能力近随机**——本地中文正路=laya-multilingual+自家账本微调+域内温度拟合（322M 在 1660 Ti 上微调可行）。本机实况：GTX 1660 Ti 6GB+16GB RAM——0.6B 级与 laya 级本地可跑，EdgeJev CPU 路径兜底，9B 级不可行。
- **AutoJev**：第三方托管 MCP（六预设 route_model/guard_tool_call/route_task/check_research/review_completion/decide）+Skills。**判定不采用**——决策层引入托管中间商=供应链依赖+违背「判断接线在仓内」的边界直觉；但其预设请求形状（tool/action/side_effects/safeguards/policy/reversibility→allow/confirm/review/deny）是极好的设计参照。

**核心修正（对 HANDOFF 初判）**：「明显 L0 一次前向直接放行、省整轮大副 spawn」**不成立**——L0 直发仍需任务书五项（title/brief/acceptance/nonGoals/deliverables），Jev 非生成式写不了；auto-brief 模板化会砸 brief 质量（brief 是给外勤的正典 prompt）。大副轮的实质是生成工作。**省不掉 spawn，能省的是轮数（澄清误开）与质量（先验锚定/注入屏/筛料）**。

**修正后的五个落点**（全部 advisory、旗控 `jev-advice` 默认 OFF、provider 缺席=诚实降级同 goals face 惯例）：

1. **澄清预判升级（最值钱）**：`inputMaturityOf`（staff.ts:137）现为正则启发式四判型；升级为 Jev Noul fan-out（缺关键信息吗/涉舰长独有上下文吗/可自行补全吗）嵌入 `staffOrderFor` 征召令。每省一轮**多余**澄清=省一整轮大副 spawn+舰长等待（分钟级）。错向成本不对称：误判「不完整」多问一轮（烦）vs 误判「完整」出坏任务书（贵）→ 阈值偏向问。
2. **命令注入筛查（新能力）**：命令文本拼进征召令/简报前置一道 Noul 屏（官方 prompt-injection screen 正是 `>0.9/<0.1` 中间带交人的形）。fail-open 到舰长审，绝不静默放行或静默拦截。
3. **context sieve（fan-out 优势区）**：chain-note 固定字符 cap（1500/600/400）+detailGens 新近度启发式 → 逐条「值不值得进简报」Noul 并行判定。注意：链档案+板态可超本地复刻 1-2k ctx → 此落点倾向托管 Jev（32k）。
4. **档位先验**：triage 前 Choice(L0/L1)+confidence 作为 `suggested` 锚注入征召令——D24 的 suggested/override（!!/??）机制原样收编，大副可覆写。一致性增益，非裁决。
5. **验收陪审**：reported 任务卡旁挂 check_research 形状（证据支持陈述吗）advisory 评分。KillCredit 与强制人工验收正典不动——**Jev 最多陪审，不能法官**。

**红线（调研后更硬，非软化）**：KillCredit/越界/attemptId/互斥/身份门=确定性代码（上一轮刚从「提示词维持」改成「代码强制」，这是结论不是起点）；生成职责（澄清对话/任务书/外勤编码）不沾；签发权绝对化在成形端。另立一条方法论闸：独立实测证明「便宜 chat 模型按正确姿势（明确要求用满 0-1 全距）要概率」可达相近 ECE——**任何 Jev 信号在 spike 里必须有此对照组**，否则增益归因不成立（TrueStandard 自曝其 22-claim 初版正是被自己的 prompt 质量骗了）。

**部署形态（若批）**：`src/jev.ts` 类型化客户端（plain fetch 零新依赖），provider 三态 off/remote（TYPESAFE_API_KEY 或 OpenRouter）/local（loopback：AgentJev server 或 kev 的 systemone 兼容端点；EdgeJev ONNX 为无 GPU 兜底）。config 走 `STARDECK_JEV_URL`/`STARDECK_JEV_KEY`+config.json。数据面注记：命令文本出机（remote 时）——本仓已 BYOK 外呼 z.ai 非新增类别，README 数据边界需补一行。审计：`directive_prejudged`（append-only，预判入账板上可见——「谁在参谋」不黑箱）。

**两段 spike（VERIFICATION 闭环，批后开工）**：
- **Phase A 校准台（不接 daemon，零产品面风险）**：`eval/jev/` 标定集=**自家 append-only 账本就是现成 ground truth**（directive_created 文本+大副实际分档+澄清史）+插件仓 v5/v15 考题语料。指标：分档一致率/澄清预测 P/R/Brier/ECE/**非对称成本矩阵**（错放 L0≠错留 L1 分开计）；对照组=便宜 chat 模型全距概率基线；三被试=托管 Jev（32k generalist）+本地 AgentJev（骨干双语/头未知）+**本地 laya-multilingual（唯一显式多语言检查点——零样本预计近随机[0.342]，但顺带标定其「账本微调前」的底数，微调是它过线的正路）**。产出指标报告，**不过线归档结论不上线**（promptfoo 基建复用，无 key/无模型=诚实 SKIP 退出门 0，同 verify:eval 契约）。预算：千级样本 ≈ 几美分（托管）；本地被试零 API 成本。
- **Phase B 接线（Phase A 过线才做）**：旗控五落点（1/2/4 先，3/5 视 Phase A 数据）+`directive_prejudged` 事件+快照/单测+verify 双面+live。

**结论一句话**：可行，但 Jev 在本仓的身份是「参谋的参谋」——给大副与舰长的判断喂先验信号，不是省掉大副的引擎；五个落点里澄清预判+注入屏最值得先 spike；托管 Jev 主路径（32k ctx+generalist），本地路径=AgentJev（骨干双语、头待测）与 **laya-multilingual（唯一显式多语言检查点+Jev 兼容 helper+EdgeJev CPU 部署，但需账本微调才可用）**，Phase A 三被试定夺。

---

## D26 舰桥频道：对话范式回归（2026-10-20，舰长三轮拍板）

**源起**：舰长自诊产品致命弱点——命令模式让 agent 不再回话，用户被换到命令习惯、监督面过宽、决策瓶颈全压在舰长身上。历史脉络定案：当年砍「会话管理」误伤「对话」；新形态把对话范式归还，会话管理仍然不要——**一个经理人一个窗**。

**三次拍板记录**：
1. （第一轮）经理人=大副正典升格，聊天窗驱动星舰+实时战况+答疑；
2. （第二轮）**对话框回归为产品本体**：默认脸面=聊天窗+设置入口，心智模型极简；频道为舰队全局（不选会话/不选项目/不建工作区，仪式经理人代走）；
3. （第三轮）板的地位=**可展开面板**——分屏旁观「看板被聊天驱动」（SSE rev 白得），也可进板亲自下令；聊天为尊的双面并立。

**红线三条（违者返工）**：①验收/签发定夺归舰长——聊天内一键完成，经理人不代签（eval 监督用例一正一负钉死）；②账本为源——聊天窗同板是读投影，写只经命令通道，bridge.jsonl 入 revision 六账本；③大副正典单人格——staffPersonaText 升格（经理人职责+回话纪律），不造第二 agent。

**机制定案**：
- **逻辑常驻、物理按需**：不做永不退场进程（进程即生命铁律下引入新失联语义不值）；chat 工单（staffOrderFor 第四参 chat 附页）携近 24 条对话史=全席兜底；opencode/pi 席 chat-only 轮优先 resume 续跑（deliverVia* 原语复用，失败退避 2 分钟回落全新 spawn）。
- **收割双写**：大副终答全文入 bridge（agent_message，含 agentId/sessionId 供 resume）+ 结构化块照旧入 directives——finalStaffReply 单源取文，两账永不漂移。
- **机械战报五触发**（reported/clarify/retry/terminal/scheduled）：不跑模型，dedupKey=源事件指纹幂等；聊天窗「活着」不靠烧 token。
- **digest**：collectInbox 服务端化+命令/任务/待决三合一紧凑封顶——经理人报战况的数据底料，工单附页随行。
- **旗**：`STARDECK_BRIDGE` 默认 ON（=0/false/off 回退看板先行老形态，/board 无 bridge 字节、三端点 404——旗 OFF 面与 0.2.x 等价）。

**边界（不属本轮）**：分级授权档（经理人自决例行运营）未来另案；zcode/claude/dsh/codex 四席进程级续跑留在候选清单（携史兜底保功能完整）。

## D27 代理舰长席：对话者与舰务分离 + 外部调用面正名（2026-10-20，舰长拍板四项）

**源起**：舰长自省 D26 的拧巴处——聊天窗里的大副被迫一边办工单一边陪聊，但聊天里说的目标又无权成单（无造单工具，红线卡着）；且「未来被其他 agent 调用（插件/MCP/CLI）」的愿景与聊天窗应该是同一套架构。定案：**对话者另立一席**。

**四项拍板（口谕在案）**：
1. **术语**：人类=**舰长**不变（零迁移）；AI 对话者=**代理舰长**（proxy captain）——「因为命令卡片还是可以手动操作的」。三皮：代理舰长/代理管家/Acting Captain。
2. **大副**：聊天职责彻底移交（D26 经理人 persona 段+chat 附页回滚），回归 0.2.x 纯舰务；人类直通面原样（composer 直令/聚焦页答复/签发卡）。
3. **定夺权**：默认一切定夺呈舰长过目；「舰长可以授权一切由代理舰长定夺」落成显式开关 `STARDECK_PROXY_VERDICT`（默认 OFF，运行态经 POST /bridge/settings 翻转、不落盘、重启回落——授权本身是舰长的动作，安全缺省）。自然语言授权=未来另刀。
4. **范围**：完整闭环一次到位（v0.4.0）。

**机制定案**：
- **拟令闭环**：代理舰长终答携【命令】块（一令一块，可多块，单轮上限 5 防幻觉风暴）→ daemon 收割建 draft 命令卡（`issuedBy: proxy-…` 入账审计，引信/折叠全继承）→ 大副下轮分诊照旧——「说了就成单」，D26 的下单缺口从根上治。
- **【定夺】块**：授权 ON 时对 review 态任务可代验收——格式 `【定夺】（taskId）通过|打回`+理由；走 war_close_task 原路，B3 门经 flag-gated `verdictProxyGate`（在册 proxy 会话+授权运行态双条件）放行；授权 OFF 时收割层拒收仍呈舰长。
- **B3 潜伏缺陷修复（test-first 坐实）**：板面验收 agentId `captain-board` 对 staff-owned 任务自 B3 落地起实为被拒（hqSessionId 独立形态从不设置）——修=门显式放行 `captain-board`（板面舰长亲手验收的固定 principal，本地面板仅绑 127.0.0.1；principal 模型另案）。
- **席位 spawn**：spawnStaffAgent 参数化 role:'proxy'（title/日志前缀/PROXY_PROMPT 换面）；executor 四席注入守卫——proxy 席不注 MCP/扩展（无工具面是机制不是纪律）。
- **对话史承运层不动**：bridge.jsonl/未答判定/携史/digest/resume 优先+2min 退避全部平移换席（D26 投资全额保值）；大副 staffTick 的 chat 段退役、D26 双写退役。
- **审计正名**：directive_created 增 issuedBy（'human' 缺省/proxy-…/外部自报 body 字段）；directive_answered 修 channel 被续跑通道名覆盖的分叉（channel=来源面 + via=续跑通道双字段）。
- **旗**：STARDECK_PROXY 默认 ON（=0 聊天降级态：战报+决策卡在场、输入停用+诚实文案）；矩阵增舰桥/代理 OFF 面双跑。

**红线（继承+新增）**：定夺权结构性归舰长（授权=显式动作+flag 默认 OFF+重启回落三重安全缺省）；账本为源（代理舰长无工具，写全经块收割入账）；出口协议不可裁剪（代理舰长同禁 war_claim/war_submit）；授权 OFF 面字节级不变（矩阵锁）。

**同构声明（外部调用面）**：内置代理舰长=stardeck 外部调用接口的第一个客户端（POST /commands+digest+board+answer 同一组端点）——代理舰长是**席位不是进程**，未来任何 agent 经同一 API 都能坐进调用者位。完整 principal/鉴权模型另案（README「外部调用面」章如实声明）。

**代价（如实）**：对话式下单三段 LLM 轮（代理舰长+大副+外勤）；双人格资产并行维护；授权门是宪法级变更（flag-gated+eval 正负例+矩阵双面锁死）。

**实现锚**：persona `proxyCaptainPersonaText`；征召令 `proxyOrderFor`+块解析 `proxyCommandBlocksOf`/`proxyVerdictBlocksOf`（staff.ts）；daemon proxyTick（15s 并列哨位：未答驱动/resume 优先/收割三写=对话+命令卡+定夺）；B3 扩 `verdictProxyGate`+`captain-board` 放行（tools.ts）；端点 POST /bridge/settings；UI=bridge.tsx 降级态+设置弹层授权钮+命令卡「代理舰长令」徽标；copy 四典 6 新键。

**实现锚**：账本 `src/bridge.ts`；工单附页 `staffOrderFor(items, flags, face, chat?)`（chat 缺席字节不变）；daemon staffTick 挂 notices sync+chat 出单+收割双写+resume；端点 `GET/POST /warroom/api/bridge/messages`、`GET /bridge/digest`；UI `src/client/bridge.tsx`（消息流+三决策卡坞：澄清药丸/签发五项/验收证据卡）+ `client-standalone.tsx` 三态壳（聊天/分屏/看板）；answer 通道 channel:'bridge' 入账。

---

### 后续决策（待记）

- npm 发布管线（release.mjs/OIDC 移植）
- 监督层工具落点（promptfoo 移植 vs 暂缓——前置 VERIFICATION.md §8.4/8.5 项目主答复）
