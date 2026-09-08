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

**理由**：委托式的代价是每跳有损转译，而最大的损耗发生在入口——命令的模糊性如果在计划层被消化，误差是 minutes；漏到执行层，误差是整轮征召。stardeck 的差异化主张由此从「别人管分工，我们管交账」扩为「**别人管 plan，我们管作战会议+交账**」：plan mode 在别家长在执行 agent 身上（自己澄清自己，既当运动员又当裁判），本仓把澄清职能还给参谋岗——大副的正名。

---

### 后续决策（待记）

- npm 发布管线（release.mjs/OIDC 移植）
- 监督层工具落点（promptfoo 移植 vs 暂缓——前置 VERIFICATION.md §8.4/8.5 项目主答复）
