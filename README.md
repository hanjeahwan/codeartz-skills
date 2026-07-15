<p>
  <img src="assets/logo.png" width="220" alt="Codeartz Skills logo">
</p>

一组处理真实工程协作问题的 Agent Skills：需求说不清、资料互相冲突、项目知识缺失、规则手册不可执行，以及用户纠正无法留到下一次会话。

它们不会替你接管完整开发流程，也不会保证 agent 自动做对。每个 skill 只负责一个边界明确的问题，可以单独使用，也可以按需要组合。

## 快速开始

从仓库选择并安装 Skills：

```bash
npx skills add https://github.com/hanjeahwan/codeartz-skills
```

只安装一个 skill：

```bash
npx skills add https://github.com/hanjeahwan/codeartz-skills --skill target-boundary
```

安装后，在支持 Skills 的 agent 中直接描述任务；符合触发条件时由模型加载对应 skill。`agent-evolve` 的自动模式需要通过插件安装，standalone 安装只能手动调用。

## 为什么需要这些 Skills

### 1. 用户还不知道自己真正想要什么

**现实问题：** 一句模糊想法往往对应多个完全不同的设计方向。agent 如果立刻写方案，只是在替用户猜。

**对应 skill：** [`agentic-design-navigator`](skills/agentic-design-navigator/) 通过反映、关键区分、判断探针和单点追问形成设计意图基线，再基于同一基线比较方向；用户明确转向时更新基线，只有未经确认的替换才判定为意图漂移。

**实际结果：** 普通回合只展示新增、修正或冲突，九个设计维度作为后台导航地图。设计意图足以支持选择后，再生成少量具有实质差异的方向；它不会为了填满维度或方案数量补造内容。

### 2. 需求、issue、review notes 和代码事实混在一起

**现实问题：** 文档说要改，代码却有多个入口；某个案例需要修，不代表所有变体都应该一起改变。直接实现很容易扩大范围或修错层级。

**对应 skill：** [`target-boundary`](skills/target-boundary/) 把用户资料先当作假设，再检查仓库事实，明确适用范围、保持原行为、未知、冲突和待裁决项。

**实际结果：** 代码事实、语义边界、目标合同和产物关卡通过后，写入 `.codeartz/<topic>/target-boundary.md`；否则只输出事实或合同缺口。该文件保存唯一已采纳的目标边界约束、关键证据和开工入口，但不替代仓库、项目规则、测试或实现设计。Codex 只允许通过 `$target-boundary` 显式调用；其他宿主使用各自的显式 Skill 调用语法。

### 3. 项目知识缺失或已经落后于代码

**现实问题：** 项目缺少可靠、可追溯且能被未来 agent 读取的架构、领域与开发约定，或者现有项目知识已经落后于代码。agent 只能临时从仓库推断，容易把当前实现误认为长期规范。

**对应 skill：** [`project-foundation`](skills/project-foundation/) 从仓库证据建立当前草稿，区分代码事实、稳定模式、设计推断、冲突、知识缺口和技术债；证据无法确定唯一方向时，再交给用户裁决。

**实际结果：** 草稿通过确定性验证和语义验证，并且用户批准对应内容后，建立或刷新项目知识；只有需要时才调整读取路由。它不会把未经确认的推断直接写成正式规则。

### 4. 规则手册看起来完整，但 agent 仍会漏执行

**现实问题：** 一句话同时塞进条件、动作、禁止和例外，或依赖多层缩进表达分支。人能读懂，模型却容易只执行前半句。

**对应 skill：** [`instruction-doc-audit`](skills/instruction-doc-audit/) 审查指令、规范、政策、提示词和 Skill 文档，把简单规则压平，把互斥分支改成显式命名槽位，并检查重复权威位置与语言一致性。

**实际结果：** 审查报告，或在编辑模式下直接修改文档。它不用于审查普通说明文、实施计划或产品 spec。

### 5. 用户纠正了 agent，但下一次会话仍会犯同样的错

**现实问题：** 对话里的有效反馈通常只修复当前结果。没有去重、冲突检查和读取路径，直接“记住它”又会制造散落规则和错误长期记忆。

**对应 skill：** [`agent-evolve`](skills/agent-evolve/) 判断反馈是否能跨任务复用，寻找唯一权威位置和已有读取路径，再查重、查冲突并进行安全验证；缺少读取路径时，只提出增加路由的建议。

**实际结果：** 给出“已更新、已有规则覆盖、已提案、不沉淀或处理失败”之一。只有语义已收敛、唯一权威位置、读取路径、无重复和无冲突等安全门全部通过时才自动写入。只有当前细节、明确禁止泛化或没有具体原则的普通否定不会触发；一次性任务中可独立复用的原因、失败机制和决策边界仍会被评估。

## 如何组合使用

这些 skills 不是必须完整执行的流水线：

```text
模糊想法 ── agentic-design-navigator ──► 暂定目标、设计意图基线与方向比较
混合资料 ── target-boundary ──────────► 目标边界或证据缺口
项目失忆 ── project-foundation ───────► 经验证和批准的项目知识
规则失效 ── instruction-doc-audit ────► 可独立执行的规则
用户纠正 ── agent-evolve ─────────────► 更新、覆盖、提案或不沉淀
```

只使用当前问题需要的 skill。比如需求已经明确，就不需要先运行意图导航；只想审查一份规则手册，也不需要建立完整项目知识。

## Skills 索引

| Skill                                                          | 何时使用                                     | 写入或输出什么                       |
| -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| [`agentic-design-navigator`](skills/agentic-design-navigator/) | 输入模糊、存在竞争理解或设计方向发生变化     | 暂定目标、设计意图基线与方向比较     |
| [`target-boundary`](skills/target-boundary/)                   | 需求资料与现有系统事实混杂                   | 关卡通过后写入唯一目标边界合同       |
| [`project-foundation`](skills/project-foundation/)             | 项目知识缺失或需要跟随代码刷新               | 当前草稿；验证并批准后的项目知识     |
| [`instruction-doc-audit`](skills/instruction-doc-audit/)       | 指令文档存在隐式分支、深嵌套、重复或语言问题 | 审查结果或修改后的规则文档           |
| [`agent-evolve`](skills/agent-evolve/)                         | 用户反馈会改变未来项目决策                   | 已更新、已提案、已有规则覆盖或不沉淀 |

## Agent Evolve 模式

插件安装时，Agent Evolve 通过 lifecycle hooks 工作。默认模式是 `safe`。

| 模式     | 自动识别反馈 | 行为                                       |
| -------- | ------------ | ------------------------------------------ |
| `safe`   | 是           | 安全门全部通过时更新已有规则，否则给出提案 |
| `review` | 是           | 只给出提案，用户批准精确变更后再写入       |
| `off`    | 否           | 不自动处理，仍可手动调用 skill             |

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
- 不提供一个接管 issue 到部署全过程的总控框架。
- 不把每次对话、每个建议或每次失败都写进长期规则。
- 不保证所有宿主都支持相同的 plugin hooks；standalone skills 不包含 lifecycle hooks。
- 不把尚未验证的项目推断包装成事实。
