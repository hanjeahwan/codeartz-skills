# Agent Evolve 设计规范

> 状态:已批准,待实施。
> 日期:2026-07-10。

## 目标

让直接与用户对话的主 agent 在每个项目 session 中自动识别可复用的人类 feedback,并把 feedback 安全沉淀到项目已有的长期规则源。

- 用户正常纠正 agent,不需要额外说“记住”或“写进规则”。
- 当前 session 沉淀的规则能让后续项目 session 直接受益。
- 每次沉淀或不沉淀都必须提供 `Why + Evidence`。
- 用户可以切换自动沉淀策略,也可以完全关闭自动注入。

## 用户收益

- 零额外操作:用户继续用自然语言给出代码模式、架构、规范、边界和实践反馈。
- 跨 session 生效:反馈写入项目长期规则源,不依赖当前对话继续存在。
- 非黑箱:agent 必须展示决策、原因、证据和实际改动。
- 不打断任务:feedback 处理与当前任务在同一轮完成,不创建额外续跑。
- 可控:用户可以为当前 session 或后续新 session 选择 `safe`、`review` 或 `off`。

## 范围

- 支持 Codex。
- 支持 Claude Code。
- 只处理直接来自 human 的 feedback。
- 只在 human-facing 主 session 注入行为。
- 支持独立 session 并发运行。
- 支持自动更新项目已有规则源。
- 只把未来 agent 会自动加载或按现有路由读取的文件视为可自动写入的长期规则源。
- 支持用户批准后再写入的 review 流程。

## 非目标

- 不处理 subagent 自己产生的观察、建议或 review 结论。
- 不把普通任务要求全部当成长期 feedback。
- 不训练模型。
- 不微调模型。
- 不创建 feedback inbox。
- 不使用 regex 判断一条普通消息是不是 feedback。
- 不扫描完整 transcript 做会后复盘。
- 不自动提交 git commit。
- 不保留 `agent-feedback-loop` 的任何向后兼容入口。

## 用户体验合同

1. 用户进入一个项目 session。
2. `SessionStart` 根据当前 mode 决定是否注入 Agent Evolve 入口规则。
3. 用户正常执行任务并给出 feedback。
4. 主 agent 根据完整语义判断 feedback 是否会改变未来项目决策。
5. 主 agent 继续完成当前任务。
6. 主 agent 按当前 mode 处理 feedback。
7. 主 agent 为每个 feedback 决策输出 `Why + Evidence`。
8. 后续 session 从已更新的项目规则源获得行为约束。

## Lifecycle 设计

### SessionStart

- 触发范围:`startup|resume|clear|compact`。
- 输入:hook 提供的 `session_id`、`cwd` 和运行时环境。
- 检查项:当前 session mode 是否已经固化。
- 检查项:持久默认 mode 是什么。
- 处理方式:当前 session mode 已存在时直接读取该 mode。
- 处理方式:当前 session mode 不存在时从持久默认 mode 固化一份 session mode。
- 处理方式:`safe` 或 `review` 时注入包含有效 mode 的激活头。
- 处理方式:`safe` 或 `review` 时读取并注入 `skills/agent-evolve/SKILL.md`。
- 处理方式:`off` 时不注入 `skills/agent-evolve/SKILL.md`。
- 处理方式:激活成功时不显示额外启动提示。
- 禁止:不读取用户 prompt。
- 禁止:不判断 feedback。
- 禁止:不编辑项目文件。

### UserPromptSubmit

- 作用:只处理 Agent Evolve mode 控制命令。
- 放行条件:prompt 是完整、合法的 Agent Evolve mode 命令。
- 失败条件:prompt 不是完整控制命令。
- 处理方式:失败条件命中时立即静默退出。
- 处理方式:session mode 命令更新当前 session mode。
- 处理方式:default mode 命令更新持久默认配置。
- 处理方式:切换到 `safe` 或 `review` 后注入新的 mode 激活头和 Skill 入口规则。
- 处理方式:切换到 `off` 后注入关闭自动行为的 mode 上下文。
- 处理方式:mode 切换成功后显示当前 mode 和持久默认 mode。
- 禁止:不使用关键词、语义或 regex 分类普通 feedback。
- 禁止:不因普通消息中出现 `feedback`、`safe`、`review`、`on` 或 `off` 改变状态。

