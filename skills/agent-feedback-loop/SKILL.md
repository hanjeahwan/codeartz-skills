---
name: agent-feedback-loop
description: 当用户给出 agent 行为反馈、纠正、失败复盘、review 结论、长期规则源更新诉求，或说“以后 / 下次 / 记住 / 写进规则 / 更新手册 / 不要再”时使用。该技能把 feedback 抽象成可复用规则，优先合并到已知长期规则源；不知道 owner 时，通过项目 grep 和文档证据发现落点，查重、查冲突后再更新或提案。
---

# Agent Feedback Loop

## 使用时机

- 用户反馈会改变未来 agent 决策时，使用本技能。
- Hook 上下文提示存在 pending durable feedback event 时，使用本技能。

## 路由

- 读取 `references/workflow.md` 执行主流程。
- 需要定位规则源、查重或查冲突时，读取 `references/source-discovery.md`。
- 写入、提案或拒绝沉淀前，读取 `references/validation.md`。

## 全局边界

- Hook 只提供 feedback event 和上下文，不直接编辑长期规则源。
- 不创建持久规则源索引。
- 不预设 `SKILL.md` 是规则落点。
- 没有唯一 owner 时，不写文件。
- 反馈只是当前任务偏好时，不沉淀为长期规则。
- 禁止把事故细节、客户名、密钥、私有 URL、长日志或 ticket 细节写进长期规则。

## 禁止动作

- 禁止跳过查重。
- 禁止跳过查冲突。
- 禁止把未解决冲突写成已更新。
- 禁止让 hook 自己编辑长期规则源。
