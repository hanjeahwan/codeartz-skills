<p>
  <img src="assets/logo.png" width="220" alt="Codeartz Skills logo">
</p>

一组处理真实工程协作问题的 Agent Skills：需求说不清、资料互相冲突、明确目标缺少执行结构、最终变更差异缺少整体审查、项目知识缺失、规则手册不可执行，以及用户纠正或任务证据无法变成下一次会话可用的规则。

它们不会替你接管完整开发流程，也不会保证代理自动做对。每个 Skill 只负责一个边界明确的问题，可以单独使用，也可以按需要组合。

## 快速开始

从仓库选择并安装 Skills：

```bash
npx skills add https://github.com/hanjeahwan/codeartz-skills
```

只安装一个 Skill：

```bash
npx skills add https://github.com/hanjeahwan/codeartz-skills --skill target-boundary
```

安装后，在支持 Skills 的代理中直接描述任务；符合触发条件时由模型加载对应 Skill。`agent-evolve` 的自动模式需要通过插件安装，独立安装只能手动调用。

## 为什么需要这些 Skills

### 1. 用户还不知道自己真正想要什么

**现实问题：** 一句模糊想法往往对应多个完全不同的设计方向。代理如果立刻写方案，只是在替用户猜。

**对应 Skill：** [`agentic-design-navigator`](skills/agentic-design-navigator/) 通过反映、关键区分、判断探针和单点追问形成设计意图基线，再基于同一基线比较方向；用户明确转向时更新基线，只有未经确认的替换才判定为意图漂移。

**实际结果：** 普通回合只展示新增、修正或冲突，九个设计维度作为后台导航地图。设计意图足以支持选择后，再生成少量具有实质差异的方向；它不会为了填满维度或方案数量补造内容。

### 2. 设计意图明确，但还不能直接进入工程拆分

**现实问题：** 设计方向已经清楚，产品行为、验收、当前代码事实和技术约束却仍散落在不同材料里。直接拆任务会迫使执行者重新解释需求，分别写 PRD 和 Tech Spec 又容易产生两套行为定义。

**对应 Skill：** [`define-product-spec`](skills/define-product-spec/) 把明确的产品意图收敛为同一份 PRD 与 Tech Spec，用稳定行为编号连接产品合同和技术承载，并从固定章节目录中按实际边界组合内容，保留事实、决定、假设、冲突与未决项的真实状态。

**实际结果：** 默认写入 `docs/specs/<spec-name>.md`。新规格从 `draft` 或 `review` 开始，只有用户明确确认当前版本后才进入 `approved`；文档状态不替代 `to-task` 对输入充分性的独立判断。

### 3. 需求、问题单、审查备注和代码事实混在一起

**现实问题：** 文档说要改，代码却有多个入口；某个案例需要修，不代表所有变体都应该一起改变。直接实现很容易扩大范围或修错层级。

**对应 Skill：** [`target-boundary`](skills/target-boundary/) 把用户资料先当作假设，再检查仓库事实，明确适用范围、保持原行为、未知、冲突和待裁决项。

**实际结果：** 显式调用默认分析并生成目标边界合同；只有明确要求只分析、不落盘时才停在对话。代码事实、语义边界、目标合同和产物关卡通过后，写入 `.codeartz/<topic>/boundary.md`；否则只输出事实或合同缺口。该文件保存唯一已采纳的目标边界约束、关键证据和开工入口，但不替代仓库、项目规则、测试或实现设计。Codex 只允许通过 `$target-boundary` 显式调用；其他宿主使用各自的显式 Skill 调用语法。

### 4. 目标明确，但任务拆分拖慢执行

**现实问题：** 中大型目标已经足够清楚，再生成完整影响分析和详细实现方案只会增加等待；按前端、后端、测试拆分又会产生无法独立验证的提交。