控制命令只接受当前名称:

```text
$agent-evolve safe
$agent-evolve review
$agent-evolve off
$agent-evolve default safe
$agent-evolve default review
$agent-evolve default off
```

运行时可以接受宿主为同一 Skill 提供的 `/` 或 `@` 调用前缀。这些前缀属于宿主适配,不是旧名称兼容。

### 明确不使用的 lifecycle

- 不使用 `SubagentStart`。
- 不使用 `SubagentStop`。
- 不使用 `Stop`。
- 不使用 `SessionEnd`。
- 不使用 pending event 驱动额外 agent turn。

## 组件与权威位置

### Session 激活 hook

- 唯一职责:解析 mode 并注入 Skill 入口规则。
- 规则来源:`skills/agent-evolve/SKILL.md`。
- 注入前移除 frontmatter。
- 激活头格式:`AGENT EVOLVE ACTIVE — mode: <safe|review>`。
- Hook 中不复制 Skill 的详细执行规则。

### Mode 控制 hook

- 唯一职责:解析完整控制命令并更新 mode 状态。
- Hook 中不包含 feedback 识别规则。
- 普通 prompt 不产生输出。

### Agent Evolve Skill

- `SKILL.md` 只放触发条件、mode 路由、全局边界和禁止动作。
- `references/workflow.md` 放 feedback 判断、落点选择、查重、查冲突和写入流程。
- `references/validation.md` 放安全门、证据门和回执模板。
- 删除 `references/source-discovery.md`。
- `source-discovery.md` 中仍然有效且不重复的规则移动到 `workflow.md`。
- 移动完成后不保留第二份规则。

## Mode 设计

| Mode     | 自动识别 | 自动写入           | 用户批准后写入   | 默认注入 |
| -------- | -------- | ------------------ | ---------------- | -------- |
| `safe`   | 是       | 仅安全门全部通过时 | 是               | 是       |
| `review` | 是       | 否                 | 是               | 是       |
| `off`    | 否       | 否                 | 仅手动调用 Skill | 否       |

### Safe mode

- 目标:用户在日常开发中获得低摩擦、可验证的自动沉淀。
- 放行条件:feedback 可复用。
- 放行条件:存在唯一的项目规则位置。
- 放行条件:项目规则位置可写。
- 放行条件:未来 agent 会自动加载目标文件或按现有项目指令读取目标文件。
- 放行条件:项目规则中不存在相同规则。
- 放行条件:没有未解决冲突。
- 放行条件:抽象后的规则不包含敏感内容。
- 处理方式:所有放行条件满足时直接更新项目规则源。
- 处理方式:任一放行条件不满足时不写入,改为输出证据化建议。
- 禁止:不创建随机规则文件来绕过位置不明确。
- 禁止:不覆盖未解决冲突。

### Review mode

- 目标:让团队仓库、陌生项目和严格治理项目先审后写。
- 处理方式:识别并抽象可复用 feedback。
- 处理方式:给出目标位置、精确提案、Why 和 Evidence。
- 处理方式:用户明确批准后再编辑文件。
- 禁止:没有用户批准时不修改项目长期规则源。

### Off mode

- 目标:关闭自动行为,保留显式使用能力。
- 处理方式:`SessionStart` 不注入 Agent Evolve 规则。
- 处理方式:用户仍可手动调用 `$agent-evolve` Skill。
- 禁止:不删除 Skill。
- 禁止:不禁用用户的手动调用入口。

### 默认值与优先级

- 新安装默认 mode 是 `safe`。
- 当前 session mode 优先于持久默认 mode。
- 持久默认 mode 优先于内建默认 `safe`。
- 新 session 第一次启动时把有效默认 mode 固化为 session mode。
- `$agent-evolve default <mode>` 只影响后续新 session。
- `$agent-evolve default <mode>` 不改变当前 session。

## State 设计

### 持久默认配置

macOS 和 Linux:

```text
${XDG_CONFIG_HOME:-~/.config}/codeartz-skills/agent-evolve/config.json
```

