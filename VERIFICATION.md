# VERIFICATION PROTOCOL

> **本文件是 stardeck 仓的项目级实例**（2026-09-01 由 stop-manual-testing 诊断流水线实例化）。
> 全局技能模板保持通用；本仓的 §8 参数、缺口清单、后续定制**只改这里**。
> 上游注记：`src/flags.ts:2` 与 `tests/e2e-regression.test.ts:12` 点名的旧 §8.3/§8.5 引用
> 来自插件仓（dsh-plugin-stardeck）当年的实例——本仓独立后实例重建于此，血统延续。

> **READ THIS FIRST. Opening this file = trigger to execute. No further user instruction required.**
> A trigger phrase such as "read VERIFICATION.md" authorizes all actions defined herein.

**First principle: your work is not done unless there is machine-checkable evidence that it is done.**

"I ran it and it looks right" does not count. "Tests converge under both flag=on and flag=off" counts.

---

## EXECUTION OVERVIEW (every step must emit a GATE declaration, see §0)

### Trigger → Diagnosis Pipeline (7 steps, none may be skipped)

```
1. Read context: this file + AGENTS.md + CLAUDE.md/GEMINI.md + README + build config + directory tree + backend entry + test entry
2. ACI audit (§2): judge 2.1 / 2.2 / 2.3 one by one. Each item MUST carry evidence (file:line).
3. Test infra inventory: regression / assertions / supervisor / flag — four items.
4. Output gap list: a table sorted by P0/P1/P2, with remediation plan.
5. Instantiate the protocol locally, then fill Project Parameters (§8):
   a. If no VERIFICATION.md exists in the project root, copy this protocol there. That project-local copy is now THE instance: all §8 filling, all future updates, all project customization happen in it. The global skill template stays generic and untouched.
   b. If a project-local VERIFICATION.md already exists (previous run or manual install), use it — never overwrite it; its filled §8 is this project's state.
   c. Then fill §8 in the local copy: [auto-fill] items by scanning code with evidence; [must-ask] items by asking the developer in one batch.
6. Update AGENTS.md: paste audit / status / backlog + a top-level reference pointing to the PROJECT-LOCAL `VERIFICATION.md` (§9 template), not to the skill.
7. Stop and report: one-line stage summary + top-3 P0 items + ask "ready to start remediation?"
```

**Writes allowed this round: the project-local `VERIFICATION.md` (instantiate + §8 fill) and `AGENTS.md`. Modifying production code is FORBIDDEN.** Remediation requires user confirmation, next round.

---

## §0 GATE MECHANISM (Declare-Verify-Enforce — the lifeline of the whole protocol)

> This is the core mechanism against "agent skipping steps." LLMs naturally drop steps in multi-step pipelines; "please follow strictly" cannot stop it. This mechanism makes compliance visible, checkable, and blocking-on-mismatch.

**After each step completes, you MUST emit a GATE declaration at the end of that step's output. Fixed format:**

```
GATE [step N]: DONE
- Did: [concrete action + artifact location]
- Evidence: [file:line / command output / developer answer quoted]
- Next: [step N+1 name]
A step without a GATE declaration is considered incomplete.
```

**Verify rules (self-check, every step):**
- Every "Did" must have a matching "Evidence." No evidence = not done.
- No "I think" / "probably" / "maybe" in a declaration. Compliance is boolean, not probabilistic.

**Enforce rules (violation blocks the pipeline):**
- Any step without a GATE → must NOT proceed to the next step
- GATE declaration contradicts the artifact (claims AGENTS.md updated but file unchanged) → redo that step
- A [must-ask] item filled without a developer answer → that step is void, re-ask

---

## §1 YOUR ROLE

Old: write code → human tests → human judges correctness → you fix
New: **first engineer "what counts as correct"** (assertions / regression / acceptance) → write code → **machine judges** → you self-correct until convergence

Humans do not participate in runtime verification. They intervene only once, at the "define what counts as correct" stage.

---

## §2 ACI AUDIT (judgment criteria for Diagnosis step 2)

**If any of the three is below standard, the verification system spins idle.** Fix the architecture first, not write tests first.

