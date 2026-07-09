# Validation

## 编辑门

直接编辑必须全部通过：

- feedback 是长期规则。
- 已找到唯一 owner。
- 已查重。
- 已查冲突。
- 新规则能独立勾选。
- 新规则有明确触发条件或适用边界。
- 新规则没有保存敏感细节。
- 用户没有要求只提案。

任一失败时，不直接编辑。

## 隐私门

长期规则禁止保存：

- 客户名。
- 私有项目名。
- ticket 编号。
- 邮箱。
- 密钥。
- 私有 URL。
- 长日志。
- 原始事故细节。
- 可识别个人或组织的上下文。

需要保留来源时，只写抽象来源，例如“用户反馈指出该行为会导致规则漂移”。

## 规则质量门

每条新增或改写规则必须满足：

- 一条规则只表达一个动作或约束。
- 条件、动作、禁止分开写。
- 有互斥分支时，用命名槽位。
- 不使用“适当”“合理”“高质量”这类不可测词。
- 不用示例替代规则。

## 输入合同

- Hook 额外上下文若出现 `Event path: <path>`，必须原样提取 `<path>`，保存为 `eventPath`。
- 调用 `node hooks/agent-feedback-state.js mark` 时，必须使用这个 `eventPath`，不改写、不拼接、不猜测。
- 如果存在 pending event 但没有可用 `eventPath`，不要补造路径；将处理判为 `blocked`，不要冒充已完成标记。

## 事件状态标记

处理 hook event 后运行：

```bash
node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>
```

状态含义：

- `updated`：已修改长期规则源。
- `proposed`：已输出提案，但未修改长期规则源。
- `no-durable-update`：feedback 不适合沉淀。
- `blocked`：缺少 owner、权限、上下文或用户裁决，无法继续。

## 输出格式

更新成功：

```markdown
Updated: <file path>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Merge strategy: <merged existing rule / rewritten section / removed duplicate>
Validation: <checks passed>
Verification: <commands run or reason not run>
```

只提案：

```markdown
Proposed target: <file path and heading>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Reason: <why direct edit was not safe>
Proposed text: <exact text to merge>
Validation: <checks passed>
Verification: <evidence used to verify target>
```

不沉淀：

```markdown
No durable update made.
Reason: <why the feedback was not durable, coherent, safe, or actionable>
```

## 验证命令

当前仓库改动完成后运行：

```bash
npm test
npm run format:all
npm run lint
```

如果只修改 Markdown 且 lint 无匹配代码，仍运行 `npm test` 和 `npm run format:all`。