**对应 Skill：** [`to-task`](skills/to-task/) 只读取足以确认切分边界的代码，把目标纵向拆成少量语义任务，并标明提交、直接验证、依赖和严格的 `parallel-safe` 条件。

**实际结果：** 默认把最小任务图写入 `.codeartz/<topic>/tasks.md`，使用执行基线、任务索引、短任务卡片和组合关卡支持中断恢复；显式要求只在对话返回时不落盘。执行者可以串行领取，或在写集、共享状态和验证均独立时交给不同子代理；Skill 本身不修改实现、不创建 worktree，也不提交 Git。

### 5. 单个提交通过，但组合后仍可能失败

**现实问题：** 每个任务的局部测试通过，不代表完整提交范围没有权限回归、数据契约冲突、未授权修改或部署顺序问题。

**对应 Skill：** [`code-review`](skills/code-review/) 以最终变更差异（Diff）为主要证据，必要时按提交定位引入点，再检查完整提交范围的目标覆盖、保持边界和跨提交组合行为。

**实际结果：** 先输出包含位置、风险、触发场景、证据和修复方向的审查发现，再返回“需修复、不完整或通过”。没有真实变更差异或证据不完整时不会给出通过；默认只读，不修改代码。

### 6. 项目知识缺失或已经落后于代码

**现实问题：** 项目缺少可靠、可追溯且能被未来代理读取的架构、领域与开发约定，或者现有项目知识已经落后于代码。代理只能临时从仓库推断，容易把当前实现误认为长期规范。

**对应 Skill：** [`project-foundation`](skills/project-foundation/) 从仓库证据建立当前草稿，区分代码事实、稳定模式、设计推断、冲突、知识缺口和技术债；证据无法确定唯一方向时，再交给用户裁决。

**实际结果：** 草稿通过确定性验证和语义验证，并且用户批准对应内容后，建立或刷新项目知识；只有需要时才调整读取路由。它不会把未经确认的推断直接写成正式规则。

### 7. 规则手册看起来完整，但代理仍会漏执行

**现实问题：** 一句话同时塞进条件、动作、禁止和例外，或依赖多层缩进表达分支。人能读懂，模型却容易只执行前半句。

**对应 Skill：** [`instruction-doc-audit`](skills/instruction-doc-audit/) 审查指令、规范、政策、提示词和 Skill 文档，把简单规则压平，把互斥分支改成显式命名槽位，并检查重复权威位置与语言一致性。

**实际结果：** 审查报告，或在编辑模式下直接修改文档。它不用于审查普通说明文、实施计划或产品 spec。

### 8. 项目中的有效判断随对话结束而丢失，未来 Agent 重复犯错

**现实问题：** 用户纠正、项目约束、代码、测试和审查经常产生会影响未来决策的判断，但普通任务只完成当前交付。没有主动发现、交付独立性、模式授权、去重、冲突检查和读取路径，这些判断会在会话结束后丢失；直接保存所有“有用信息”又会制造错误长期记忆。

**对应 Skill：** [`agent-evolve`](skills/agent-evolve/) 在当前项目主会话中持续发现独立于任务交付、会改变未来 Agent 行动的规则候选。它保留候选来源，寻找唯一权威位置和已有读取路径，再查重、查冲突并按模式处理；当前任务本来仍须交付的条件、后果和作用域即使写入不同文件，也不计作沉淀。

**实际结果：** `safe` 模式把模式本身视为当前项目写入预授权，任何来源的候选通过安全门后自动沉淀；`review` 只提案；`off` 只响应手动调用。回执使用“已沉淀、已有规则覆盖、待审核、未沉淀或处理失败”，并明确标识 Agent Evolve。当前事实、局部细节、一次性要求、空泛目标、无佐证观察、任务交付本身以及个人级或跨项目规则不会自动沉淀。

## 如何组合使用

这些 Skills 不是必须完整执行的流水线：

