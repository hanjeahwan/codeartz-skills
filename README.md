<p align="center">
  <img src="assets/logo.png" width="220" alt="Codeartz Skills logo">
</p>

<h1 align="center">Codeartz Skills</h1>

<p align="center">
  <em>先收边界，再过证据，最后让项目持续进化。</em>
</p>

<p align="center">
  <strong>边界分析 &middot; 指令审查 &middot; Agent Evolve</strong><br>
  <sub>一组给 agent 用的工程流程 skills。</sub>
</p>

---

## How it works

<p align="center">
  <img src="assets/readme-illustrations/01-target-boundary.png" alt="target-boundary 把混合资料收敛成目标合同">
  <br>
  <sub>1. target-boundary：混合资料先过边界秤，沉淀成有证据链的目标合同。</sub>
</p>

<p align="center">
  <img src="assets/readme-illustrations/02-instruction-doc-audit.png" alt="instruction-doc-audit 把指令手册压平成可勾选规则">
  <br>
  <sub>2. instruction-doc-audit：深缩进、复合句和重复规则被压平成可勾选条目。</sub>
</p>

<p align="center">
  <img src="assets/readme-illustrations/03-agent-evolve.png" alt="Agent Evolve 把 human feedback 安全合并到项目长期规则源">
  <br>
  <sub>3. Agent Evolve：主 agent 识别可复用 human feedback，查重、过滤隐私，再用 Why + Evidence 安全合并。</sub>
</p>

## What it is

这不是一个“让 agent 更努力”的 prompt 包。它是一组把复杂输入收敛为工程产物，并让项目规则持续吸收 human feedback 的 skills：

| Skill                                                    | 用在什么时候                                                                                            | 结果                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`target-boundary`](skills/target-boundary/)             | requirements、PRD、spec、issues、review notes、会话记录和仓库证据混在一起，需要分析边界、根因或技术方案 | 写入 `.codeartz/<topic>/target-boundary.md`；满足确认停靠点后生成 `.codeartz/<topic>/context-handoff.md` |
| [`instruction-doc-audit`](skills/instruction-doc-audit/) | 指令、规范、规则手册、政策、提示词或技能文档存在职责混杂、分支隐式或层级过深                            | 给出命中项和改写建议，或按编辑模式改成可执行、语言一致的规则                                             |
| [`agent-evolve`](skills/agent-evolve/)                   | 主 session 中的 human feedback 会改变未来代码模式、架构、规范、边界或实践决策                           | 按当前 mode 更新或提案到未来 agent 会读取的项目已有规则源；每条候选都输出 Why + Evidence                 |

## When to use

使用 `target-boundary`：

- 用户输入同时包含需求资料和既有系统行为。
- 需要先证明当前系统事实，再决定方案边界。
- 需要把适用分区、不适用分区、保持原行为、未知和冲突写清楚。
- 需要把方案沉淀成后续实现 agent 可以接手的上下文文件。

使用 `instruction-doc-audit`：

- 文档读起来像“介绍自己”，但没有告诉 agent 怎么行动。
- 一句话里塞了条件、动作、禁止和例外。
- 中文正文混入可本地化英文，或英文正文混入可英文替换的中文说明词。
- `SKILL.md`、阶段手册、参考文件之间职责混杂或重复维护同一条规则。

使用 `agent-evolve`：

- 用户在主 session 中纠正代码 pattern、架构、规范、边界或好实践。
- Feedback 会改变后续项目任务中的 agent 决策。
- 需要把规则合并到未来 agent 已有读取路径，并证明唯一 owner、无重复、无冲突。
- 需要为沉淀或不沉淀展示 `Decision`、`Why` 与 `Evidence`。

## Agent Evolve modes

默认 mode 是 `safe`。新 session 在 `SessionStart` 固化当前 mode；`UserPromptSubmit` 只处理下列完整控制命令，不分类普通消息。

| Mode     | 自动识别 | 自动写入         | 用户批准后写入   | 自动注入 |
| -------- | -------- | ---------------- | ---------------- | -------- |
| `safe`   | 是       | 仅全部安全门通过 | 是               | 是       |
| `review` | 是       | 否               | 是               | 是       |
| `off`    | 否       | 否               | 仅手动调用 Skill | 否       |

当前 session：

```text
$agent-evolve safe
$agent-evolve review
$agent-evolve off
```

后续新 session 的持久默认值：

```text
$agent-evolve default safe
$agent-evolve default review
$agent-evolve default off
```

宿主提供的 `/agent-evolve` 或 `@agent-evolve` 前缀也可以调用同一组命令。`default` 命令不改变当前 session。

## Install

### Claude Code

```text
/plugin marketplace add hanjeahwan/codeartz-skills
/plugin install codeartz-skills@codeartz
```

Claude Code 安装后打开 `/hooks`，review 并 trust Codeartz 的 `SessionStart` 与 `UserPromptSubmit` hook；然后重启应用或开启新 session。

### Codex

```bash
codex plugin marketplace add hanjeahwan/codeartz-skills
codex plugin add codeartz-skills@codeartz
```

Codex 安装后打开 `/hooks`，review 并 trust Codeartz 的 `SessionStart` 与 `UserPromptSubmit` hook；然后重启应用或开启新 session。

### Standalone skills

只想安装单个 skill，可使用 `npx skills add`：

```bash
npx skills add https://github.com/hanjeahwan/codeartz-skills --skill target-boundary
npx skills add https://github.com/hanjeahwan/codeartz-skills --skill instruction-doc-audit
npx skills add https://github.com/hanjeahwan/codeartz-skills --skill agent-evolve
```

Standalone 安装不包含 lifecycle hook；`agent-evolve` 仍可由用户手动调用。

## Commands

| 入口                    | 作用                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `target-boundary`       | 把混合资料、代码证据和风险收敛成目标边界、技术方案和上下文交接文件         |
| `instruction-doc-audit` | 审查祈使型文档，找出不可执行、语言不一致和结构职责混杂的问题               |
| `agent-evolve`          | 语义判断直接 human feedback，并按 safe/review/off 合并、提案或停止自动沉淀 |