Windows:

```text
%APPDATA%\codeartz-skills\agent-evolve\config.json
```

配置内容:

```json
{
  "defaultMode": "safe"
}
```

### Session mode

Codex:

```text
${PLUGIN_DATA}/agent-evolve/sessions/<session-id-hash>.json
```

Claude Code:

```text
${CLAUDE_PLUGIN_DATA}/agent-evolve/sessions/<session-id-hash>.json
```

状态内容:

```json
{
  "mode": "review",
  "updatedAt": "2026-07-10T00:00:00.000Z"
}
```

### State 边界

- `session_id` 使用 SHA-256 hash 生成文件名。
- 不把原始 `session_id` 写入状态文件。
- 不把用户 prompt 写入状态文件。
- 不把 feedback 内容写入 mode 状态文件。
- 每个 session 使用独立文件。
- Session 文件写入必须使用原子替换。
- 持久默认配置写入必须使用原子替换。
- Mode 状态不得写入项目仓库。
- 新实现不读取旧 `agent-feedback-loop` event 状态。
- 新实现不迁移旧 `agent-feedback-loop` event 状态。
- Session mode 为同一 `session_id` 持续保留,不按时间自动失效。
- Session mode 文件保留在插件数据目录中,直到插件数据被删除。

## Feedback 判断

### 候选 feedback

- 直接来自 human。
- 会改变未来项目任务中的 agent 决策。
- 能抽象为代码模式、架构、规范、边界或实践规则。
- 不依赖事故名称、日期、客户名、ticket 或私有上下文才能成立。

### 非候选内容

- 普通问题。
- 单次任务需求。
- 只适用于当前文件的一次性选择。
- Subagent 产生的观察。
- Agent 自己的总结或建议。
- 没有得到 human 确认的 review finding。
- Agent Evolve mode 控制命令。

### 判断边界

- 不要求 human 使用“以后”“记住”“不要再”或“写进规则”。
- 不因为出现这些词就自动判定为可复用 feedback。
- 使用当前 human 消息、可见对话、代码事实、diff、测试和 review 证据判断。
- 禁止使用模型记忆补造 feedback。

## 写入决策

### 安全更新

- 检查项:feedback 是否可复用。
- 检查项:项目中是否存在唯一合适的长期规则位置。
- 检查项:未来 agent 是否会读取该长期规则位置。
- 检查项:目标位置是否已有相同或相邻规则。
- 检查项:是否存在反向规则或未解决冲突。
- 放行条件:所有检查项都有直接证据支持安全写入。
- 处理方式:重新读取目标文件。
- 处理方式:合并或收紧已有规则。
- 处理方式:写入后验证 diff。
- 禁止:不制造第二权威位置。

### 已有规则覆盖

- 失败条件:feedback 与已有规则语义相同。
- 处理方式:不写入第二份规则。
- Evidence:引用现有文件和规则位置。

### 不沉淀

- 失败条件:feedback 只适用于当前任务。
- 失败条件:找不到唯一位置。
- 失败条件:存在未解决冲突。
- 失败条件:规则会保存敏感或事故细节。
- 失败条件:项目文件不可写。
- 处理方式:不修改项目长期规则源。
- 处理方式:输出具体失败原因和直接证据。
- 禁止:不使用“无法确定”代替已知证据。

## Why + Evidence 回执

每条被识别出的 feedback 候选都必须输出一个决策回执。普通消息不是 feedback 候选时不输出回执。

- 同一轮存在多条 feedback 候选时,每条候选分别输出 Decision、Why 和 Evidence。
- 多条回执可以放在同一个紧凑区块中。
- 禁止用一条汇总结论覆盖多条候选的不同处理结果。

### 必填字段

- `Decision`: `Updated`、`Already covered`、`Proposed`、`Not persisted` 或 `Failed`。
- `Why`:本次决策的明确原因。
- `Evidence`:来自 human 消息、文件、diff、测试或 review 的可核对证据。
- `Target`:发生写入或提出精确提案时填写文件和标题。
- `Change`:发生写入时填写抽象后的规则。

