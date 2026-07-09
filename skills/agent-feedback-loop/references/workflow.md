# Feedback To Rules Workflow

## 目标

把高信号 feedback 转成下一次 agent 能执行的长期规则。

## 输入

- 当前用户消息。
- Hook 注入的 pending durable feedback event。
- 当前对话中可见的 correction、review、失败复盘或行为观察。
- 当前项目已有规则、规范、手册、文档和配置。

## 执行步骤

1. 提取 feedback signal。
   - 只使用当前对话、hook event、文件 diff、测试结果、review 输出或用户纠正中可见的证据。
   - 不用记忆补造 feedback。
   - 没有可复用决策信号时，输出 `No durable update made`。

2. 判断是否 durable。
   - durable 条件：能改变未来多个任务里的 agent 决策。
   - 非 durable 条件：只适用于当前回答、当前文件、当前一次口吻或一次性偏好。
   - 非 durable 时，不写长期规则源。

3. 抽象原则。
   - 写成可复用决策规则。
   - 去掉事故细节、客户名、日期、ticket、日志和私有路径。
   - 保留会改变未来行为的判断条件、动作和禁止项。

4. 定位长期规则源。
   - 按 `source-discovery.md` 先查已知长期规则源。
   - 已知来源不足时，按 `source-discovery.md` 执行 grep 兜底。

5. 查重和查冲突。
   - 找相同规则。
   - 找相邻规则。
   - 找反向规则。
   - 重复时合并，不追加第二份。
   - 冲突时输出提案或待裁决。

6. 选择输出模式。
   - 唯一 owner、无冲突、可写、规则通过验证时，编辑文件。
   - owner 不唯一、存在冲突、项目不可写或用户只要提案时，输出提案。
   - feedback 不 durable 或会污染规则源时，输出不沉淀。

7. 验证结果。
   - 按 `validation.md` 运行编辑门、隐私门、重复门和输出门。
   - 改动指令或手册时，按本仓库的 `instruction-doc-audit` 规则做自检。

8. 标记 hook event。
   - 更新成功标记为 `updated`。
   - 提案标记为 `proposed`。
   - 不沉淀标记为 `no-durable-update`。
   - 阻塞且无法继续标记为 `blocked`。

## 禁止

- 禁止把用户原始抱怨直接写成规则。
- 禁止为了落地而创建并行规则源。
- 禁止跳过已有规则源查重。
- 禁止把未解决冲突写成已更新。
- 禁止让 hook 自己编辑长期规则源。