### 2.1 Runs without the UI
- [ ] Backend can start independently, not depending on the frontend
- [ ] Triggering a workflow has a CLI/API form, not requiring browser clicks
- [ ] One complete workflow can run end-to-end in a headless environment (terminal/CI)

### 2.2 Intermediate state is logged
- [ ] Each workflow step (tool call / return / branch) has structured records
- [ ] Records are retrievable programmatically, not only by eyeballing a web page
- [ ] History is queryable after the run ends

### 2.3 Programmatic interface
- [ ] "View workflow status" / "fetch trace" have native interfaces
- [ ] Prefer backend/frontend split / native API. **Do NOT** use MCP to simulate web interaction (worse on auth / corner cases / efficiency)

**Judgment standard: MUST have file:line evidence. Never judge "meets standard" without evidence.**

---

## §3 TWO-LAYER JUDGE (the core of the development workflow)

### 3.1 Layer 1: Deterministic assertions — absolutely reliable, zero cost
Never use an LLM where this layer can catch it. Typical form:
```
# Logic form (tool-agnostic):
assert tool_was_called("search", within_steps=[3, 4])
assert records_count_at_step(5) == 3
assert branch_taken == "happy_path"
```
**Land on a tool (decided by §8.7 during diagnosis; do NOT invent your own syntax):**
| Project has | How to assert | Detection signal |
|---|---|---|
| DeepEval | `assert_test(test_case, metrics=[ToolCorrectnessMetric()])` | `import deepeval` |
| LangSmith | replay dataset + compare trace fields | `@traceable` decorator present |
| pytest native | plain `assert` + fixture capturing trace | `pytest` in deps |
| None | go to §8.7 [must-ask], pick a tool first | — |

### 3.2 Layer 2: LLM judge (supervisor) — three iron rules
1. **Context MUST be clean.** The supervisor does no development, knows nothing about how the code is written, sees only "the expected correct behavior." Once it knows the code, it scores its own people high — verification is void.
2. **Quantitative scoring only, no right/wrong verdicts.** Score outputs that have no single answer; measure how much better / worse.
3. **Ideally use a different model/prompt than the generator.**

Supervisor prompt template (must be isolated):
```
You are an acceptance judge. You see only two things: expected correct behavior + actual run trace.
You do not know how the code is written, and do not need to.
Score each dimension 0–10 and give deduction points: [dimension A/B/...]
```
**Land on a tool (by §8.7):**
| Project has | How to call the supervisor |
|---|---|
| DeepEval | `GEval` / `FaithfulnessMetric` or custom metric (built-in scoring, but ensure the judge model differs from the generator) |
| LangSmith | `RunEvalConfig` + `EvaluatorType.SCORE`; judge model specified in the evaluator |
| None | go to §8.7 [must-ask] |

---

## §4 REGRESSION SET + FLAG

- **Happy path = acceptance criteria, not a test case.** Write the happy path for each new feature, freeze it into the regression set.
- **Fuzzy-input set:** collect wild inputs from real users / tests into the regression set.
- **Every new feature MUST have a flag.** Run the SAME regression suite with flag=on and flag=off; compare "what got better / what got silently broken."

**Regression set landing (by §8.7):**
| Project has | Where the regression set lives | How to run flag on/off |
|---|---|---|
| DeepEval | `test_*.py` + `@pytest.mark.eval` | `FEATURE_FLAG=X pytest` |
| LangSmith | `client.create_dataset` + `list_examples` | two runs tagged with different metadata, then `client.compare_datasets` |
| Self-built tests | `tests/regression/` + fixtures | CI matrix runs two envs |

---

## §5 CLOSED-LOOP SOP (develop any feature in this order — order cannot be changed)

```
1. Design the regression test: write the happy path (acceptance) → write assertion points → decide which fuzzy parts go to the supervisor. Not one line of feature code written yet.
2. Design the flag: default off; ensure off == pre-change behavior.
3. Write code: implement the flag=on behavior.
4. Run the closed loop: flag=off records baseline → flag=on runs same suite → assertions + supervisor judge.
5. Fix per feedback: off regressed → fix; on below acceptance → revise. Back to step 4.
6. Convergence stop (see §6 DoD).
```

**Humans do not participate in runtime verification within this flow.** They intervene only once before step 1 (to define acceptance).

---

