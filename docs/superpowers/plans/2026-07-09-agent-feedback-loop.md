# Agent Feedback Loop 落地计划

> 状态:已落地并合并到 `main`。本文是设计对齐版,用于后续维护、复盘和继续扩展;不再保留旧的逐行代码生成步骤。

## 目标

把用户对 agent 行为的高信号反馈,转成长期规则源里的可执行规则。

- 支持 Codex。
- 支持 Claude Code。
- 使用同一份 command hook 配置。
- 让 hook 只负责捕获和续跑。
- 让 skill 负责判断、查重、合并、验证和输出。
- 优先写入项目已有规则源。
- 不知道长期规则源在哪里时,通过 grep 和项目证据发现候选。
- 不创建独立规则源注册表。
- 不默认把规则写进 `SKILL.md`。

## 设计原则

- Hook 只捕获反馈、写入 pending event、注入上下文。
- Hook 不直接编辑长期规则源。
- Hook 不判断最终规则应该写到哪里。
- Hook 不把事件细节永久写入规则。
- Skill 负责 durable signal 判断。
- Skill 负责长期规则源发现。
- Skill 负责重复和冲突检查。
- Skill 负责 edit/proposal/no durable 三种结果。
- Skill 负责把事件标记为 updated/proposed/no-durable/blocked。
- 已知规则源优先。
- 已知规则源不足时,再使用 grep 发现候选。
- Grep 只提供证据,不自动决定 owner。
- `skills/**` 只有在项目存在 skill/plugin 结构时才是候选。
- 测试使用 TypeScript。
- Hook 运行入口保持 JavaScript。
- Hook 通过 JSDoc 和 `checkJs` 做类型约束。
- Hook manifest 不指向 `.ts` 文件。
- Runtime 不依赖 `tsx`、`ts-node` 或安装后构建步骤。

## 架构

### Hook 捕获层

- 入口: `hooks/agent-feedback-capture.js`。
- Hook 类型: `UserPromptSubmit`。
- 输入: Codex 或 Claude Code 传入的 hook JSON。
- 行为:识别高置信用户反馈。
- 行为:创建 pending event。
- 行为:输出 additional context。
- 禁止:不写长期规则源。
- 禁止:不读取或修改项目规则文件。
- 禁止:不把 customer feedback、产品反馈按钮、普通需求误判成 agent 规则反馈。

### Hook 续跑层

- 入口: `hooks/agent-feedback-stop.js`。
- Hook 类型: `Stop`。
- 检查项:当前会话和当前项目是否存在 pending event。
- 放行条件:没有 pending event。
- 放行条件:已经处于 stop hook 递归保护状态。
- 处理方式:存在 pending event 时,注入继续处理指令。
- 处理方式:超过最大尝试次数时,把事件标记为 `blocked`。
- 禁止:不让 hook 无限循环。
- 禁止:不在 blocked 状态继续阻止结束。

### Skill 判断层

- 入口: `skills/agent-feedback-loop/SKILL.md`。
- 执行手册: `skills/agent-feedback-loop/references/workflow.md`。
- 规则源发现手册: `skills/agent-feedback-loop/references/source-discovery.md`。
- 验证手册: `skills/agent-feedback-loop/references/validation.md`。
- 行为:读取 pending event。
- 行为:提取反馈信号。
- 行为:判断是否有 durable update。
- 行为:定位长期规则源。
- 行为:查重。
- 行为:查冲突。
- 行为:合并到既有 owner。
- 行为:按 edit/proposal/no durable 输出结果。
- 禁止:不为了消除 pending event 而写低质量规则。

## 文件职责

