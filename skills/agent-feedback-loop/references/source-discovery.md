# Source Discovery

## 目标

找到当前项目里最合适的长期规则源，并避免重复或冲突。

## 已知长期规则源优先

- 用户明确指定的位置。
- 当前任务正在编辑或审查的规则文件。
- 当前项目已存在的 agent 指令文件。
- 当前项目已存在的 docs、手册、规范、policy、guide、manual、convention 或 instruction 文件。
- 当前项目如果包含 skills/plugin 结构，再考虑 `skills/**`、`.codex-plugin/**`、`.claude-plugin/**`。
- 禁止因为本技能运行在 skills 仓库里，就把其他项目的 feedback 默认写进 `SKILL.md`。

## grep 兜底

- 已知 owner 不足时，才使用 grep 发现。
- 先列候选文件：

```bash
rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g 'README.md' -g 'docs/**' -g '.github/copilot-instructions.md' -g '.cursor/rules/**' -g '.windsurf/rules/**' -g '.clinerules'
```

## 结构探测

- 先探测 skill/plugin manifest 和现有技能入口：

```bash
rg --files -g '.codex-plugin/plugin.json' -g '.claude-plugin/plugin.json' -g 'skills/**/SKILL.md'
```

- 命中 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 或 `skills/**/SKILL.md` 任一项时，确认存在 skill/plugin 结构。
- 只有确认存在 skill/plugin 结构后，才进入 `skills/**` 和 plugin path 分支。
- 结构未确认时，不搜索 `skills/**` 和 plugin path。

## skill/plugin 候选

- 如果候选文件或 manifest 证明当前项目存在 skill/plugin 结构，再追加技能规则候选：

```bash
rg --files -g 'skills/**/SKILL.md' -g 'skills/**/references/**' -g '.codex-plugin/**' -g '.claude-plugin/**'
```

- 再搜索规则源线索：

```bash
rg -n "规则|手册|规范|指令|约定|长期|feedback|rule|guide|handbook|manual|policy|instruction|convention" AGENTS.md CLAUDE.md README.md docs .github .cursor .windsurf .clinerules 2>/dev/null
```

- 如果已确认存在 skill/plugin 结构，再搜索技能规则线索：

```bash
rg -n "规则|手册|规范|指令|约定|长期|feedback|rule|guide|handbook|manual|policy|instruction|convention" skills .codex-plugin .claude-plugin 2>/dev/null
```

- 最后搜索 feedback 关键词和相邻概念。
- 关键词来自用户反馈，不使用通用空词。
- 禁止把 grep 命中当成 owner。
- 禁止全库默认扫描。
- 只有已知来源和当前上下文都不足时，才扩大搜索。

## owner 判定

- 可以编辑的 owner 必须满足全部条件：
  - 文件是规则、规范、手册、agent 指令、项目约定或同等长期规则源。
  - 命中段落与 feedback 原则属于同一决策主题。
  - 新规则能并入已有段落，或能创建最小相邻段落。
  - 没有同等强度的反向规则。
  - 不需要用户裁决才能选择位置。

## 查重

- 发现相同语义时，优先收紧已有规则。
- 重复时合并，不追加第二份。
- 删除或避免新增重复句。
- 不把同一规则同时写进多个文件。
- 发现 feedback 只是已有规则的例子时，不新增规则。
- 只有原规则含糊时，才改写原规则。

## 冲突

- 发现冲突时，不覆盖旧规则。
- 冲突时输出冲突位置。
- 输出建议原则。
- 标记为 `Proposed target` 或待裁决。

## 无 owner

- 找不到 owner 时，不随机写入 README。
- 找不到 owner 时，不随机创建 docs 文件。
- 输出建议创建的最小规则源和原因。
