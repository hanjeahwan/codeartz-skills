---
name: agent-evolve
description: 当主会话需要根据用户直接反馈改进未来项目决策，或用户手动调用 Agent Evolve 评估、提案、批准沉淀时使用。该技能按 safe、review、off 模式路由，把可复用反馈安全合并到未来 agent 会读取的项目已有规则源，并为每条候选提供原因与证据。
---

# Agent Evolve

## 触发条件

- 上下文存在 `AGENT EVOLVE ACTIVE — mode: safe` 时，对当前主会话中直接来自用户的反馈自动运行本技能。
- 上下文存在 `AGENT EVOLVE ACTIVE — mode: review` 时，对当前主会话中直接来自用户的反馈自动运行本技能。
- 用户手动调用 `$agent-evolve` 时运行本技能。
- 是否触发反馈处理由完整语义决定，不由关键词决定。

## 模式路由

- `safe`（安全沉淀）：使用当前上下文已注入的 `# Agent Evolve 工作流` 与 `# Agent Evolve 安全验证`，进入安全沉淀模式。
- `review`（审核后沉淀）：使用当前上下文已注入的 `# Agent Evolve 工作流` 与 `# Agent Evolve 安全验证`，进入审核后沉淀模式。
- 激活路径禁止再次读取 plugin-relative `references/*`。
- 用户手动调用 `$agent-evolve`，且当前上下文没有 `AGENT EVOLVE ACTIVE — mode: safe|review` 时，进入关闭模式下的手动调用。
- 关闭模式下的手动调用仅在当前上下文缺少完整章节时，才读取相对 `references/workflow.md` 与 `references/validation.md`。

## 全局边界

- 只在与用户对话的主会话自动处理。
- 先继续完成当前用户任务，再在同一轮完成反馈决策。

## 禁止动作

- 禁止扫描完整对话记录做会后复盘。
- 禁止使用模型记忆补造反馈。
- 禁止创建反馈收集箱。
- 禁止自动提交 git commit。
- 禁止启动额外 agent 轮次处理反馈。