- `hooks/agent-feedback-runtime.js`:检测 Codex/Claude Code 运行时,生成 hook stdout。
- `hooks/agent-feedback-state.js`:管理事件状态、路径选择、清洗、读写、查询、状态标记和尝试次数。
- `hooks/agent-feedback-capture.js`:实现 `UserPromptSubmit` 捕获、分类和 pending event 写入。
- `hooks/agent-feedback-stop.js`:实现 `Stop` 续跑、递归保护和 blocked 降级。
- `hooks/claude-codex-hooks.json`:Codex 和 Claude Code 共用的 hook 配置。
- `skills/agent-feedback-loop/SKILL.md`:放触发条件、阶段路由、全局边界和禁止动作。
- `skills/agent-feedback-loop/references/workflow.md`:放反馈转规则的执行流程和输出模式。
- `skills/agent-feedback-loop/references/source-discovery.md`:放已知源优先、grep 兜底、查重、冲突处理规则。
- `skills/agent-feedback-loop/references/validation.md`:放编辑门、隐私门、规则质量门、事件状态门和输出模板。
- `tests/agent-feedback-capture.test.ts`:覆盖捕获分类和 CLI 行为。
- `tests/agent-feedback-state-runtime.test.ts`:覆盖 runtime 输出和事件状态存储。
- `tests/agent-feedback-stop.test.ts`:覆盖 stop 续跑、尝试次数和递归保护。
- `tests/agent-feedback-plugin.test.ts`:覆盖 Codex/Claude manifest hook 引用。
- `tests/agent-feedback-skill.test.ts`:覆盖 skill 文档关键约束。
- `package.json`:让 `npm test` 执行 `node --test 'tests/**/*.test.ts'`。
- `tsconfig.json`:纳入 `hooks/**/*.js`、`scripts/**/*.ts`、`tests/**/*.ts`,并启用 `allowJs` 和 `checkJs`。
- `.codex-plugin/plugin.json`:引用共享 hook 配置。
- `.claude-plugin/plugin.json`:引用共享 hook 配置。
- `README.md`:说明 skill 能力和 hook 信任/启用方式。

## 状态目录

- 优先级 1:`AGENT_FEEDBACK_STATE_DIR`。
- 优先级 2:`PLUGIN_DATA`。
- 优先级 3:`CLAUDE_PLUGIN_DATA`。
- 优先级 4:`CLAUDE_CONFIG_DIR`。
- 优先级 5:`~/.claude/agent-feedback-loop`。
- 事件按项目和会话隔离。
- 事件路径通过 hook additional context 注入给 agent。
- 状态文件只保存处理所需的最小信息。

## 事件状态

- `pending`:已捕获,等待 skill 处理。
- `updated`:已更新长期规则源。
- `proposed`:已提出可合并文本,但没有写入文件。
- `no-durable`:反馈没有形成可泛化、最小、连贯、可执行的规则更新。
- `blocked`:多次尝试后仍无法处理,需要用户或外部状态变化。

## 反馈识别

- 识别 explicit feedback。
- 识别用户纠正 agent 行为的消息。
- 识别用户要求把教训、失败、复盘、review findings 转成长期规则的消息。
- 识别用户要求更新 instructions、docs、skills、manuals、protocols 的消息。
- 忽略普通产品反馈表述。
- 忽略 customer feedback、用户调研、站内反馈按钮等非 agent 行为反馈。
- 忽略没有 durable decision pattern 的一次性执行细节。
- 识别规则变宽时,必须先补 negative tests。

## 规则源发现

### 已知源优先

- 用户明确给出路径时,优先使用用户路径。
- 当前正在编辑或 review 的规则文件优先于仓库泛搜。
- `AGENTS.md`、`CLAUDE.md` 和同类 agent instruction 文件是候选。
- `docs/**` 中的 manual、policy、guide、convention、instruction 文件是候选。
- 项目存在 skill/plugin 结构时,`skills/**`、`.codex-plugin/**`、`.claude-plugin/**` 才是候选。

### Grep 兜底

- 已知源不足时,使用 `rg` 搜索候选 owner。
- 搜索目标:相邻概念、同义规则、阶段手册、输出模板、禁止动作、验证门。
- 搜索结果必须作为证据读取。
- 搜索结果不能直接替代 owner 判断。
- 没有证据时,停止提出编辑。
- 没有证据时,不要假设 `SKILL.md` 是最佳位置。

### 查重和冲突

- 写入前检查重复规则。
- 写入前检查相邻规则是否表达同一概念。
- 新原则能替代旧规则时,改写已有段落。
- 新原则不能替代旧规则时,把冲突写入待裁决。
- 禁止复制同一规则到多个文件。
- 禁止为方便追加而制造第二权威位置。

## Skill 工作流

### 1. 读取事件

- 优先读取 hook 注入的 event path。
- 找不到 event path 时,从当前项目和会话查找 pending event。
- 事件不存在时,按用户显式请求继续执行普通 feedback-loop 工作流。
- 事件存在但内容不足时,把缺口写清楚。

### 2. 判断 durable signal

- 检查反馈是否改变未来决策。
- 检查反馈是否能泛化到多个任务。
- 检查反馈是否需要长期规则而非一次性修复。
- 检查反馈是否包含隐私、客户名、凭据、私有链接或长日志。
- 不满足 durable 条件时,输出 `No durable update made`。
- 不满足 durable 条件时,把事件标记为 `no-durable`。

