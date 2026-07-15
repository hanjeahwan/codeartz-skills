# Skill 实机评测

这套评测工具会在真实的 Codex 和 Claude Code 会话中运行仓库里的 Skill。它与 `npm test` 刻意分开：实机评测会消耗模型额度、需要登录凭证，并且可能让 Agent 在一次性工作区内调用工具。

## 命令

不调用模型，只验证完整场景矩阵：

```bash
npm run eval:live:check
```

用 Codex 运行所有冒烟场景，并由 Claude 并发裁判：

```bash
npm run eval:live
```

运行一个 Skill 的全部场景：

```bash
npm run eval:live -- \
  --skill agentic-design-navigator \
  --tier all
```

常用筛选参数：

```text
--skill <以逗号分隔的 Skill>
--scenario <以逗号分隔的场景 ID>
--agent codex|claude|codex,claude
--tier smoke|full|all
--judge codex|claude
--judge-concurrency <正整数>
--model-codex <模型>
--model-claude <模型>
--effort-codex <推理强度>
--effort-claude <推理强度>
--timeout-ms <毫秒数>
--keep-workspace
--rejudge <结果目录>
```

默认只使用推理强度为 `medium` 的 Codex `gpt-5.5` 运行目标场景，并使用推理强度为 `medium` 的 Claude `sonnet` 作为裁判。目标场景并发执行；Claude judge 默认最多并发 3 个。裁判失败时会用全新 session 重试一次。

Judge 阶段仍为 `indeterminate` 时，只重跑裁判：

```bash
npm run eval:live -- --rejudge tests/live-eval/results/<运行目录>
```

重判复用已保存的场景、会话记录、确定性检查、裁判文件和最终工作区，不会重新运行目标 Agent。Target Agent 自身失败不进入重判队列。

## 判定边界

- 确定性检查只验证文件变化、问题数量、结构和 Skill 读取轨迹等精确不变量。
- 响应内容只由 LLM judge 按场景 `criteria` 判断；默认使用 Claude，可以用 `--judge codex` 覆盖。
- Judge 只返回与 `criteria` 等长的 `passed` 和 `evidence` 数组；运行器按数组位置恢复原始标准并计算最终 verdict。
- Judge 会收到目标 Agent 的紧凑工具轨迹，包括命令、文件路径与成功或失败状态；不复制命令输出、读取内容、编辑前后正文或工具结果。
- 场景需要裁判检查最终文件语义时，在 `judgeFiles` 中列出工作区相对路径；文件缺失时裁判会收到 `[missing]`。
- 使用与目标 Agent 相同的模型作为裁判可以避免调用其他供应商，但目标与裁判可能共享判断盲点。需要更独立的结论时，使用另一种 Agent 作为裁判。
- 禁止用关键词、计数或正则判断响应或产物语义；把相关文件通过 `judgeFiles` 交给裁判。

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

产物写入 `tests/live-eval/results/`。每次运行都会在裁判前记录场景、标准化会话记录、确定性检查、裁判文件和运行后工作区，再记录裁判结果与最终结论。

## 场景归属

Skill 特定行为放在 `tests/<skill>/scenarios/*.scenario.json` 下。共享的宿主行为放在 `tests/live-eval/` 下。只有至少两个 Skill 都需要某项能力时，才将它抽象为共享实现。
