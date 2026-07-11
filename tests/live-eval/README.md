# Skill 实机评测

这套评测工具会在真实的 Codex 和 Claude Code 会话中运行仓库里的 Skill。它与 `npm test` 刻意分开：实机评测会消耗模型额度、需要登录凭证，并且可能让 Agent 在一次性工作区内调用工具。

## 命令

不调用模型，只验证完整场景矩阵：

```bash
npm run eval:live:check
```

在 Codex 和 Claude 上运行所有冒烟场景：

```bash
npm run eval:live
```

运行一个 Skill，包含完整场景，并使用 Claude 作为语义裁判：

```bash
npm run eval:live -- \
  --skill agentic-design-navigator \
  --tier all \
  --agent codex,claude \
  --judge claude
```

常用筛选参数：

```text
--skill <以逗号分隔的 Skill>
--scenario <以逗号分隔的场景 ID>
--agent codex|claude|codex,claude
--tier smoke|full|all
--judge none|codex|claude
--model-codex <模型>
--model-claude <模型>
--effort-codex <推理强度>
--effort-claude <推理强度>
--timeout-ms <毫秒数>
--keep-workspace
```

默认目标矩阵使用推理强度为 `medium` 的 Codex `gpt-5.5`，以及推理强度为 `medium` 的 Claude `sonnet`。以上参数均可通过对应选项覆盖。

## 隔离与凭证

- 每次目标运行都会获得一次性工作区和主目录。
- Codex 的一次性 `CODEX_HOME` 中只会放入选定的 Skill。
- Claude 通过 `--plugin-dir` 加载本仓库。
- 只向运行环境传递受严格限制的环境变量白名单。
- 如果存在 Codex `auth.json`，会将它复制到一次性主目录；同时也支持 `OPENAI_API_KEY`。
- 存在 `ANTHROPIC_API_KEY` 或 `CLAUDE_CODE_OAUTH_TOKEN` 时，Claude 使用一次性 HOME。
- Claude Code 通过订阅账号登录时，运行器仅为订阅认证复用宿主机 HOME。运行器会禁用用户设置和 MCP 配置、限制工具、使用一次性工作区，并在运行结束后删除该工作区对应的 Claude 会话目录。
- Codex 使用 `workspace-write` 沙箱。Claude 仅可使用 `Read`、`Glob`、`Grep`、`Write` 和 `Edit`，不可使用 Bash。
- 实机评测仅供受信任的本地维护者运行。禁止将凭证加入公开 CI。

产物写入 `tests/live-eval/results/`。每次运行都会记录场景、标准化会话记录、确定性检查、可选的裁判结果、最终结论，以及运行后的一次性工作区。

## 场景归属

Skill 特定行为放在 `tests/<skill>/scenarios/*.scenario.json` 下。共享的宿主行为放在 `tests/live-eval/` 下。只有至少两个 Skill 都需要某项能力时，才将它抽象为共享实现。