### 3. 定位 owner

- 先检查已知源。
- 再读取候选文件。
- 再搜索相邻规则。
- 只在证据充足时命名 target。
- 不能验证 target 时,不提出写入。

### 4. 合并规则

- 优先改写已有段落。
- 优先移动而非复制。
- 优先减少重复规则。
- 保留原规则的稳定含义。
- 新增文本必须是原则,不是事故记录。
- 新增文本必须能独立指导下次决策。

### 5. 验证规则

- Generalizable 低于 4 时拒绝。
- Clarity 低于 4 时拒绝。
- Structural fit 低于 4 时拒绝。
- Decision impact 低于 4 时拒绝。
- 总分低于 16 时拒绝。
- 验证失败时,输出 `No durable update made`。

### 6. 更新事件

- 写入成功后,标记 `updated`。
- 只提出方案后,标记 `proposed`。
- 没有 durable update 时,标记 `no-durable`。
- 多次续跑仍无法处理时,由 stop hook 标记 `blocked`。

## 输出格式

### 已更新

```markdown
Updated: <file path>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Merge strategy: <rewritten section / simplified rule / removed stale guidance>
Validation: Generalizable <score>, Clarity <score>, Structural fit <score>, Decision impact <score>
Verification: <checks run or reason not run>
```

### 只提出

```markdown
Proposed target: <verified file path and heading>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Merge strategy: <rewritten section / simplified rule / removed stale guidance>
Proposed text: <exact sentence or paragraph to merge if the user approves edits>
Validation: Generalizable <score>, Clarity <score>, Structural fit <score>, Decision impact <score>
Verification: <evidence used to verify the target, or why no target can be named>
```

### 不更新

```markdown
No durable update made.

Reason: <why the finding was not generalizable, minimal, coherent, or actionable>
```

## 类型和测试策略

- 测试文件使用 `.test.ts`。
- 测试命令使用 `node --test 'tests/**/*.test.ts'`。
- TypeScript 测试依赖 Node 原生类型剥离能力。
- Hook 文件保持 `.js`。
- Hook 文件使用 `// @ts-check`。
- Hook 公共对象使用 JSDoc typedef。
- `npm run typecheck` 使用 `tsc --noEmit -p tsconfig.json`。
- Typecheck 同时覆盖 TypeScript 测试和 JavaScript hook。
- 不引入 `tsx`。
- 不引入 `ts-node`。
- 不要求安装后构建 hook。

## 已完成任务

- [x] 建立 runtime adapter。
- [x] 建立事件状态存储。
- [x] 实现 `UserPromptSubmit` 捕获 hook。
- [x] 实现 `Stop` 续跑 hook。
- [x] 建立 Codex/Claude Code 共享 hook 配置。
- [x] 建立 `agent-feedback-loop` skill。
- [x] 拆分 workflow、source-discovery、validation 三份阶段手册。
- [x] 接入 `.codex-plugin/plugin.json`。
- [x] 接入 `.claude-plugin/plugin.json`。
- [x] 更新 README。
- [x] 把 hook 类型约束改为 JSDoc + `checkJs`。
- [x] 把测试升级为 TypeScript。
- [x] 合并到 `main`。

## 验证命令

```bash
npm test
npm run typecheck
npm run format:all
npm run lint
```

## 验证期望

- `npm test` 通过全部测试。
- `npm run typecheck` 覆盖 `tests/**/*.ts` 和 `hooks/**/*.js`。
- `npm run format:all` 不留下格式差异。
- `npm run lint` 通过。
- `git status --short` 只显示本次计划文档变更。

## 后续维护规则

- 新测试使用 `.test.ts`。
- 新 hook runtime 文件默认保持 `.js`。
- 新 hook runtime 字段必须补 JSDoc 类型。
- Hook manifest 不指向 `.ts`。
- 扩大反馈识别范围前,先添加 negative tests。
- 修改 source discovery 时,保留 known-source-first。
- 修改 source discovery 时,保留 grep 兜底。
- 修改 source discovery 时,不新增持久规则源注册表。
- 修改 skill 文档时,保持 `SKILL.md` 只放入口路由和边界。
- 修改阶段手册时,保持同一规则只有一个权威位置。
- 遇到无法验证 owner 的反馈,输出 proposal 或 no durable,不要写入猜测位置。
