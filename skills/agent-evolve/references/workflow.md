# Agent Evolve Workflow

## 目标

把直接 human feedback 转成可复用项目规则，写入未来 agent 已有读取路径；无法安全写入时给出可核对的提案或不沉淀原因。

## 输入

- 当前 human 消息。
- 当前可见对话。
- 当前项目已有规则、规范、手册、文档和配置。
- 当前任务产生的代码事实、diff、测试结果与 review 结论。
- 注入头中的当前 mode。

## Feedback 判断

候选 feedback 必须同时满足：

- 直接来自 human。
- 会改变未来项目任务中的 agent 决策。
- 能抽象为代码模式、架构、规范、边界或实践规则。
- 不依赖事故名称、日期、客户名、ticket 或私有上下文才能成立。

以下内容不是候选 feedback：

- 普通问题。
- 单次任务需求。
- 只适用于当前文件的一次性选择。
- Subagent 产生的观察。
- Agent 自己的总结或建议。
- 没有得到 human 确认的 review finding。
- Agent Evolve mode 控制命令。

- 不要求 human 使用“以后”“记住”“不要再”或“写进规则”。
- 不因消息出现上述词语就判定为候选。
- 使用当前 human 消息、可见对话、代码事实、diff、测试和 review 证据判断。
- 禁止使用模型记忆补造 feedback。

## 原则抽象

- 保留会改变未来决策的判断条件、动作与禁止项。
- 删除事故名称、日期、客户名、ticket、私有路径与原始日志。
- 把只描述一次失败的抱怨改写成跨任务可执行的规则。
- 一条规则只表达一个可独立检查的动作或约束。
- 条件、动作与禁止分别写成独立规则。
- 存在互斥后果时使用命名槽位表达分支。

## 落点发现

按以下优先级找候选：

- 用户明确指定的位置。
- 当前任务正在编辑或审查的规则文件。
- 项目已有 agent 指令文件，例如 `AGENTS.md` 或 `CLAUDE.md`。
- 项目已有 docs、手册、规范、policy、guide、manual、convention 或 instruction 文件。
- 项目已证明存在 skill/plugin 结构时，才考虑 `skills/**`、`.codex-plugin/**` 或 `.claude-plugin/**`。

- 先用当前上下文与已知规则源定位。
- 已知来源不足时，使用以下有边界的文件发现命令：

```bash
rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g 'README.md' -g 'docs/**' -g '.github/copilot-instructions.md' -g '.cursor/rules/**' -g '.windsurf/rules/**' -g '.clinerules'
```

- 只有命中 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 或 `skills/**/SKILL.md` 时，才追加 skill/plugin 候选：

```bash
rg --files -g '.codex-plugin/plugin.json' -g '.claude-plugin/plugin.json' -g 'skills/**/SKILL.md'
rg --files -g 'skills/**/SKILL.md' -g 'skills/**/references/**' -g '.codex-plugin/**' -g '.claude-plugin/**'
```

- 从 human feedback 提取具体主题词，再对候选文件做 `rg -n` 查找。
- 禁止默认扫描全库。
- 禁止把 grep 命中直接当成 owner。
- 禁止因为本技能位于 skills 仓库，就默认把其他项目 feedback 写进 `SKILL.md`。

唯一 owner 必须同时满足：

- 文件是项目长期规则源。
- 命中段落与抽象规则属于同一决策主题。
- 新规则能合并进已有段落，或创建最小相邻段落。
- 没有同等强度的反向规则。
- 不需要用户裁决才能选择位置。
- 有证据证明未来 agent 会自动加载该文件，或会通过现有项目指令路由读取该文件。

- 找不到唯一 owner 时不随机写入 README。
- 找不到唯一 owner 时不随机创建 docs 文件。
- 找不到未来 agent 读取路径证据时不自动写入。
- 无 owner 时给出建议的最小目标、精确规则文本与缺失证据。

## 查重与查冲突

- 在目标段落、相邻规则与同主题候选文件中查找相同语义。
- 反馈与已有规则语义相同时，判为 `Already covered`。
- 重复时不追加第二份规则。
- 原规则含糊时，只收紧原规则。
- 反馈只是已有规则的例子时，不新增规则。
- 查找同主题的反向规则、例外与优先级约束。
- 冲突时不覆盖旧规则。
- 冲突时记录文件、标题或行号，以及需要 human 裁决的具体差异。

## Mode 处理

### Safe mode

- 把候选、抽象规则、唯一 owner、未来读取路径、查重结果与冲突结果交给 `validation.md`。
- 全部安全门通过时直接更新项目已有规则源。
- 任一安全门不通过时不写入；输出精确提案或不沉淀回执。

### Review mode

- 生成目标位置、精确提案、Why 与 Evidence。
- 用户明确批准后才进入写入步骤。
- 批准只覆盖用户确认的提案，不扩展到其他候选或位置。

### Off mode 的手动调用

- 只处理用户本次手动指定的 feedback。
- 用户明确要求写入时，仍须通过 `validation.md` 全部安全门。
- 用户未明确要求写入时，只输出精确提案。

## 写入流程

- 修改前重新读取目标文件。
- 比较目标内容是否从落点分析后发生变化。
- 目标变化时重新查重。
- 目标变化时重新查冲突。
- 无法安全合并并发变化时不写入。
- 只编辑唯一 owner。
- 优先合并或收紧已有规则。
- 不制造第二权威位置。
- 保留工作区已有用户改动。
- 禁止回退、覆盖或清理无关用户改动。
- 写入后重新读取目标规则。
- 使用 `git diff -- <target>` 验证实际 diff。
- 不自动提交 git commit。
- 最后读取 `validation.md`，选择并输出每条候选的回执。