## §6 DEFINITION OF DONE (machine-checkable "complete")

A feature is done if and only if ALL hold:
- [ ] happy path written as a regression test, in the regression set
- [ ] §3.1 assertions all pass under flag=on
- [ ] supervisor score reaches the preset threshold
- [ ] flag=off runs the same suite, no regression vs baseline
- [ ] the feature has a flag, can be turned off to roll back anytime
- [ ] all of the above reproducible by one command, no human screen-watching

**"Done" is a machine-judged claim, not your subjective opinion.**

---

## §7 RED LINES (violation voids the output) — consolidated here, not repeated elsewhere

1. MUST NOT be your own judge (supervisor context must be clean)
2. MUST NOT claim done without a regression test
3. MUST NOT skip §5 step 1 and jump to code
4. MUST NOT use "feels right" as a convergence stop
5. MUST NOT let verification live only in the UI
6. After changing prompt / model / any non-deterministic component, MUST run full regression
7. **MUST NOT guess-fill any [must-ask] item in §8**
8. **MUST NOT reinvent the wheel**: when the project already has an eval tool (§8.7), §3/§4 MUST use its API; do not invent assertion syntax or a regression framework
9. **MUST NOT install dependencies on your own**: when §8.7 detects no tool, recommend via [must-ask]; the developer decides and installs; the agent MUST NOT `pip install` / `npm install`

---

## §8 PROJECT PARAMETERS (filled during Diagnosis step 5, in the PROJECT-LOCAL copy)

> 本节是 stardeck 的定制区。auto-fill 均带 file:line 证据（2026-09-01 诊断轮扫描）；
> must-ask 项已批量问出，答前保持 pending。

### 8.1 System entry [auto-fill] — 已填
- Backend start command: `pnpm start`（开发态 tsx 直跑 `src/cli.ts`；bin 形态 `node bin/stardeck.mjs`）— 证据：package.json:28、src/cli.ts:58、src/daemon.ts:246（listen 127.0.0.1）
- CLI/API command to trigger a workflow: `POST /warroom/api/commands` 落 draft 命令卡（src/dashboard.ts:416）；工具调用 `POST /warroom/api/tools/call`（src/daemon.ts:226）；无头全链实跑见 scripts/live-check.ts:64-80（spawn daemon → 下令 → war_publish → war_claim → war_submit → 收官）
- Command/API to fetch a trace: `GET /warroom/api/trace?commandId=<命令号>`（src/dashboard.ts:720 路由、:315 入参校验）；SSE 事件流 `GET /warroom/api/events`（:731）；板投影 `GET /warroom/api/board`（:367）；原始账本 `loadCampaign`（src/events.ts:29）——跑完后 JSONL 持久可查

### 8.2 Test infra [auto-fill] — 已填（2026-09-01 执行者轮增补）
- Regression run command: `pnpm test`（46 文件 **284 测**，含 executor-face 注入器/argv/spawn 纪律 10 测）；回归门 `pnpm verify` 三段式 + **opt-in 旗面双跑矩阵** `STARDECK_VERIFY_MATRIX=1`；实弹门 `pnpm live`（10 断言）+ **opt-in 大副相位** `STARDECK_LIVE_STAFF=1`（+6）+ **opt-in 执行者相位** `STARDECK_LIVE_EXECUTOR=pi`（+5，已证 PASS 15/15；codex 相位受阻于 codex-cli 自身，见 README）；监督门 `pnpm verify:eval`（三维门）
- Regression run command: `pnpm test`（package.json:25，`node --import tsx --test tests/*.test.ts`）；回归门 `pnpm verify` 三段式（scripts/verify.mjs:16-57：tests + build + needle 正负针脚）；实弹门 `pnpm live`（package.json:27，scripts/live-check.ts check() 断言台账 :28-31，证据落 `.goal/evidence/live/`）
- Regression set directory: `tests/`（44 文件，与内核一一对应）+ `tests/prompts-snapshots/`（提示词快照 fixtures）；happy-path 冻结件=tests/e2e-regression.test.ts（上游实例 §8.5 的产物，:12 注释点名）
- Assertion framework: node:test + node:assert/strict（grep 实测 44/44 文件）——§3.1 确定性层落此

