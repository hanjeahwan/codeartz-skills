---
name: agent-evolve
description: 当主 session 需要根据直接 human feedback 改进未来项目决策，或用户手动调用 Agent Evolve 评估、提案、批准沉淀时使用。该技能按 safe、review、off mode 路由，把可复用反馈安全合并到未来 agent 会读取的项目已有规则源，并为每条候选提供 Why + Evidence。
---

# Agent Evolve

## 触发条件

- 上下文存在 `AGENT EVOLVE ACTIVE — mode: safe` 时，对当前主 session 中直接来自 human 的 feedback 自动运行本技能。
- 上下文存在 `AGENT EVOLVE ACTIVE — mode: review` 时，对当前主 session 中直接来自 human 的 feedback 自动运行本技能。
- 用户手动调用 `$agent-evolve` 时运行本技能。
- Feedback 是否触发由完整语义决定，不由关键词决定。

## Mode 路由

- `safe`：读取 `references/workflow.md` 完成候选判断与落点分析；读取 `references/validation.md`；全部安全门通过时可以直接更新。
- `review`：读取 `references/workflow.md` 完成候选判断与精确提案；读取 `references/validation.md`；用户批准前不更新项目规则源。
- `off`：不自动运行；用户手动调用时读取 `references/workflow.md` 与 `references/validation.md`，只处理本次显式请求。

## 全局边界

- 只处理直接来自 human 的 feedback。
- 只在与 human 对话的主 session 自动处理。
- 先继续完成当前用户任务，再在同一轮完成 feedback 决策。
- Feedback 处理失败不得阻止当前用户任务继续完成。
- 每条 feedback 候选分别提供 `Decision`、`Why` 和 `Evidence`。
- 只使用当前可见对话、项目文件、diff、测试与 review 证据。
- 用户明确批准 review 提案后，按批准内容重新读取目标并再次验证。

## 禁止动作

- 禁止处理 Subagent 产生的观察、建议或未获 human 确认的 review finding。
- 禁止扫描完整 transcript 做会后复盘。
- 禁止使用模型记忆补造 feedback。
- 禁止创建 feedback inbox。
- 禁止创建随机规则文件绕过 owner 不明确。
- 禁止自动提交 git commit。
- 禁止启动额外 agent turn 处理 feedback。