```text
模糊想法 ── agentic-design-navigator ──► 暂定目标、设计意图基线与方向比较
明确意图 ── define-product-spec ───────► docs/specs/ 中的 PRD 与 Tech Spec
混合资料 ── target-boundary ──────────► 目标边界或证据缺口
明确目标 ── to-task ─────────────────► 可提交、可验证的最小任务图
最终变更差异 ── code-review ─────────► 审查发现、疑问、验证缺口或通过
项目失忆 ── project-foundation ───────► 经验证和批准的项目知识
规则失效 ── instruction-doc-audit ────► 可独立执行的规则
对话中的未来决策 ── agent-evolve ────► 沉淀、覆盖、待审核或未沉淀
```

只使用当前问题需要的 Skill。比如需求已经明确，就不需要先运行意图导航；只想审查一份规则手册，也不需要建立完整项目知识。

## Skills 索引

| Skill                                                          | 何时使用                                     | 写入或输出什么                       |
| -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| [`agentic-design-navigator`](skills/agentic-design-navigator/) | 输入模糊、存在竞争理解或设计方向发生变化     | 暂定目标、设计意图基线与方向比较     |
| [`define-product-spec`](skills/define-product-spec/)           | 明确意图需要收敛为产品与技术规格             | `docs/specs/` 中的 PRD 与 Tech Spec  |
| [`target-boundary`](skills/target-boundary/)                   | 需求资料与现有系统事实混杂                   | 关卡通过后写入唯一目标边界合同       |
| [`to-task`](skills/to-task/)                                   | 明确的中大型目标需要轻量执行结构             | `.codeartz/<topic>/tasks.md`         |
| [`code-review`](skills/code-review/)                           | 最终变更差异或提交范围需要合并前审查         | 审查发现、验证缺口或通过结论         |
| [`project-foundation`](skills/project-foundation/)             | 项目知识缺失或需要跟随代码刷新               | 当前草稿；验证并批准后的项目知识     |
| [`instruction-doc-audit`](skills/instruction-doc-audit/)       | 指令文档存在隐式分支、深嵌套、重复或语言问题 | 审查结果或修改后的规则文档           |
| [`agent-evolve`](skills/agent-evolve/)                         | 对话中出现独立于任务交付的未来项目决策       | 已沉淀、待审核、已有规则覆盖或未沉淀 |

## Agent Evolve 模式

插件安装时，Agent Evolve 通过生命周期钩子工作。默认模式是 `safe`。

| 模式     | 自动识别候选 | 行为                                                   |
| -------- | ------------ | ------------------------------------------------------ |
| `safe`   | 是           | 任何来源的候选通过安全门后自动写入当前项目，否则待审核 |
| `review` | 是           | 只给出提案，用户批准精确规则和位置后再写入             |
| `off`    | 否           | 不主动发现或持久化，仍可手动调用 Skill                 |

切换当前会话：

```text
$agent-evolve safe
$agent-evolve review
$agent-evolve off
```

设置后续新会话的默认值：

```text
$agent-evolve default safe
$agent-evolve default review
$agent-evolve default off
```

## 插件安装

### Claude Code

```text
/plugin marketplace add hanjeahwan/codeartz-skills
/plugin install codeartz-skills@codeartz
```

### Codex

```bash
codex plugin marketplace add hanjeahwan/codeartz-skills
codex plugin add codeartz-skills@codeartz
```

插件包含 `SessionStart`、`UserPromptSubmit` 与 `PermissionRequest` hooks。安装后先审查并信任这些 hooks，再重启应用或开启新会话。

## 这个仓库不做什么

- 不替代需求确认、代码审查、测试或人的最终裁决。
- 不提供一个接管问题单到部署全过程的总控框架。
- 不把每次对话、每个建议或每次失败都写进长期规则。
- 不保证所有宿主都支持相同的插件钩子；独立安装的 Skills 不包含生命周期钩子。
- 不把尚未验证的项目推断包装成事实。
