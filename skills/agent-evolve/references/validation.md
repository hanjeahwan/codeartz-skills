# Agent Evolve Validation

## 目标

在更新、提案或不沉淀前验证安全性，并为每条 feedback 候选生成可核对的 `Why + Evidence` 回执。

## 安全门

直接写入必须同时满足：

- Workflow 已把当前 human 内容判定为可复用 feedback 候选。
- Workflow 已生成不依赖私有事故上下文的抽象规则。
- Workflow 已提供唯一 owner。
- Workflow 已提供未来 agent 读取路径证据。
- 目标文件可写。
- Workflow 已判定没有相同规则需要标记为 `Already covered`。
- Workflow 已判定没有未解决冲突。
- 抽象规则与 Evidence 不包含敏感内容。
- Workflow 已判定当前 mode 允许写入。

- 任一安全门失败时禁止直接写入。

## 敏感内容门

规则与 Evidence 都不得保存或复述：

- 密钥。
- 私有 URL。
- 邮箱。
- 客户名。
- ticket 编号。
- 事故名称或事故细节。
- 私有项目标识。
- 长日志或原始堆栈。

- 只保留经过抽象、仍会改变未来决策的语义。
- 实际错误包含敏感内容时，先脱敏再写入 Evidence。

## Evidence 门

- `Why` 写明本次决策的直接原因。
- `Evidence` 引用 human 消息中会改变未来决策的语义，不复制敏感原文。
- 文件证据写明文件和标题或行号。
- 声明目标唯一时写明检查过的候选范围。
- 声明没有重复时写明查重范围。
- 声明没有冲突时写明检查过的相邻规则、反向规则或候选文件。
- 声明后续 session 会受益时写明自动加载机制或现有项目指令路由。
- 更新成功时引用实际 diff 或重新读取结果。
- 测试或 review 参与判断时写明命令、结果或结论位置。
- 禁止只写“已检查”“符合要求”或“判断安全”。

## 决策选择

- 安全写入成功：`Updated`。
- 已有规则语义相同：`Already covered`。
- 当前 mode、owner、读取路径或冲突条件不允许直接写，但存在精确建议：`Proposed`。
- 内容只适用于当前任务，或不适合作为长期规则：`Not persisted`。
- 已尝试的读取、状态、写入或验证动作失败：`Failed`。

- 同一轮存在多条 feedback 候选时，每条候选分别输出 `Decision`、`Why` 和 `Evidence`。
- 多条回执可以放在同一个紧凑区块中。
- 禁止用一条汇总结论覆盖不同候选的处理结果。
- 字段名必须精确使用 `Feedback decision`、`Why`、`Evidence`、`Target` 与 `Change`。
- 禁止翻译、改写或追加括号说明。

## 回执模板

### Updated

```text
Feedback decision: Updated
Why: <为什么该反馈会改变未来项目决策>
Evidence: <为什么该位置唯一、未来 agent 会读取、无重复且无冲突；以及实际 diff 证据>
Target: <文件和标题>
Change: <写入后的抽象规则>
```

### Already covered

```text
Feedback decision: Already covered
Why: 不应生成第二份相同规则。
Evidence: <现有文件、标题或行号，以及查重范围>
Target: <已有规则的文件和标题>
Change: 不适用
```

### Proposed

```text
Feedback decision: Proposed
Why: <为什么当前 mode 或安全门不允许直接写入>
Evidence: <候选位置、未来读取路径、冲突或缺失证据>
Target: <建议文件和标题>
Change: <精确提案>
```

### Not persisted

```text
Feedback decision: Not persisted
Why: <为什么反馈不适合成为长期项目规则>
Evidence: <当前 human 消息中的范围证据或项目证据>
Target: 不适用
Change: 不适用
```

### Failed

```text
Feedback decision: Failed
Why: <失败动作>
Evidence: <脱敏后的实际错误或验证结果>
Target: <尝试修改的文件或不适用>
Change: 不适用
```

## 失败边界

- Feedback 处理失败不得阻止当前用户任务继续完成。
- 读取目标失败时不声称已完成查重或查冲突。
- 写入失败时不声称规则已更新。
- Diff 验证失败时使用 `Failed` 回执。
