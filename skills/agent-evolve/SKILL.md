---
name: agent-evolve
description: 当主会话出现已明确收敛且会改变未来项目决策的直接用户反馈、用户明确确认连续修正的终态，或用户手动调用 Agent Evolve 评估、提案、批准沉淀时使用。
---

# Agent Evolve

## 触发条件

- 上下文存在 `AGENT EVOLVE ACTIVE — mode: safe` 或 `AGENT EVOLVE ACTIVE — mode: review` 时，只对已明确收敛的直接用户反馈自动运行本技能。
- 当前结果仍在修正或验收时，不自动运行本技能。
- 用户明确确认连续修正的终态后，自动运行本技能。
- 用户手动调用 `$agent-evolve` 时运行本技能。
- 是否触发反馈处理由完整语义决定，不由关键词决定。

## 模式路由

- `safe`（安全沉淀）：读取相对 `references/workflow.md`，进入安全沉淀模式。
- `review`（审核后沉淀）：读取相对 `references/workflow.md`，进入审核后沉淀模式。
- 进入工作流时禁止预读 `references/validation.md`。
- 工作流明确进入安全验证阶段时，读取相对 `references/validation.md`。
- 用户手动调用 `$agent-evolve`，且当前上下文没有 `AGENT EVOLVE ACTIVE — mode: safe|review` 时，进入关闭模式下的手动调用。
- 关闭模式下的手动调用读取相对 `references/workflow.md`。

## 全局边界

- 只在与用户对话的主会话自动处理。
- 先继续完成当前用户任务，再在同一轮完成反馈决策。

## 禁止动作

- 禁止扫描完整对话记录做会后复盘。
- 禁止使用模型记忆补造反馈。
- 禁止创建反馈收集箱。
- 禁止自动提交 git commit。
- 禁止启动额外 agent 轮次处理反馈。
