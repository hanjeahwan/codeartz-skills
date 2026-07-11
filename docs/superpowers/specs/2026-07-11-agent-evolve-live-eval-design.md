# Agent Evolve 测试结构与实机评测设计

## 目标

让 Agent Evolve 跟随 `main` 的最新测试框架，同时保留快速、确定性的 hook 与规则合同测试。

## 测试结构

```text
tests/agent-evolve/
  activate.test.ts
  mode.test.ts
  plugin.test.ts
  runtime.test.ts
  skill.test.ts
  state.test.ts
  scenarios/
    manual-already-covered.scenario.json
    manual-proposal.scenario.json
```

- 六个确定性测试从 `tests/` 根目录移动到 `tests/agent-evolve/`。
- 移动后只调整相对 import 与路径定位，不改变既有测试语义。
- `npm test` 继续使用 `tests/**/*.test.ts`，不修改默认测试命令。
- Live-eval 场景沿用 `tests/<skill>/scenarios/*.scenario.json` 约定。

## Live-eval 场景

### Smoke：手动提案

- 输入：用户手动调用 `$agent-evolve`，给出可复用 feedback，并明确不要写入。
- 项目证据：fixture 提供会被未来 agent 自动读取的 `AGENTS.md`。
- 期望：返回 `Proposed`、`Why`、`Evidence`、`Target` 与精确 `Change`。
- 期望：`AGENTS.md` 保持不变。
- 作用：验证无 ACTIVE header 时进入 manual-off route。

### Full：已有规则查重

- 输入：用户手动调用 `$agent-evolve`，要求沉淀与 `AGENTS.md` 已有规则语义相同的 feedback。
- 项目证据：fixture 已包含结构化解析错误规则。
- 期望：返回 `Already covered`、`Why`、`Evidence`、`Target` 与 `Change: 不适用`。
- 期望：`AGENTS.md` 保持不变。
- 作用：验证 standalone/manual 路径的语义查重与单一权威保护。

## 覆盖边界

- Live-eval 不替代 state、runtime、activation、mode、plugin 与文档 ownership 单测。
- Live-eval 不重复测试自动 `SessionStart` lifecycle；该行为由 hook tests 与已完成的真实 CLI dogfood 覆盖。
- Live-eval 不重复测试 `git diff` 写入证据；该行为由确定性合同测试与真实 Git dogfood 覆盖。
- 普通 `npm test` 不调用模型。
- `npm run eval:live:check` 只验证场景矩阵与 schema。
- 实机验证只运行 `agent-evolve` 场景，避免执行无关 Skill。

## 验收

- `tests/` 根目录不再存在 `agent-evolve-*.test.ts`。
- `tests/agent-evolve/` 包含六个确定性测试与两个只读 scenario。
- Live-eval 矩阵把 `agent-evolve` 作为第四个目标 Skill。
- `npm test`、typecheck、lint、format 与 diff check 通过。
- `npm run eval:live:check -- --skill agent-evolve --tier all` 通过。
- Agent Evolve 的真实 smoke/full 场景在 Codex 与 Claude 上运行并记录结果；宿主限制导致无法运行时，必须报告实际证据，不伪造通过。
