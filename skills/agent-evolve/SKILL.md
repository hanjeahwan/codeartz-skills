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

- `safe`：使用当前上下文已注入的 `# Agent Evolve Workflow` 与 `# Agent Evolve Validation`，进入 `Safe mode`。
- `review`：使用当前上下文已注入的 `# Agent Evolve Workflow` 与 `# Agent Evolve Validation`，进入 `Review mode`。
- Active route 禁止再次读取 plugin-relative `references/*`。
- 用户手动调用 `$agent-evolve`，且当前上下文没有 `AGENT EVOLVE ACTIVE — mode: safe|review` 时，进入 `Off mode 的手动调用`。
- Manual-off 当前上下文缺少完整章节时，才读取相对 `references/workflow.md` 与 `references/validation.md`。

## 全局边界

- 只在与 human 对话的主 session 自动处理。
- 先继续完成当前用户任务，再在同一轮完成 feedback 决策。

## 禁止动作

- 禁止扫描完整 transcript 做会后复盘。
- 禁止使用模型记忆补造 feedback。
- 禁止创建 feedback inbox。
- 禁止自动提交 git commit。
- 禁止启动额外 agent turn 处理 feedback。
