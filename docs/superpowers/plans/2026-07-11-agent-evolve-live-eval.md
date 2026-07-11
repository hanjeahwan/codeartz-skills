# Agent Evolve Live-eval 实施计划

> **供实施 agent 使用：** 按 TDD 顺序执行；先看到场景矩阵失败，再移动测试并添加场景。

**目标：** 把 Agent Evolve 确定性测试聚合到 `tests/agent-evolve/`，并接入 `main` 的真实 Codex/Claude live-eval。

**架构：** 确定性测试继续由 Node test runner 执行；两个 JSON scenario 由 `tests/live-eval/` 发现和运行。自动 hook lifecycle 不在 live-eval 中重复建模。

**技术栈：** Node test runner、TypeScript、JSON scenario、Codex CLI、Claude Code CLI。

## 全局约束

- 不恢复任何 `agent-feedback-loop` 文件、测试、hook、asset 或兼容入口。
- 不改变 Agent Evolve runtime、mode、state 或 skill 行为。
- 不把真实模型调用加入 `npm test`。
- Git 集成只使用 rebase，不使用 merge 命令或 merge commit。
- 不运行 `instruction-doc-audit`。
- 使用 `apply_patch` 编辑文件；测试移动使用 `mv` 作为机械文件操作。

---

### Task 1：同步 main 与迁移确定性测试

**文件：**

- 移动：`tests/agent-evolve-activate.test.ts` → `tests/agent-evolve/activate.test.ts`
- 移动：`tests/agent-evolve-mode.test.ts` → `tests/agent-evolve/mode.test.ts`
- 移动：`tests/agent-evolve-plugin.test.ts` → `tests/agent-evolve/plugin.test.ts`
- 移动：`tests/agent-evolve-runtime.test.ts` → `tests/agent-evolve/runtime.test.ts`
- 移动：`tests/agent-evolve-skill.test.ts` → `tests/agent-evolve/skill.test.ts`
- 移动：`tests/agent-evolve-state.test.ts` → `tests/agent-evolve/state.test.ts`

- [ ] 把 feature rebase 到 `main`，保留 main 的 live-eval 框架，并以删除解决旧 feedback test 的 modify/delete 冲突。
- [ ] 移动六个测试文件到 `tests/agent-evolve/`。
- [ ] 把 hook import 从 `../hooks/` 改为 `../../hooks/`。
- [ ] 把仓库相对文件路径改为不依赖测试文件深度的现有仓库根路径。
- [ ] 运行 `npm test`，预期全部确定性测试通过。
- [ ] 提交 `test(agent-evolve): group deterministic tests`。

---

### Task 2：先扩展 live-eval 矩阵并确认 RED

**文件：**

- 修改：`tests/live-eval/live-eval.test.ts`

- [ ] 把目标 Skill 列表加入 `agent-evolve`。
- [ ] 运行 `node --test tests/live-eval/live-eval.test.ts`。
- [ ] 预期失败：`agent-evolve` 没有 smoke/full 两层场景。

---

### Task 3：添加 manual smoke/full 场景

**文件：**

- 创建：`tests/agent-evolve/scenarios/manual-proposal.scenario.json`
- 创建：`tests/agent-evolve/scenarios/manual-write.scenario.json`

- [ ] 创建 smoke 场景：明确不写入，要求 Proposed 回执，并检查 `AGENTS.md` 未变化。
- [ ] 创建 full 场景：明确要求写入，要求 Updated 回执，并检查 `AGENTS.md` 包含抽象规则。
- [ ] 每个场景提供非空 criteria，供可选语义裁判逐项判断。
- [ ] 运行 `node --test tests/live-eval/live-eval.test.ts`，预期通过。
- [ ] 运行 `npm run eval:live:check -- --skill agent-evolve --tier all`，预期矩阵检查通过且不调用模型。
- [ ] 提交 `test(agent-evolve): add live eval scenarios`。

---

### Task 4：验证并 rebase 到 main

- [ ] 运行 `npm run format:all`。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `git diff --check`。
- [ ] 运行 `npm run eval:live -- --skill agent-evolve --tier all --agent codex,claude --judge claude`。
- [ ] 记录每个宿主与场景的实际 verdict；任何失败都先按证据诊断。
- [ ] 在 feature 已基于最新 `main` 的前提下，把 `main` rebase 到 feature branch。
- [ ] 在 merged `main` 上重新运行 `npm test` 与 `npm run eval:live:check -- --skill agent-evolve --tier all`。
- [ ] 验证旧 `skills/agent-feedback-loop`、相关 hooks/tests/asset 不存在。
- [ ] Rebase 成功且验证通过后，删除 worktree 与 feature branch。