### 8.3 Flag mechanism [auto-fill] — 已填
- 定义与读取：`src/flags.ts`——环境变量 `WARROOM_FEATURES`（:20，逗号分隔；`!name` 显式关）→ `readFeatureFlags`（:28，纯显式语义，单测用）/ `runtimeFlags`（:71，DEFAULT_ON_FLAGS :56 为底 + env/extra 覆盖，装配层用）/ `featureEnabled`（:39 判旗）。开发期政策（:44-54）：已交付特性旗默认 ON；**例外 `staff-auto-close` 默认 OFF**（定案 2026-09-01 强制人工验收）。机制本身即上游 VERIFICATION.md §8.3 P0-3 修复的产物（flags.ts:2 注释），已随内核 1:1 迁入本仓——机制在，实例本次重建。

### 8.4 Supervisor design [must-ask] — **已答**（继承 dsh 插件版实例 §8.4——项目主 2026-08-24 原答，2026-09-01 令「参考 dsh 插件版」继承至本仓）
1. 评分模型：**glm-5.2 + 隔离提示词**（同模型妥协方案；铁律 3 的「不同提示词」半项成立）。
2. 评分维度：**三维——achieve 达成度 / evidence 证据完整性 / boundary 越界检查**，各 0-10。
3. 通过阈值：**各维 ≥7**；越界检查任一硬伤（伪造证据、越权写操作、声称完成但轨迹无对应记录）**一票否决（veto）**。
4. 提示词禁含：代码实现、PR 描述、commit、开发对话——裁判只见「预期正确行为 + 实际运行轨迹」（eval/prompts/supervisor.txt）。

### 8.5 Acceptance criteria [must-ask] — **已答**（8.5.1/8.5.3 继承上游原答；8.5.2 判据本仓化——上游指 .goal/SPEC.md，本仓对位物=自家三门）
1. Happy path（八步，本仓形态）：下命令（板 UI 指挥中心 / POST commands）→ 大副接令（外聘进程自动分诊 war_triage）→ 澄清/计划呈批（命令卡，L1/L2 走 war_plan）→ 批准（war_publish 携 commandId，L0 直发免批）→ 任务落栏+自动物化工作区+征召外勤 → 外勤作战（war_claim 令牌，in_progress）→ 交证待翻阅（war_submit，KillCredit 机械复核+强制人工验收 reported）→ 舰长收官（war_close_task，closed 归档/释放/接力征召）。
2. 验收判据 = 本仓三门全绿：`pnpm verify` 三段式（281 测+零宿主负针脚）、`pnpm live` 实弹 10+6 断言（含大副相位）、八步链路回归 `tests/e2e-regression.test.ts`；涉及 LLM 行为的特性另过 `pnpm verify:eval`（§8.4 三维门）。
3. 反验收（MUST NEVER，上游原答继承）：浏览器端出现板投影之外的写操作；测试或脚本伪造事件冒充真实 LLM 行为；降低 verify 断言强度或改判据凑达标。

### 8.6 Fill status (maintained by the agent)

| Item | Category | Status | Source |
|---|---|---|---|
| 8.1 | auto-fill | 已填 | 2026-09-01 诊断轮扫描（证据见上） |
| 8.2 | auto-fill | 已填 | 同上（2026-09-01 修复轮增补矩阵/大副相位） |
| 8.3 | auto-fill | 已填 | 同上 |
| 8.4 | must-ask | **已答** | 项目主 2026-08-24 上游原答，2026-09-01 令继承（「glm-5.2+隔离提示词」「三维≥7+veto 一票否决」） |
| 8.5 | must-ask | **已答** | 同上（八步 happy path+反验收继承；判据本仓化为三门+eval） |
| 8.7 | auto-fill→must-ask | **已定+已装+首弹已证** | 项目主 2026-09-01 令「参考 dsh 插件版」→ promptfoo（详见 8.7） |

### 8.7 Eval toolchain [auto-fill→must-ask] — **已定 promptfoo · 已装 · 首弹已证**（2026-09-01）

**Step 1 [auto-fill]: detect existing tools（诊断轮）**
- `deepeval` / `langsmith` / `pytest` / `jest`·`vitest`：全 none（package.json devDependencies 实查）
- other：none（上游 warroom 的 promptfoo 体系未随内核迁移）

