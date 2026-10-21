<div align="center">

# ⭐ stardeck · 星舰甲板

**agent 舰队的作战看板与守护进程。**

你在聊天窗里说目标，AI 代理舰长把它拟成命令卡，AI 大副分诊成任务书，AI 外勤在隔离工作区执行并交证据，你只管验收。
deck 一词双关：星舰飞行甲板（agent 在这里起降调度）+ deck of cards（一副任务卡——看板）。

[English](#english) · [中文](#中文) · [License](#license-mit)

</div>

---

<div align="center">
<img src="docs/screenshots/hero-zh.png" alt="stardeck 舰桥：暗色 3D 星域 + 三列作战看板" width="100%">
</div>

# 中文

## 这是什么

stardeck 是一个**本地优先**的多 agent 编排器：它不替 agent 干活，而是管住「下令 → 成案 → 执行 → 交证 → 验收」的完整环流。任意 CLI coding agent（opencode / pi / zcode / Claude Code / …）经注入的 MCP 桥或扩展领令出勤；**账本、令牌、证据核验由系统机械核对，不靠 agent 自报**。

- **一个聊天窗（舰桥频道，默认脸面）**：你只和一位**代理舰长**（百事通）对话——说目标他拟令成卡、问战况他实时报（复杂态势直接配一页**图景**：零脚本沙箱图页，数据逐条对账账本，编造的进不来）、问概念他现场讲、撤令/重派/停定时/换席口头说他就代落块执行（全审计）；任务书签发、验收请示以决策卡推到聊天里一键定夺（也可显式授权他代行验收，默认不开）。不需要选会话、选项目、建工作区。
- **看板可展开旁观**：分屏看着看板被聊天驱动，或进板亲自下令——3D 星域、三列作战看板原样保留。
- **会话外归系统，会话内归 agent**：工作区物化、征召、巡检、验收定夺归 stardeck；读写文件、跑命令由 agent 自带工具完成——边界清晰，互不越权。
- **出口协议不可裁剪**：`war_claim` 令牌制领取、`war_submit` 证据核验（checks 全过 + 测试退出码 0 + 无越界文件，即 KillCredit）、`war_close_task` 人工验收收官——验收与签发的定夺永远归你，经理人不代签。

## 核心特性

**💬 舰桥频道（v0.3.0 对话范式，默认视图；v0.4.0 对话者=代理舰长；v0.5.0 百事通：全知+图景+全能管理）**
打开就是聊天窗：说目标、问战况、问概念、闲聊都在这里。**代理舰长**（v0.4.0）是你在频道里的代理人——把你的自然语言拟成【命令】块，系统收割成命令卡交大副分诊（说了就成单）；机械战报（交证待验收/澄清挂起/失败重试/收官/定时派发/图景对账失败）自动推进频道；v0.5.0 起他百事通化——征召令自带近期账本切片+只读查证通道（GET /board、/bridge/digest、/ledger），讲复杂态势可附【图景】块（系统确定性渲染成零脚本单文件图页，编号逐一对账、对不上整页拒收），撤令/重派/停定时令/换席四个管理块口头直落（系统代执行+战报回报）；请示出决策卡——澄清选择题药丸点选即答（`1A;2B`）、任务书五项卡可逐项修改后签发、验收卡带证据摘要一键定夺。不习惯对话模式？右上角一键切回看板（`STARDECK_BRIDGE=0` 可永久回退老形态；`STARDECK_PROXY=0` 只关对话者保留战报与决策卡）。

**🌊 3D 星域（看板视图）**
每条战线是一颗行星：执行中=推进行星轨迹，已收官=占领态，战线环分段=任务数。暗色模式一键切换，悬停高亮关联卡族，滚轮缩放、中键旋转。

**🪐 三列作战看板**
任务列（执行动向）· 任务回报列（证据与收官）· 底部调度坞（命令卡生命周期）。板是读投影：你在板上定夺（批计划/验收/撤令），agent 在工作区里干活。

**🎯 聚焦页：一条命令的一生**
点任意命令卡展开全生命周期：命令原文（聊天拟令的卡带「代理舰长令」徽标）→ 大副计划（待批可带意见驳回）→ 执行会话 → 任务回报与证据，全程可溯源。聊天里的战报与命令引用一点即达。

**🤖 大副 + 外勤双层编制**
AI 大副分诊你的命令（L0 直发 / L1 签任务书），起草任务书呈你签发；签发后自动物化隔离工作区并征召外勤执行。**舰队绑定跟随你选的 CLI——代理舰长、大副和外勤都跑在你选的 agent 上**；只有双席都接通的 CLI 才会出现在绑定门里（当前六席）。代理舰长的对话记忆跨轮连续（账本携史全席兜底，opencode/pi 席优先原生会话续跑）。

**🔒 证据核验（KillCredit）**
外勤交证不是打个「完成」：checks 逐项过、测试真实跑、无越界文件改动——机械判据全绿才算交付，最后由你翻阅收官。

**🌐 中英双语 + 三皮肤**
设置里一键切换 中文/English，全板与聊天措辞实时换库（词典完备性由测试锁死，不静默回落）；军事/平话/星际迷航三套措辞皮肤。

## 界面

<div align="center">
<img src="docs/screenshots/fleet-zh.png" alt="舰队选择门：双席正典——可选=大副+外勤双接通（六席），未接通的席明示原因" width="72%">
<p><sub>舰队选择门：按你安装的 CLI 自动探测可用席位；模型输入随所选席位卡内展开（zcode 的模型在它自己那里配，卡内给出说明）</sub></p>
</div>

<div align="center">
<img src="docs/screenshots/focus-zh.png" alt="聚焦页：计划待批，定夺批注随驳回送达大副重拟" width="72%">
<p><sub>聚焦页：计划待批——批准/驳回，驳回时意见随单送达大副重拟；底部可跳大副/执行会话回看全程（零 token 读本地会话存档）</sub></p>
</div>

## 快速开始

前置：[Node.js](https://nodejs.org) ≥ 22，以及至少一个受支持的 coding CLI（如 [opencode](https://opencode.ai)；一个都没有也可以先聊天，见下）。

```bash
npm i -g stardeck
stardeck                       # 起 daemon + 自动打开浏览器（首跑自动建开始菜单快捷方式）
```

想要「双击图标」的桌面应用形态，直接下安装器：[GitHub Releases → stardeck Setup](https://github.com/Kaiji-Z/stardeck/releases)（Windows；macOS/Linux 随后跟上）。

浏览器会先经过**舰队选择门**——选一个已安装的 CLI（模型留空即沿用其自身默认），点「开始调度」，然后进入**舰桥频道**（聊天窗），跟代理舰长说你的第一句话，例如：

```
!!直接做：在工作区根创建 hello.txt，内容为当前时刻
??先看方案：给这个项目做一次依赖体检，先呈方案等我批准
现在舰队什么情况？简单报个总况
```

`!!` 强制直发（跳过签发），`??` 强制先看方案（看板 composer 直令照旧——聊天里说目标则由代理舰长拟令成卡）。不喊 `!!`/`??` 也可以纯聊天（问战况、问用法）。右上角可随时切到分屏/看板视图。

本机一个 CLI 都没有？门面会给出各席安装命令（一键复制）；或者设 `STARDECK_PROXY_LOOP=1` 与 `Z_AI_BASE_URL`/`Z_AI_API_KEY` 环境变量后重启——聊天窗的代理舰长由内置 loop 担任（key 只走环境变量，永不落盘）。

### 把你自己的 agent 接进来当代理舰长（一行命令）

任何支持 MCP 或 HTTP 的 agent 都能坐上代理舰长席（`stardeck connect` 自动起 daemon、签席、写宿主注册）：

```bash
stardeck connect claude      # Claude Code（写 ~/.claude.json，等价 claude mcp add -s user）
stardeck connect zcode       # zcode（写 ~/.zcode/cli/config.json 的 mcp.servers）
stardeck connect opencode    # opencode（写 ~/.config/opencode/opencode.json 的 mcp 键）
stardeck connect codex       # Codex CLI（写 ~/.codex/config.toml 的 [mcp_servers.stardeck-proxy]）
stardeck connect             # 其他宿主：打印 {"mcpServers": …} 配置块，自己粘
```

注册后打开 `http://127.0.0.1:3970` 聊天——回话的就是你的 agent（它拿到的是五件只读+交答工具，执行者的 war_* 一件不出；token 只在注册时出现一次）。撤销：删除宿主配置里的 `stardeck-proxy` 键即可。

### 常用命令

```bash
stardeck open     # 起 daemon 并强制拉起浏览器
stardeck app      # 建「点击即用」快捷方式（首跑自动建）
stardeck status   # 探活：舰队/revision/账面计数
stardeck stop     # 优雅停服（在役执行者先行收割）
pnpm test         # 全量测试（开发态）
pnpm verify       # 三段式验收门：tests + build + 针脚（开发态）
pnpm live         # 端到端实机门：真 CLI 外勤全链（开发态）
```

### 配置

配置文件 `~/.stardeck/config.json`（或 `STARDECK_CONFIG` 指路），环境变量均可覆盖：

| 变量 | 作用 | 默认 |
|---|---|---|
| `STARDECK_PORT` | 看板端口 | `3970` |
| `STARDECK_STATE_DIR` | 账本/日志目录 | `~/.stardeck` |
| `STARDECK_WAR_ROOT` | 任务工作区根 | `<state>/tasks` |
| `STARDECK_EXECUTOR` | 预设舰队 | `opencode` |
| `STARDECK_MODEL` | 预设模型 | 空（各 CLI 自身默认） |
| `STARDECK_STAFF` | AI 大副自动分诊 | 开 |
| `STARDECK_BRIDGE` | 舰桥频道（聊天窗默认脸面） | 开（`=0` 回退看板先行老形态） |
| `STARDECK_PROXY` | 代理舰长席（聊天对话者/拟令成卡） | 开（`=0` 聊天降级：战报+决策卡在场、输入停用） |
| `STARDECK_PROXY_VERDICT` | 舰长显式授权代理舰长代行验收定夺 | 关（也可经设置弹层运行态翻转，重启回落） |

舰队绑定写在配置文件里，重启保持；板面随时可换绑（在役任务不受影响）。

## 支持的舰队

**双席正典**：一个舰队能被选中，必须**大副 + 外勤两个岗位都接通**——大副分诊呈批、外勤干活交证，都跑在你选的 CLI 上。

| 状态 | CLI | 说明 |
|---|---|---|
| ✅ 稳定 | [opencode](https://opencode.ai) | 开源、多供应商；项目级 `opencode.json` 注入 MCP 桥 |
| ✅ 稳定 | [pi](https://github.com/badlogic/pi-mono) | 轻量；扩展件注册出口协议工具 |
| ✅ 稳定 | zcode | GLM 系；模型走其自身配置 |
| ✅ 稳定 | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 原生订阅或 anthropic 兼容网关 |
| ✅ 稳定 | [Codex CLI](https://github.com/openai/codex) | 经 Responses→chat 垫片直驱 GLM（`stardeck codex-shim`，另配 `STARDECK_CODEX_SHIM_BASE`）；工具走 HTTP 直连 |
| ✅ 稳定 | dsh（DeepSeek Harness） | 走源码仓克隆入口；网关 env `DEEPSEEK_API_KEY/BASE_URL`（自动映射 Z_AI_*） |
| 🚧 暂不可绑 | Gemini CLI | 双席未接通（外勤契约在档未实弹、大副通道未建）——配好 key 实弹转正后开放 |
| 🚧 暂不可绑 | Qwen Code | 双席未接通（外勤半证、大副通道未建）——实弹转正后开放 |
| 🚧 即将支持 | Copilot CLI / Amp / Cursor CLI / Droid | 适配进行中（部分走 ACP 协议） |

## 架构速览

```
bin/stardeck.mjs ─→ dist/cli.mjs ─→ src/daemon.ts（守护进程装配）
                                      ├─ dashboard.ts（/warroom/api/* 板投影 + SSE）
                                      ├─ tools.ts（24 个 war_* 工具；MCP 桥暴露给 agent）
                                      ├─ executor.ts（执行者适配器：无头框定 + 会话捕获 + 跳转）
                                      ├─ staff.ts（AI 大副：分诊/计划/发布工单）
                                      ├─ steer.ts（RPC 续跑：板内答复/批注转达送进在途会话）
                                      ├─ 巡检 15s（失联回收 + 补征召）+ staffTick（到点派发）
                                      └─ 板 UI（React + WebGL 星域；中英双语）
src/ 其余 = 账本内核：append-only JSONL + fold（永不过写，只派生状态）
```

设计要点：

- **append-only 账本**：命令/任务/事件一律追加 JSONL，状态由纯函数 fold 派生——崩溃安全、可追溯、可重放。
- **attemptId 即令牌**：外勤凭征召令牌领取任务并交证，无令牌的提交一律拒绝。
- **进程即生命**：执行者进程失联由巡检回收（记败+重派），daemon 重启不残留僵尸会话。

## 外部调用面（v0.4.0）

**内置的代理舰长，就是 stardeck 对外调用接口的第一个客户端**——他没有任何私有通道：拟令走 `POST /commands`、看全局走 `GET /bridge/digest` 与 `GET /board`、答问走 `POST /commands/answer`。任何外部 agent（你 IDE 里的会话、一个机器人、一个脚本）经同一组本地端点都能坐进「调用者」席位驱动 stardeck：

| 端点 | 用途 |
|---|---|
| `POST /warroom/api/commands` | 下令（可选 body 字段 `issuedBy` 自报来源，入账审计） |
| `GET /warroom/api/bridge/digest` | 舰队全况速览（待决清单+命令/任务摘要，紧凑封顶） |
| `GET /warroom/api/board` | 全量看板投影（命令/任务/线程/名册） |
| `POST /warroom/api/commands/answer` | 澄清答复（`channel` 标来源面） |
| `GET /warroom/api/mcp/tools` | war_* 工具清单（机器可读自描述） |

边界如实声明：验收/签发的**定夺权结构性归人类**——外部调用者可以下令与问询，不能替你验收（唯一例外是你显式打开的代理舰长定夺授权，运行态开关）。完整的调用者身份/鉴权模型（principal）是另案——当前形态仅限本机互信环境。

## 代理舰长是开放职位（v0.6.0）

v0.6.0 起「代理舰长」不是一个进程，是一个**席位契约**：喂什么（携史+账本切片+digest+块文法教学）、吐什么（【命令】【图景】【撤令】等结构化块，收割与审计全在 daemon）、一轮怎么算完（末条消息）。三个实现同权同约束：

| 实现 | 大脑在哪 | 怎么接入 |
|---|---|---|
| 舰队 CLI 席（缺省） | 你绑定的 CLI（opencode/pi/…无头 spawn） | 开板选舰队即用 |
| 外接席位（v0.6.0） | **你自己的 agent** | `POST /warroom/api/proxy/seats` 签座席拿 token → agent 经 HTTP 三端点或 `mcp-bridge.mjs --face proxy`（MCP 座席面：get_order/submit_reply/read_board/read_digest/read_ledger 五件，执行者 war_* 一件不出）坐进来 |
| 内置 loop（v0.6.0） | daemon 内置 ai SDK 循环（BYOK 直连 z.ai 等 OpenAI 兼容面） | `STARDECK_PROXY_LOOP=1` + `Z_AI_BASE_URL`/`Z_AI_API_KEY` env；默认关，失败诚实降级回舰队席 |

外接席位三端点：`POST /warroom/api/proxy/seats`（签发 seatId+token，token 只此一面）→ `GET /warroom/api/proxy/order?token=`（当轮工作令全文+账面快照）→ `POST /warroom/api/proxy/reply {token,text}`（交终答，块自动收割入账）。块文法教学就在 order 正文里——agent 不需要预先了解 stardeck，坐下来读一遍就会。

## 安全模型

stardeck 的威胁模型是**本机互信**：

- daemon 只监听 `127.0.0.1`，**没有鉴权**——不要把端口转发到公网，不要在多用户机器上裸跑。
- 外勤在**隔离任务工作区**内工作，越界文件改动会被证据核验判负；任务书与验收标准就是围栏。
- 会话历史读档（板内弹窗）直接读本机各 CLI 落盘的会话库——零 token，共享屏幕演示时留意全文可见。

## 文档

- [AGENTS.md](AGENTS.md) — 迭代指引（新会话先读）
- [DESIGN.md](DESIGN.md) — 决策录
- [CHANGELOG.md](CHANGELOG.md) — 版本记录
- [VERIFICATION.md](VERIFICATION.md) — 验证体系
- [eval/](eval) — 监督评测（promptfoo 三维门）

## 开发（源码安装）

```bash
git clone https://github.com/Kaiji-Z/stardeck.git
cd stardeck
pnpm install && pnpm build
node bin/stardeck.mjs          # 起 daemon + 自动开浏览器（pnp 装包用户走 npm i -g stardeck 即可）
```

桌面壳（可选）：`cd desktop && npm install && npm run dev`（开发态，复用主仓 dist）；出安装器 `npm run dist`。

## 贡献

欢迎 issue 与 PR。提交前请跑 `pnpm verify`（tests + build + 针脚三段式）与 `pnpm live`（端到端实机门）。改提示词资产必须过快照门（`WARROOM_UPDATE_SNAPSHOTS=1` 重新生成 fixtures 并随改动一并提交）。

---

<div align="center">
<img src="docs/screenshots/hero-en.png" alt="stardeck Bridge: dark 3D starfield + three-column operations board" width="100%">
</div>

# English

## What is this

stardeck is a **local-first** multi-agent orchestrator: it doesn't do the agents' work — it owns the full loop of *order → brief → execute → evidence → acceptance*. Say a goal in the chat window; an AI Acting Captain shapes it into a command card, the first mate triages it, field agents execute with evidence — you just accept. Any CLI coding agent (opencode / pi / zcode / Claude Code / …) takes orders through an injected MCP bridge or extension; **ledgers, tokens and evidence are verified mechanically by the system, never taken on the agent's word**.

- **3D starfield board**: every campaign is a planet; execution progresses in real time on the starfield (WebGL, 2D radar view, list view fallback).
- **Outside the session belongs to the system; inside belongs to the agent**: workspace materialization, conscription, patrol and acceptance belong to stardeck; file edits and commands run with the agent's own tools — clean boundaries, no overreach.
- **The exit protocol is not negotiable**: `war_claim` token-based claiming, `war_submit` evidence verification (all checks pass + tests exit 0 + no out-of-bounds files — the KillCredit), `war_close_task` human acceptance.

## Highlights

**🌊 3D starfield (default view)**
Every campaign is a planet: executing campaigns advance along their orbits, finished ones turn captured, campaign rings segment per task. One-click dark mode, hover to highlight related card families, wheel zoom, middle-drag rotate.

**💬 Bridge channel (v0.3.0 chat-first default; v0.4.0 the Acting Captain; v0.5.0 the know-it-all)**
Open to a single chat window: say goals, ask status, ask anything. The **Acting Captain** (v0.4.0) is your proxy in the channel — natural language in, 【command】 blocks out, harvested into command cards for the first mate (say it and it becomes an order). v0.5.0 makes him a know-it-all: every order ships with a recent ledger slice plus a read-only query channel (GET /board, /bridge/digest, /ledger); complex situations get a 【scene】 block rendered by a deterministic zero-script engine (every id reconciled against the ledger — fabricated scenes are rejected wholesale); and verbal management intents (cancel / retry / halt schedule / switch seat) land as management blocks executed by the system with full audit. Decision cards (clarify pills / five-field brief sign-off / acceptance with evidence) land in the chat for one-tap verdicts; you may explicitly delegate acceptance verdicts to the Acting Captain (off by default). Mechanical notices keep the channel alive without burning tokens.

**🪐 Three-column operations board**
Tasks column (execution status) · Mission logs column (evidence & closure) · bottom dispatch dock (command lifecycle). The board is a read projection: you decide on it (approve plans / accept / withdraw orders), agents work in workspaces.

**🎯 Focus page: one command's whole life**
Click any command card for its full lifecycle: original order → staff plan (reject with a note while pending) → execution sessions → mission report & evidence, all traceable.

**🤖 Acting Captain + first mate + field agents**
The Acting Captain talks with you in the bridge channel; an AI first mate triages your orders (L0 direct / L1 brief-first), drafts task briefs for your approval; approved orders get an isolated workspace and a field agent conscripted. **The fleet binding follows your chosen CLI** — the Acting Captain, first mate and field agents all run on the agent you pick; only CLIs with both wired roles appear in the binding gate (six today).

**🔒 Evidence verification (KillCredit)**
"Done" is not a claim: every check passes, tests really run, no out-of-bounds file changes — all mechanical criteria green before it counts as delivered, and you give the final review.

**💬 In-board answers & mid-flight delivery**
When the first mate asks a clarifying question, answer right in the **focus-page answer box** (no need to open the mate's native session) — the reply is delivered into the mate's session and it resumes with full context; comments can be relayed to in-flight agents. The answer channel is per-seat: pi (RPC frames) and opencode (run -s resume) are live-wired; other seats reject honestly until their contracts land.

**🌐 Bilingual UI + three skins**
Switch 中文/English in the settings drawer — the whole board re-renders live (dictionary completeness is test-enforced, no silent fallback); Military / Plain / Star Trek wording skins.

## Screenshots

<div align="center">
<img src="docs/screenshots/fleet-en.png" alt="Fleet gate: dual-role canon — selectable means both staff and executor wired (six seats); unwired seats state why" width="72%">
<p><sub>Fleet gate: seats probed from your installed CLIs; the model input expands inside the selected seat card (zcode's model lives in its own config — the card explains it)</sub></p>
</div>

<div align="center">
<img src="docs/screenshots/focus-en.png" alt="Focus page: plan pending, verdict note delivered to the first mate on rejection" width="72%">
<p><sub>Focus page: plan pending — approve or reject (a note rides along for the redraft); jump to staff/mission session history at the bottom (zero-token reads of local session archives)</sub></p>
</div>

## Quick start

Prerequisites: [Node.js](https://nodejs.org) ≥ 22 and at least one supported coding CLI (e.g. [opencode](https://opencode.ai); none installed yet? see below).

```bash
npm i -g stardeck
stardeck                       # starts the daemon + opens your browser (first run also creates a Start-menu shortcut)
```

Prefer a desktop app? Grab the installer from [GitHub Releases](https://github.com/Kaiji-Z/stardeck/releases) (Windows; macOS/Linux to follow).

The browser first shows the **fleet gate** — pick an installed CLI (leave the model empty to use its own default), hit *Start dispatching*, then type your first order in the chat window:

```
!!direct: create hello.txt in the workspace root with the current time
??plan-first: run a dependency health check on this project, show me the plan first
What's the fleet status? Give me a quick rundown
```

`!!` forces direct execution (skips plan approval), `??` forces plan-first. Default tiers are triaged by the AI first mate.

No CLI on this machine? The gate shows one-click-copy install commands for every seat; or set `STARDECK_PROXY_LOOP=1` plus `Z_AI_BASE_URL`/`Z_AI_API_KEY` environment variables and restart — the chat captain runs on the built-in loop (keys live in env vars only, never on disk).

### Plug your own agent in as the proxy captain (one line)

Any MCP- or HTTP-capable agent can take the proxy captain seat (`stardeck connect` starts the daemon, issues the seat token, and writes the host registration):

```bash
stardeck connect claude      # Claude Code (~/.claude.json; same as claude mcp add -s user)
stardeck connect zcode       # zcode (mcp.servers in ~/.zcode/cli/config.json)
stardeck connect opencode    # opencode (mcp key in ~/.config/opencode/opencode.json)
stardeck connect codex       # Codex CLI ([mcp_servers.stardeck-proxy] in ~/.codex/config.toml)
stardeck connect             # anything else: prints a {"mcpServers": …} block to paste
```

Open `http://127.0.0.1:3970` and chat — your own agent now answers as the proxy captain (it only ever sees five read+reply tools; the executors' war_* tools never cross the proxy face. The token is shown exactly once, at registration). To undo: remove the `stardeck-proxy` key from the host config.

### Commands

```bash
stardeck open     # start the daemon and force-open the browser
stardeck app      # create the "click to launch" shortcut (auto-created on first run)
stardeck status   # liveness: fleet / revision / ledger counts
stardeck stop     # graceful shutdown (in-flight agents harvested first)
pnpm test         # full test suite (development)
pnpm verify       # three-stage gate: tests + build + needles (development)
pnpm live         # end-to-end live gate: a real CLI agent full loop (development)
```

### Configuration

Config file at `~/.stardeck/config.json` (or point `STARDECK_CONFIG` elsewhere); every key has an env override:

| Variable | Purpose | Default |
|---|---|---|
| `STARDECK_PORT` | board port | `3970` |
| `STARDECK_STATE_DIR` | ledger/log directory | `~/.stardeck` |
| `STARDECK_WAR_ROOT` | task workspace root | `<state>/tasks` |
| `STARDECK_EXECUTOR` | default fleet | `opencode` |
| `STARDECK_MODEL` | default model | empty (each CLI's own default) |
| `STARDECK_STAFF` | AI first mate triage | on |
| `STARDECK_PROXY` | Acting Captain seat (chat proxy / order drafting) | on (`=0` keeps notices+cards, input disabled) |
| `STARDECK_PROXY_VERDICT` | Explicit delegation of acceptance verdicts to the Acting Captain | off (runtime toggle in settings; resets on restart) |

Fleet binding is persisted to the config file and survives restarts; rebind anytime from the board (in-flight tasks unaffected).

## Supported fleets

**Dual-role canon**: a fleet is selectable only when **both roles are wired** — the first mate (triage & briefing) and the field agents (work & evidence) all run on the CLI you pick.

| Status | CLI | Notes |
|---|---|---|
| ✅ Stable | [opencode](https://opencode.ai) | Open-source, multi-provider; MCP bridge injected via project `opencode.json` |
| ✅ Stable | [pi](https://github.com/badlogic/pi-mono) | Lightweight; an extension registers the exit-protocol tools |
| ✅ Stable | zcode | GLM family; model lives in its own config |
| ✅ Stable | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Native subscription or an anthropic-compatible gateway |
| ✅ Stable | [Codex CLI](https://github.com/openai/codex) | GLM via the Responses→chat shim (`stardeck codex-shim` + `STARDECK_CODEX_SHIM_BASE`); tools over direct HTTP |
| ✅ Stable | dsh (DeepSeek Harness) | Runs from a source-tree clone; gateway env `DEEPSEEK_API_KEY/BASE_URL` (auto-maps Z_AI_*) |
| 🚧 Not bindable yet | Gemini CLI | Dual-role incomplete (executor contract never live-fired, no staff channel) — opens after a key + live-fire |
| 🚧 Not bindable yet | Qwen Code | Dual-role incomplete (executor half-proven, no staff channel) — opens after live-fire |
| 🚧 Coming soon | Copilot CLI / Amp / Cursor CLI / Droid | Adapters in progress (some via ACP) |

## Architecture

```
bin/stardeck.mjs ─→ dist/cli.mjs ─→ src/daemon.ts (daemon assembly)
                                      ├─ dashboard.ts (/warroom/api/* board projection + SSE)
                                      ├─ tools.ts (24 war_* tools; exposed to agents via MCP bridge)
                                      ├─ executor.ts (executor adapters: headless framing + session capture + jump)
                                      ├─ staff.ts (AI first mate: triage / plan / publish worklist)
                                      ├─ steer.ts (RPC resume: in-board answers & relays into live sessions)
                                      ├─ patrol 15s (lost-agent recovery + re-conscription) + staffTick (scheduled dispatch)
                                      └─ board UI (React + WebGL starfield; bilingual)
src/ rest = ledger kernel: append-only JSONL + fold (never overwrite; state is derived)
```

Design notes:

- **Append-only ledger**: commands/tasks/events are JSONL appends; state is derived by pure folds — crash-safe, traceable, replayable.
- **attemptId is the token**: field agents claim and submit with conscription tokens; tokenless submissions are rejected.
- **Process is life**: lost executor processes are recovered by the patrol (recorded as failed + re-dispatched); a daemon restart leaves no zombie sessions.

## Security model

stardeck's threat model is **local mutual trust**:

- The daemon listens on `127.0.0.1` only and has **no authentication** — never forward the port, never run bare on multi-user machines.
- Field agents work inside an **isolated task workspace**; out-of-bounds file changes fail evidence verification. The task brief and acceptance criteria are the fence.
- Session-history modals read the local session archives of your CLIs directly — zero tokens, but full text is visible on the board; mind screen sharing.

## Docs

- [AGENTS.md](AGENTS.md) — iteration guide (read first in a new session)
- [DESIGN.md](DESIGN.md) — decision records
- [CHANGELOG.md](CHANGELOG.md) — changelog
- [VERIFICATION.md](VERIFICATION.md) — verification system
- [eval/](eval) — supervised evaluation (promptfoo three-dimension gate)

## Development (source install)

```bash
git clone https://github.com/Kaiji-Z/stardeck.git
cd stardeck
pnpm install && pnpm build
node bin/stardeck.mjs          # start the daemon + open the browser (end users: npm i -g stardeck)
```

Desktop shell (optional): `cd desktop && npm install && npm run dev` (uses the repo's dist); build the installer with `npm run dist`.

## Contributing

Issues and PRs welcome. Run `pnpm verify` (tests + build + needles) and `pnpm live` (end-to-end live gate) before submitting. Prompt-asset changes must pass the snapshot gate (`WARROOM_UPDATE_SNAPSHOTS=1` to regenerate fixtures, committed alongside the change).

---

<div align="center">

MIT © [Kaiji-Z](https://github.com/Kaiji-Z)

</div>