允许为空的 `Target` 和 `Change` 显式写“不适用”。

### Evidence 质量

- 引用 human feedback 时保留会改变未来决策的语义。
- 引用文件证据时写明文件和标题或行号。
- 声明“后续 session 会受益”时写明目标文件的自动加载或项目路由证据。
- 声明“没有重复”时写明查重范围。
- 声明“没有冲突”时写明检查的相邻规则或候选文件。
- 写入成功后使用实际 diff 或重新读取结果证明 Change 已落地。
- 测试或 review 参与判断时写明具体命令、结果或结论位置。
- 禁止只写“已检查”“符合要求”或“判断安全”。

### Updated

```text
Feedback decision: Updated
Why: <为什么该反馈会改变未来项目决策>
Evidence: <为什么该位置唯一、无重复且无冲突>
Target: <文件和标题>
Change: <写入后的规则>
```

### Already covered

```text
Feedback decision: Already covered
Why: 不应生成第二份相同规则。
Evidence: <现有文件和规则位置>
Target: <已有规则的文件和标题>
Change: 不适用
```

### Proposed

```text
Feedback decision: Proposed
Why: <为什么当前 mode 或安全门不允许直接写入>
Evidence: <候选位置、冲突或缺失证据>
Target: <建议文件和标题>
Change: <精确提案>
```

### Not persisted

```text
Feedback decision: Not persisted
Why: <为什么反馈不适合成为长期项目规则>
Evidence: <当前消息中的范围证据或项目证据>
Target: 不适用
Change: 不适用
```

### Failed

```text
Feedback decision: Failed
Why: <失败动作>
Evidence: <实际错误或验证结果>
Target: <尝试修改的文件或不适用>
Change: 不适用
```

## 失败、并发与安全

- Session 激活失败时不阻止 session 启动。
- Session 激活失败时必须向用户显示 Agent Evolve 未激活及失败证据。
- Skill 文件缺失或不可读时不注入部分规则。
- 持久默认配置不存在时使用内建默认 `safe`。
- 持久默认配置损坏或不可读时不猜测 mode。
- 持久默认配置损坏或不可读时停止自动注入并显示失败证据。
- Session mode 不存在时把持久默认 mode 固化为当前 session mode。
- Session mode 损坏或不可读时不猜测 mode。
- Session mode 损坏或不可读时停止自动注入并显示失败证据。
- Mode 状态写入失败时保留旧状态。
- Mode 状态写入失败时不声称切换成功。
- 多个 session 不共享 session mode 文件。
- 修改项目规则前重新读取目标文件。
- 目标文件在处理期间变化时重新查重。
- 目标文件在处理期间变化时重新查冲突。
- 无法安全合并并发变更时不写入。
- 保留工作区已有用户改动。
- 禁止回退无关用户改动。
- 禁止覆盖无关用户改动。
- 禁止清理无关用户改动。
- 抽象反馈时删除密钥、私有 URL、邮箱、客户名、ticket 和事故细节。
- Evidence 不得重新泄露被删除的敏感内容。
- Feedback 处理失败不得阻止当前用户任务继续完成。

## 删除与重命名

### 新名称

- Skill 名称:`agent-evolve`。
- 命令前缀:`$agent-evolve`。
- 配置命名空间:`agent-evolve`。
- Hook 文件使用 `agent-evolve-*` 前缀。

### 必须删除

- `skills/agent-feedback-loop/`。
- `hooks/agent-feedback-*.js`。
- 旧 pending event 实现。
- 旧 attempt 计数实现。
- 旧 blocked 状态实现。
- 旧 event status 实现。
- 旧 event CLI 标记协议。
- `tests/agent-feedback-*.test.ts`。
- `docs/superpowers/plans/2026-07-09-agent-feedback-loop.md`。
- README 中的旧名称与旧行为说明。
- Plugin metadata 中的旧名称与旧行为说明。
- Assets 中不再适用的旧名称与旧行为说明。

### 禁止兼容

- 不保留 `$agent-feedback-loop` alias。
- 不识别旧 hook event 状态。
- 不迁移旧 event 文件。
- 不保留 deprecated 配置字段。
- 不保留旧目录转发文件。
- 不保留仅用于通过旧测试的分支。
- 新运行时代码不得读取旧状态目录。