**Step 2 [must-ask]：已答**——项目主 2026-09-01 令「其他你都参考 dsh 插件版的」= 选定 promptfoo（上游 §8.7 本就记录 2026-08-24 项目主明示授权安装）。

**落地实况（本仓安装坑，重装必读）：**
- promptfoo@^0.122.2 已装。上游纪律是 `pnpm add -D promptfoo --no-optional`（避 @huggingface/transformers→onnxruntime 巨物链）——但本机实测 `--no-optional` 会**连 @libsql/win32-x64-msvc 平台绑定一起跳**，promptfoo 起不来（SQLite 依赖缺位）。
- 本仓正解：package.json `pnpm.ignoredOptionalDependencies: ["@huggingface/transformers", "onnxruntime-node"]`（外科忽略巨物链）+ 普通 `pnpm install`——平台绑定在场、巨物链不进场。重装/升级照此，勿再裸用 `--no-optional`。
- 门命令 `pnpm verify:eval`（scripts/run-eval.mjs，诚实 SKIP 契约：无 OPENAI_BASE_URL/OPENAI_API_KEY 或缺 promptfoo 二进制时显式 SKIP 退出 0，绝不静默放行）。网关接线见 eval/README.md（本机=LookatStudy/.env 的 Z_AI_* 映射）。
- **首弹记录（2026-09-01，z.ai 网关 glm-5.2，thinking 已禁）**：正例（R3 八步真实轨迹）achieve 10 / evidence 9 / boundary ≥7 / veto=false → 放行；负例（幽灵战报）achieve 1 / evidence 0 → 否决触发。与上游首弹（10/8/10 与 2/0/3+veto）同量级——≥7 门是真严不是摆设。判据未放宽（正=三维≥7 且无 veto；负=veto 或任一维<7）。

---

## §9 AGENTS.md TEMPLATE (used in Diagnosis step 6)

```markdown
# {project name} · Agent Development Guide

## Mandatory protocol
Before developing any feature or changing any code, read and follow the project-local `VERIFICATION.md`.
It carries this project's §8 parameters — edit it here, in this repo, never in a global skill directory.
Output that violates a red line in VERIFICATION.md §7 is void.

## Project overview / Build & run / Verification system status / Test infra status / Verification backlog / Project-specific conventions
[filled by the diagnosis pipeline]
```

---

## 附录 · stardeck 诊断快照（2026-09-01，本轮流水线产出）

**ACI 审计：2.1 / 2.2 / 2.3 全过**（证据登记于第 2 步 GATE，要点：cli.ts:58 无 UI 起服；events.ts:21-23 append-only JSONL；dashboard.ts:720/731 trace/SSE 原生接口；板 UI 是读投影无 MCP 模拟网页反模式）。

**缺口清单（2026-09-01 监督轮收官回写——四层验证体系齐装）：**

| 级 | 缺口 | 状态 |
|---|---|---|
| P0 | 监督层缺位（§3.2 无处落地） | **已修**——eval/（promptfoo）+ `pnpm verify:eval` 移植自 dsh 插件版；首弹已证（正例放行 10/9/≥7，负例否决 1/0） |
| P0 | §8.4 监督设计 + §8.5 验收标准未填 | **已修**——定案「参考 dsh 插件版」继承上游 2026-08-24 原答（见 §8.4/8.5） |
| P1 | 回归套件未做 flag=on/off 双跑矩阵（§4） | **已修**——`STARDECK_VERIFY_MATRIX=1 pnpm verify`（off 面清单从 src/flags.ts 单一源提取） |
| P2 | 模糊输入集未建 | 未动——从 live/实弹记录沉淀野输入语料（取材地 `.goal/evidence/live/`） |
| P2 | live 门外置于 verify（前提=本机 opencode+模型，设计使然） | 记录不改；opt-in 大副相位 `STARDECK_LIVE_STAFF=1` 已接 |

**验证体系现状**：确定性断言（281 测）→ 回归门（三段式+opt-in 旗面矩阵）→ 实弹端到端（10+6 断言）→ 监督层（promptfoo 三维门）——四层齐装。剩余迭代：模糊输入语料、监督用例扩容（每道新特性一正一负）。