旧插件数据不属于新运行时输入。

- 实施时删除当前环境的旧 `agent-feedback-loop` 插件数据。
- 新代码不保留持续清理旧状态的兼容逻辑。

## 验证设计

### Hook 测试

- 默认 `safe` 时 `SessionStart` 注入 Skill 入口规则。
- Default mode 是 `review` 时注入 review mode。
- Default mode 是 `off` 时保持静默。
- 已固化的 session mode 覆盖 default mode。
- `resume`、`clear` 和 `compact` 保留当前 session mode。
- 不同 `session_id` 的 mode 互不影响。
- 普通 prompt 永远不修改 mode。
- 完整 mode 命令正确修改状态。
- Default mode 命令不修改当前 session。
- 非法 mode 命令不修改状态。
- 状态文件名不包含原始 `session_id`。
- 状态读写失败产生可见失败证据。
- Codex 和 Claude Code 输出使用各自支持的 hook 输出格式。

### Skill 合同测试

- 只有直接 human feedback 能触发自动沉淀。
- 普通纠正不依赖触发词也能成为候选。
- 一次性要求不能成为长期规则。
- Safe mode 的自动写入必须通过全部安全门。
- Review mode 在用户批准前禁止写入。
- Off mode 仍允许手动调用 Skill。
- 每个候选决策必须包含 `Decision`、`Why` 和 `Evidence`。
- 更新前必须查重和查冲突。
- 敏感内容不能进入规则或 Evidence。

### 用户路径验证

- 新 session 自动激活 Agent Evolve。
- 用户给出没有“记住”字样的可复用反馈。
- Agent 完成当前任务并安全更新项目规则。
- Agent 输出带 Why 和 Evidence 的回执。
- 后续新 session 读取到更新后的项目规则。
- 当前 session 切换到 `off` 后不再自动处理 feedback。
- 并发 session 保持各自 mode。
- Default mode 改变只影响后续新 session。

### 仓库验证

- `npm test` 通过。
- `npm run typecheck` 通过。
- `npm run format:all` 通过。
- `npm run lint` 通过。
- `rg -n "agent-feedback-loop|agent-feedback"` 不命中产品代码、测试、README、plugin metadata 或 active docs。
- 只允许本设计规范在历史说明中提及被删除名称。
- Git diff 不包含无关用户改动。

## 验收标准

- 用户无需显式调用 Skill 即可让可复用 feedback 进入安全判断流程。
- 默认 mode 是 `safe`。
- `safe`、`review` 和 `off` 行为互斥且可验证。
- 当前 session 和持久默认 mode 都可控制。
- Session 状态按 `session_id` 隔离。
- 只有 human-facing 主 session 自动注入。
- 每个候选 feedback 都有证据化决策回执。
- 自动写入的目标文件必须位于未来 agent 的读取路径中。
- 没有 regex feedback 分类。
- 没有 pending event 或 Stop 续跑。
- 没有 `agent-feedback-loop` 向后兼容代码。
- 新实现中同一条规则只存在一个权威位置。

## 外部事实依据

- Ponytail 使用 `SessionStart` 注入持久行为,并使用独立的 `UserPromptSubmit` 控制面切换 mode:[Ponytail hooks](https://github.com/DietrichGebert/ponytail/blob/main/hooks/claude-codex-hooks.json)。
- Ponytail 的运行 mode 使用共享 `.ponytail-active` 文件,没有按 `session_id` 隔离;Agent Evolve 不复制该状态设计:[Ponytail runtime](https://github.com/DietrichGebert/ponytail/blob/main/hooks/ponytail-runtime.js)。
- Codex 把 `SessionStart` 定义为 thread scope,把 `UserPromptSubmit` 定义为 turn scope,并为 hook 输入提供 `session_id`:[Codex Hooks](https://learn.chatgpt.com/docs/hooks)。
- Claude Code 支持 `SessionStart` 和 `UserPromptSubmit`,并向 command hook 提供 session 上下文:[Claude Code Hooks](https://code.claude.com/docs/en/hooks)。
