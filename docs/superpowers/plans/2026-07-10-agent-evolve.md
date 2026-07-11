# Agent Evolve 实施计划

> **供实施 agent 使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项实施本计划。所有步骤使用复选框（`- [ ]`）跟踪。

**目标：** 用 session 级 Agent Evolve mode 系统替换基于 regex 与 pending event 的旧反馈循环；只向 human-facing 主 session 注入语义化反馈沉淀规则，并始终返回有证据支撑的决策。

**架构：** `SessionStart` 从持久默认值固化每个 session 的 mode，并且只在 `safe` 或 `review` 下去除 frontmatter 后注入 `agent-evolve` skill；`UserPromptSubmit` 除六条完整 mode 控制命令外始终静默。模型根据注入的 skill 与两份职责单一的阶段手册完成语义 feedback 判断和安全项目规则更新；hook 不分类 feedback，也不编辑项目文件。

**技术栈：** 带 `// @ts-check` 与 JSDoc 类型的 Node.js ESM hook、Node 内建模块（`crypto`、`fs`、`os`、`path`）、Claude Code/Codex 共用 hook JSON、TypeScript Node test runner 测试、Markdown skill 手册。

## 全局约束

- 使用同一份 hook 配置支持 Codex 与 Claude Code。
- 只向 human-facing 主 session 注入自动行为。
- 使用 matcher 为 `startup|resume|clear|compact` 的 `SessionStart` 完成激活。
- `UserPromptSubmit` 只处理六条已批准的 Agent Evolve mode 命令。
- 不使用 `SubagentStart`、`SubagentStop`、`Stop`、`SessionEnd`、完整 transcript 扫描、pending event、attempt 计数、blocked event 状态或 event status CLI 命令。
- Hook 代码不使用 regex、关键词或语义启发式分类普通 feedback。
- Mode 命令只接受 `$agent-evolve`、`/agent-evolve` 和 `@agent-evolve` 三种等价宿主调用前缀。
- Mode 只有 `safe`、`review` 和 `off`；内建默认值是 `safe`。
- 当前 session mode 优先于持久默认 mode；修改默认值只影响后续新 session。
- macOS/Linux 的持久默认值写入 `${XDG_CONFIG_HOME:-~/.config}/codeartz-skills/agent-evolve/config.json`；Windows 写入 `%APPDATA%\codeartz-skills\agent-evolve\config.json`。
- Codex session 状态写入 `${PLUGIN_DATA}/agent-evolve/sessions/<full-sha256>.json`；Claude Code 写入 `${CLAUDE_PLUGIN_DATA}/agent-evolve/sessions/<full-sha256>.json`。
- 只持久化 `defaultMode`，或 `mode` 加 `updatedAt`；不持久化原始 session id、prompt 或 feedback 内容。
- Default 与 session 状态写入都使用原子替换。
- 持久默认配置缺失时使用 `safe`；默认/session 状态损坏或不可读时产生可见、非阻塞失败。
- 状态写入失败时保留旧状态；不声称失败的切换已经成功。
- 注入精确激活头 `AGENT EVOLVE ACTIVE — mode: <safe|review>`，随后注入已移除 frontmatter 的 `skills/agent-evolve/SKILL.md`。
- `SessionStart` 激活成功时不显示 startup badge；`off` 时 `SessionStart` 不输出任何内容。
- 每个 hook JavaScript 文件都以 `// @ts-check` 开头，并按现有 `hooks/agent-feedback-capture.js` 风格使用 JSDoc `@typedef`、带类型的 `@param` 与 `@returns`。
- 每个识别出的 feedback 候选分别输出 `Decision`、`Why` 和 `Evidence`；`Target` 与 `Change` 必须显式填写，不适用时写 `不适用`。
- 自动写入只能选择一个项目已有规则源；后续 agent 必须会自动加载该文件，或能通过项目现有指令路由读取该文件。
- 修改前重新读取目标；并发变化后重新查重和查冲突；保留无关工作区改动；写入后验证 diff。
- 从持久规则与 Evidence 中删除密钥、私有 URL、邮箱、客户名、ticket 标识与事故细节。
- 产品重命名为 `agent-evolve`；不保留 alias、转发文件、deprecated 字段、状态迁移或对旧 `agent-feedback-loop` 数据的运行时读取。
- 实施期间一次性删除当前机器的旧 plugin data；新运行时不加入周期性清理逻辑。
- 实施时不修改 `docs/superpowers/specs/2026-07-10-agent-evolve-design.md`。
- 不对本计划或已批准设计 spec 使用 `instruction-doc-audit`。
- 保留工作区中的无关用户改动。

---

## 外部接口事实

- Codex 向 command hook 提供 `session_id`、`cwd` 与 `hook_event_name`；`SessionStart` 接受 `startup`、`resume`、`clear`、`compact`，两个目标事件都接受 `hookSpecificOutput.additionalContext`：<https://learn.chatgpt.com/docs/hooks>。
- Claude Code 使用相同的 `SessionStart` matcher 值，在模型处理前运行 `UserPromptSubmit`，并接受 `hookSpecificOutput.additionalContext`：<https://code.claude.com/docs/en/hooks>。
- Ponytail 证明已批准的 lifecycle 拆分可行：`SessionStart` 激活加 `UserPromptSubmit` mode 控制；本方案不沿用其共享 flag 状态，而改用 session 隔离文件：<https://github.com/DietrichGebert/ponytail/tree/main/hooks>。

## 文件结构

### 新增运行时文件

- `hooks/agent-evolve-state.js`：验证 mode，解析平台/运行时状态路径，hash session id，解析状态，执行原子读写。
- `hooks/agent-evolve-runtime.js`：解析 hook stdin，读取并移除 skill frontmatter，构造激活/off/失败上下文，序列化受支持的 hook 输出，安全写入 stdout。
- `hooks/agent-evolve-activate.js`：只处理 `SessionStart`；固化 session mode，并在激活时注入 skill。
- `hooks/agent-evolve-mode.js`：只处理完整 `UserPromptSubmit` mode 命令；更新 session 或 default 状态并报告有效 mode。

### 新增 skill 文件

- `skills/agent-evolve/SKILL.md`：只放激活/手动触发条件、mode 路由、全局边界与禁止动作。
- `skills/agent-evolve/references/workflow.md`：放语义 feedback 候选判断、抽象、落点发现、查重/查冲突、并发安全写入流程与各 mode 动作路由。
- `skills/agent-evolve/references/validation.md`：放安全门、证据门与五种精确回执。

### 新增测试

- `tests/agent-evolve-state.test.ts`：覆盖 default/session 状态、完整 SHA-256 隔离、schema 拒绝与原子写入失败时保留旧状态。
- `tests/agent-evolve-runtime.test.ts`：覆盖 stdin 解析、frontmatter 移除、激活/off/失败上下文，以及 Codex/Claude 共用输出结构。
- `tests/agent-evolve-activate.test.ts`：覆盖 `SessionStart` mode 固化、注入、off 静默、resume/clear/compact 行为与可见失败。
- `tests/agent-evolve-mode.test.ts`：覆盖六条完整命令、宿主前缀、普通 prompt 静默、session/default 优先级、重新注入与失败保留。
- `tests/agent-evolve-skill.test.ts`：约束 skill/手册职责、候选规则、mode 门、目标读取路径证据、脱敏与逐候选回执。
- `tests/agent-evolve-plugin.test.ts`：约束 manifest lifecycle 接线、旧名称/运行时/测试删除、README/metadata/assets 命名与跨 session 用户路径。

### 修改或删除的文件

- 修改 `hooks/claude-codex-hooks.json`：只注册 `SessionStart` 激活与 `UserPromptSubmit` mode 控制。
- 修改 `README.md`、`.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json`：说明 Agent Evolve 及三种 mode。
- 把 `assets/readme-illustrations/03-agent-feedback-loop.png` 重命名为 `assets/readme-illustrations/03-agent-evolve.png`；图片内容仍适用，且没有嵌入旧产品名。
- 删除 `hooks/agent-feedback-capture.js`、`hooks/agent-feedback-stop.js`、`hooks/agent-feedback-runtime.js` 与 `hooks/agent-feedback-state.js`。
- 删除 `skills/agent-feedback-loop/`，包括 `references/source-discovery.md`；只把其中仍有效且不重复的落点发现规则移动到新 workflow 手册。
- 删除全部 `tests/agent-feedback-*.test.ts` 与 `docs/superpowers/plans/2026-07-09-agent-feedback-loop.md`。

---

### Task 1：Session 隔离的 Mode 状态

**文件：**

- 创建：`hooks/agent-evolve-state.js`
- 创建：`tests/agent-evolve-state.test.ts`

**接口：**

- 输入：`NodeJS.ProcessEnv`、非空 `session_id`，以及 `safe | review | off` mode。
- 输出：`Mode`、`SessionState`、`defaultConfigPath(env, platform, homeDir)`、`sessionStatePath(sessionId, env)`、`hashSessionId(sessionId)`、`readDefaultMode(env)`、`readSessionMode(sessionId, env)`、`writeDefaultMode(mode, env)`、`writeSessionMode(sessionId, mode, env, now)` 与 `getOrCreateSessionMode(sessionId, env, now)`。
- 状态合同：default JSON 精确为 `{ "defaultMode": Mode }`；session JSON 精确为 `{ "mode": Mode, "updatedAt": ISOString }`。

- [ ] **步骤 1：编写状态合同测试**

创建 `tests/agent-evolve-state.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  defaultConfigPath,
  getOrCreateSessionMode,
  hashSessionId,
  readDefaultMode,
  readSessionMode,
  sessionStatePath,
  writeDefaultMode,
  writeSessionMode,
} from '../hooks/agent-evolve-state.js';

function tempRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function codexEnv(root: string): NodeJS.ProcessEnv {
  return {
    PLUGIN_DATA: path.join(root, 'codex-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };
}

test('defaultConfigPath follows Unix and Windows contracts', () => {
  assert.equal(
    defaultConfigPath({ XDG_CONFIG_HOME: '/tmp/xdg' }, 'darwin', '/Users/tester'),
    '/tmp/xdg/codeartz-skills/agent-evolve/config.json',
  );
  assert.equal(
    defaultConfigPath({}, 'linux', '/home/tester'),
    '/home/tester/.config/codeartz-skills/agent-evolve/config.json',
  );
  assert.equal(
    defaultConfigPath({ APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'win32', 'C:\\Users\\tester'),
    'C:\\Users\\tester\\AppData\\Roaming\\codeartz-skills\\agent-evolve\\config.json',
  );
  assert.throws(() => defaultConfigPath({}, 'win32', 'C:\\Users\\tester'), /APPDATA is required/);
});

test('missing default config resolves to built-in safe and valid config round-trips', () => {
  const root = tempRoot('agent-evolve-default');
  const env = codexEnv(root);

  assert.equal(readDefaultMode(env), 'safe');
  writeDefaultMode('review', env);
  assert.equal(readDefaultMode(env), 'review');
  assert.deepEqual(JSON.parse(fs.readFileSync(defaultConfigPath(env), 'utf8')), {
    defaultMode: 'review',
  });
});

test('default config rejects corrupt JSON, unsupported modes, and extra fields', () => {
  const root = tempRoot('agent-evolve-invalid-default');
  const env = codexEnv(root);
  const configPath = defaultConfigPath(env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  fs.writeFileSync(configPath, '{bad json', 'utf8');
  assert.throws(() => readDefaultMode(env), /Invalid Agent Evolve default config/);

  fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'collect' }), 'utf8');
  assert.throws(() => readDefaultMode(env), /Invalid Agent Evolve default config/);

  fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'safe', enabled: true }), 'utf8');
  assert.throws(() => readDefaultMode(env), /Invalid Agent Evolve default config/);
});

test('unreadable default config path fails instead of guessing safe', () => {
  const root = tempRoot('agent-evolve-unreadable-default');
  const configRoot = path.join(root, 'config-as-file');
  fs.writeFileSync(configRoot, 'not a directory', 'utf8');

  assert.throws(() => readDefaultMode({ XDG_CONFIG_HOME: configRoot }), /Unable to read Agent Evolve default config/);
});

test('session paths use the full SHA-256 and never persist the raw session id', () => {
  const root = tempRoot('agent-evolve-hash');
  const env = codexEnv(root);
  const sessionId = 'private/session:id@example.com';
  const digest = hashSessionId(sessionId);
  const statePath = sessionStatePath(sessionId, env);

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(path.basename(statePath), `${digest}.json`);
  assert.doesNotMatch(path.basename(statePath), /private|session|example/);

  writeSessionMode(sessionId, 'review', env, () => new Date('2026-07-10T00:00:00.000Z'));
  const raw = fs.readFileSync(statePath, 'utf8');
  assert.doesNotMatch(raw, /private|session:id|example\.com/);
  assert.deepEqual(JSON.parse(raw), {
    mode: 'review',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
});

test('Codex and Claude Code session state use their own plugin data roots', () => {
  const root = tempRoot('agent-evolve-hosts');
  const codexPath = sessionStatePath('same-session', {
    PLUGIN_DATA: path.join(root, 'codex'),
  });
  const claudePath = sessionStatePath('same-session', {
    CLAUDE_PLUGIN_DATA: path.join(root, 'claude'),
  });

  assert.match(codexPath, /codex[/\\]agent-evolve[/\\]sessions/);
  assert.match(claudePath, /claude[/\\]agent-evolve[/\\]sessions/);
  assert.notEqual(codexPath, claudePath);
  assert.throws(() => sessionStatePath('session', {}), /plugin data directory is unavailable/);
});

test('getOrCreateSessionMode pins the effective default once per session', () => {
  const root = tempRoot('agent-evolve-pin');
  const env = codexEnv(root);

  writeDefaultMode('review', env);
  assert.equal(
    getOrCreateSessionMode('session-a', env, () => new Date('2026-07-10T01:00:00.000Z')),
    'review',
  );

  writeDefaultMode('off', env);
  assert.equal(getOrCreateSessionMode('session-a', env), 'review');
  assert.equal(getOrCreateSessionMode('session-b', env), 'off');
});

test('different session ids have isolated modes', () => {
  const root = tempRoot('agent-evolve-isolation');
  const env = codexEnv(root);

  writeSessionMode('session-a', 'safe', env);
  writeSessionMode('session-b', 'review', env);

  assert.equal(readSessionMode('session-a', env), 'safe');
  assert.equal(readSessionMode('session-b', env), 'review');
});

test('session state rejects corrupt JSON, invalid timestamps, and extra fields', () => {
  const root = tempRoot('agent-evolve-invalid-session');
  const env = codexEnv(root);
  const statePath = sessionStatePath('session-a', env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  fs.writeFileSync(statePath, '{bad json', 'utf8');
  assert.throws(() => readSessionMode('session-a', env), /Invalid Agent Evolve session state/);

  fs.writeFileSync(statePath, JSON.stringify({ mode: 'safe', updatedAt: 'yesterday' }), 'utf8');
  assert.throws(() => readSessionMode('session-a', env), /Invalid Agent Evolve session state/);

  fs.writeFileSync(
    statePath,
    JSON.stringify({ mode: 'safe', updatedAt: '2026-07-10T00:00:00.000Z', prompt: 'secret' }),
    'utf8',
  );
  assert.throws(() => readSessionMode('session-a', env), /Invalid Agent Evolve session state/);
});

test('failed atomic session write preserves the previous state', { skip: process.platform === 'win32' }, () => {
  const root = tempRoot('agent-evolve-atomic');
  const env = codexEnv(root);
  const statePath = sessionStatePath('session-a', env);

  writeSessionMode('session-a', 'safe', env);
  fs.chmodSync(path.dirname(statePath), 0o500);
  try {
    assert.throws(() => writeSessionMode('session-a', 'review', env), /Unable to write Agent Evolve state/);
  } finally {
    fs.chmodSync(path.dirname(statePath), 0o700);
  }

  assert.equal(readSessionMode('session-a', env), 'safe');
});
```

- [ ] **步骤 2：运行状态测试，确认新模块尚不存在**

运行：

```bash
node --test tests/agent-evolve-state.test.ts
```

预期：FAIL，错误为 `hooks/agent-evolve-state.js` 的 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现带 schema 验证的原子 mode 状态**

创建 `hooks/agent-evolve-state.js`：

```js
// @ts-check

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {'safe' | 'review' | 'off'} Mode
 */

/**
 * @typedef {{ defaultMode: Mode }} DefaultConfig
 */

/**
 * @typedef {{ mode: Mode; updatedAt: string }} SessionState
 */

/** @type {ReadonlySet<string>} */
const MODES = new Set(['safe', 'review', 'off']);

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>} Whether the value is a non-array record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Mode} Whether the value is an Agent Evolve mode.
 */
export function isMode(value) {
  return typeof value === 'string' && MODES.has(value);
}

/**
 * @param {Record<string, unknown>} value - Object whose keys must be checked.
 * @param {string[]} expected - Exact allowed keys.
 * @returns {boolean} Whether the object has exactly the expected keys.
 */
function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is DefaultConfig} Whether the value matches the default config schema.
 */
function isDefaultConfig(value) {
  return isRecord(value) && hasExactKeys(value, ['defaultMode']) && isMode(value.defaultMode);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is SessionState} Whether the value matches the session state schema.
 */
function isSessionState(value) {
  if (!isRecord(value) || !hasExactKeys(value, ['mode', 'updatedAt']) || !isMode(value.mode)) {
    return false;
  }
  if (typeof value.updatedAt !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value.updatedAt);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.updatedAt;
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {string} Stable error message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {boolean} Whether the error represents a missing path.
 */
function isMissing(error) {
  return isRecord(error) && error.code === 'ENOENT';
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {NodeJS.Platform} [platform] - Platform override for tests.
 * @param {string} [homeDir] - Home directory override for tests.
 * @returns {string} Persistent default configuration path.
 */
export function defaultConfigPath(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (platform === 'win32') {
    if (!env.APPDATA) {
      throw new Error('APPDATA is required for Agent Evolve default config on Windows.');
    }
    return path.win32.join(env.APPDATA, 'codeartz-skills', 'agent-evolve', 'config.json');
  }
  const configRoot = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(configRoot, 'codeartz-skills', 'agent-evolve', 'config.json');
}

/**
 * @param {string} sessionId - Raw host session id.
 * @returns {string} Full lowercase SHA-256 digest.
 */
export function hashSessionId(sessionId) {
  if (!sessionId) {
    throw new Error('Agent Evolve requires a non-empty session_id.');
  }
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {string} Runtime-specific plugin data root.
 */
function pluginDataRoot(env = process.env) {
  const root = env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA;
  if (!root) {
    throw new Error('Agent Evolve plugin data directory is unavailable.');
  }
  return root;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {string} Session state path containing only the hashed id.
 */
export function sessionStatePath(sessionId, env = process.env) {
  return path.join(pluginDataRoot(env), 'agent-evolve', 'sessions', `${hashSessionId(sessionId)}.json`);
}

/**
 * @param {string} filePath - JSON file to read.
 * @param {string} label - Human-readable schema label.
 * @returns {{ exists: false } | { exists: true; value: unknown }} Parsed value or missing marker.
 */
function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    if (isMissing(error)) {
      return { exists: false };
    }
    throw new Error(`Unable to read ${label} at ${filePath}: ${errorMessage(error)}`);
  }

  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Invalid ${label} at ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * @param {string} filePath - Destination JSON path.
 * @param {DefaultConfig | SessionState} value - Valid state to serialize.
 * @returns {void} No return value.
 */
function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw new Error(`Unable to write Agent Evolve state at ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode} Persistent default mode, or built-in safe when the file is absent.
 */
export function readDefaultMode(env = process.env) {
  const filePath = defaultConfigPath(env);
  const result = readJsonFile(filePath, 'Agent Evolve default config');
  if (!result.exists) {
    return 'safe';
  }
  if (!isDefaultConfig(result.value)) {
    throw new Error(`Invalid Agent Evolve default config at ${filePath}: expected only defaultMode.`);
  }
  return result.value.defaultMode;
}

/**
 * @param {Mode} mode - New persistent default.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode} Persisted mode.
 */
export function writeDefaultMode(mode, env = process.env) {
  if (!isMode(mode)) {
    throw new Error(`Invalid Agent Evolve mode: ${String(mode)}`);
  }
  atomicWriteJson(defaultConfigPath(env), { defaultMode: mode });
  return mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode | null} Stored session mode, or null when no state exists.
 */
export function readSessionMode(sessionId, env = process.env) {
  const filePath = sessionStatePath(sessionId, env);
  const result = readJsonFile(filePath, 'Agent Evolve session state');
  if (!result.exists) {
    return null;
  }
  if (!isSessionState(result.value)) {
    throw new Error(`Invalid Agent Evolve session state at ${filePath}: expected only mode and updatedAt.`);
  }
  return result.value.mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {Mode} mode - New session mode.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {() => Date} [now] - Clock override for tests.
 * @returns {Mode} Persisted mode.
 */
export function writeSessionMode(sessionId, mode, env = process.env, now = () => new Date()) {
  if (!isMode(mode)) {
    throw new Error(`Invalid Agent Evolve mode: ${String(mode)}`);
  }
  const state = { mode, updatedAt: now().toISOString() };
  atomicWriteJson(sessionStatePath(sessionId, env), state);
  return mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {() => Date} [now] - Clock override for tests.
 * @returns {Mode} Existing session mode or newly materialized default.
 */
export function getOrCreateSessionMode(sessionId, env = process.env, now = () => new Date()) {
  const existing = readSessionMode(sessionId, env);
  if (existing) {
    return existing;
  }
  const mode = readDefaultMode(env);
  return writeSessionMode(sessionId, mode, env, now);
}
```

- [ ] **步骤 4：运行状态测试**

运行：

```bash
node --test tests/agent-evolve-state.test.ts
```

预期：10 个测试通过，0 个失败；只在 Windows 跳过原子写入失败测试。

- [ ] **步骤 5：对新状态接口运行 JavaScript 类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS；`hooks/agent-evolve-state.js` 与 `tests/agent-evolve-state.test.ts` 没有 TypeScript 诊断。

- [ ] **步骤 6：提交状态切片**

```bash
git add hooks/agent-evolve-state.js tests/agent-evolve-state.test.ts
git commit -m "feat(agent-evolve): add session mode state"
```

---

### Task 2：共用 Hook Runtime 与 Skill 注入构造器

**文件：**

- 创建：`hooks/agent-evolve-runtime.js`
- 创建：`tests/agent-evolve-runtime.test.ts`

**接口：**

- 输入：`hooks/agent-evolve-state.js` 的 `Mode`、原始 hook stdin、`skills/agent-evolve/SKILL.md` 文本。
- 输出：`HookInput`、`readJsonFromString(text)`、`readStdinWithTimeout(timeoutMs)`、`stripFrontmatter(markdown)`、`loadSkillBody(skillPath)`、`buildActivationContext(mode, skillBody)`、`buildOffContext()`、`buildHookOutput(options)`、`buildFailureOutput(eventName, action, error)` 与 `writeStdoutSafely(text)`。
- 输出合同：两个宿主都接收包含 `hookSpecificOutput.hookEventName` 与 `hookSpecificOutput.additionalContext` 的 JSON；`systemMessage` 只用于 mode 状态或失败，不用于成功的 session 激活。

- [ ] **步骤 1：编写 runtime 与注入构造器测试**

创建 `tests/agent-evolve-runtime.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  buildOffContext,
  loadSkillBody,
  readJsonFromString,
  stripFrontmatter,
} from '../hooks/agent-evolve-runtime.js';

test('readJsonFromString accepts only JSON records', () => {
  assert.deepEqual(readJsonFromString('{"hook_event_name":"SessionStart","session_id":"s1"}'), {
    hook_event_name: 'SessionStart',
    session_id: 's1',
  });
  assert.equal(readJsonFromString('{bad json'), null);
  assert.equal(readJsonFromString('[]'), null);
  assert.equal(readJsonFromString('"text"'), null);
});

test('stripFrontmatter removes exactly the YAML envelope and keeps the skill body', () => {
  const markdown = [
    '---',
    'name: agent-evolve',
    'description: test',
    '---',
    '',
    '# Agent Evolve',
    '',
    '- Rule one.',
    '',
  ].join('\n');

  assert.equal(stripFrontmatter(markdown), '# Agent Evolve\n\n- Rule one.');
  assert.throws(() => stripFrontmatter('# Missing frontmatter'), /frontmatter is missing/);
  assert.throws(() => stripFrontmatter('---\nname: broken'), /frontmatter is incomplete/);
});

test('loadSkillBody reads a complete skill and rejects unreadable or partial input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-skill-'));
  const skillPath = path.join(root, 'SKILL.md');
  fs.writeFileSync(
    skillPath,
    '---\nname: agent-evolve\ndescription: test\n---\n\n# Agent Evolve\n\nUse the workflow.\n',
    'utf8',
  );

  assert.equal(loadSkillBody(skillPath), '# Agent Evolve\n\nUse the workflow.');
  assert.throws(() => loadSkillBody(path.join(root, 'missing.md')), /Unable to read Agent Evolve skill/);

  fs.writeFileSync(skillPath, '---\nname: agent-evolve', 'utf8');
  assert.throws(() => loadSkillBody(skillPath), /frontmatter is incomplete/);
});

test('buildActivationContext uses the approved header and never leaks frontmatter', () => {
  const context = buildActivationContext('review', '# Agent Evolve\n\nRead `references/workflow.md`.');

  assert.equal(context, 'AGENT EVOLVE ACTIVE — mode: review\n\n# Agent Evolve\n\nRead `references/workflow.md`.');
  assert.doesNotMatch(context, /^---/m);
});

test('buildOffContext disables automatic behavior but preserves manual invocation', () => {
  const context = buildOffContext();
  assert.match(context, /AGENT EVOLVE OFF/);
  assert.match(context, /automatic feedback recognition and persistence are disabled/);
  assert.match(context, /Manual \$agent-evolve invocation remains available/);
});

test('buildHookOutput uses a shape supported by Codex and Claude Code', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'SessionStart',
      additionalContext: 'AGENT EVOLVE ACTIVE — mode: safe',
    }),
  );

  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'AGENT EVOLVE ACTIVE — mode: safe',
    },
  });
  assert.equal(buildHookOutput({ eventName: 'UserPromptSubmit' }), '');
});

test('buildHookOutput includes systemMessage only when explicitly requested', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'UserPromptSubmit',
      additionalContext: 'Current session mode is review.',
      systemMessage: 'Agent Evolve mode: review; default: safe',
    }),
  );

  assert.equal(output.systemMessage, 'Agent Evolve mode: review; default: safe');
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('buildFailureOutput provides visible, non-blocking evidence', () => {
  const output = JSON.parse(
    buildFailureOutput('SessionStart', 'session activation', new Error('config.json is invalid')),
  );

  assert.match(output.systemMessage, /Agent Evolve failed: session activation/);
  assert.match(output.systemMessage, /config\.json is invalid/);
  assert.match(output.hookSpecificOutput.additionalContext, /Why: session activation failed/);
  assert.match(output.hookSpecificOutput.additionalContext, /Evidence: config\.json is invalid/);
  assert.match(output.hookSpecificOutput.additionalContext, /Continue the current user task/);
  assert.equal(output.continue, true);
});
```

- [ ] **步骤 2：运行 runtime 测试，确认新模块尚不存在**

运行：

```bash
node --test tests/agent-evolve-runtime.test.ts
```

预期：FAIL，错误为 `hooks/agent-evolve-runtime.js` 的 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现带类型的共用 hook runtime**

创建 `hooks/agent-evolve-runtime.js`：

```js
// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {import('./agent-evolve-state.js').Mode} Mode
 */

/**
 * @typedef {{
 *   cwd?: string;
 *   hook_event_name?: string;
 *   prompt?: string;
 *   session_id?: string;
 *   source?: string;
 * }} HookInput
 */

/**
 * @typedef {{
 *   eventName: 'SessionStart' | 'UserPromptSubmit';
 *   additionalContext?: string;
 *   systemMessage?: string;
 *   continueValue?: boolean;
 * }} HookOutputOptions
 */

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillPath = path.join(pluginRoot, 'skills', 'agent-evolve', 'SKILL.md');

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>} Whether the value is a non-array record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {string} Stable error message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} text - Raw JSON text.
 * @returns {HookInput | null} Parsed hook input record, or null for invalid input.
 */
export function readJsonFromString(text) {
  try {
    const parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {number} [timeoutMs] - Maximum wait for stdin.
 * @returns {Promise<HookInput | null>} Parsed hook input or null on timeout/invalid JSON.
 */
export function readStdinWithTimeout(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let input = '';
    let done = false;

    /** @returns {void} */
    function finish() {
      if (done) {
        return;
      }
      done = true;
      resolve(readJsonFromString(input));
    }

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, timeoutMs).unref();
  });
}

/**
 * @param {string} markdown - Skill file with YAML frontmatter.
 * @returns {string} Trimmed skill body without frontmatter.
 */
export function stripFrontmatter(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Agent Evolve skill frontmatter is missing.');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('Agent Evolve skill frontmatter is incomplete.');
  }
  const body = normalized.slice(end + 5).trim();
  if (!body) {
    throw new Error('Agent Evolve skill body is empty.');
  }
  return body;
}

/**
 * @param {string} [skillPath] - Skill path override for tests.
 * @returns {string} Frontmatter-free skill body.
 */
export function loadSkillBody(skillPath = defaultSkillPath) {
  let markdown;
  try {
    markdown = fs.readFileSync(skillPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read Agent Evolve skill at ${skillPath}: ${errorMessage(error)}`);
  }
  return stripFrontmatter(markdown);
}

/**
 * @param {Mode} mode - Active safe or review mode.
 * @param {string} skillBody - Frontmatter-free skill body.
 * @returns {string} Context injected into a main session.
 */
export function buildActivationContext(mode, skillBody) {
  if (mode !== 'safe' && mode !== 'review') {
    throw new Error(`Cannot build Agent Evolve activation context for mode: ${mode}`);
  }
  return `AGENT EVOLVE ACTIVE — mode: ${mode}\n\n${skillBody.trim()}`;
}

/**
 * @returns {string} Context that disables automatic behavior after a session switch.
 */
export function buildOffContext() {
  return [
    'AGENT EVOLVE OFF — automatic feedback recognition and persistence are disabled for this session.',
    'Manual $agent-evolve invocation remains available.',
  ].join('\n');
}

/**
 * @param {HookOutputOptions} options - Hook output fields.
 * @returns {string} Serialized supported hook output, or empty string for silence.
 */
export function buildHookOutput({ eventName, additionalContext = '', systemMessage = '', continueValue }) {
  /** @type {Record<string, unknown>} */
  const output = {};
  if (typeof continueValue === 'boolean') {
    output.continue = continueValue;
  }
  if (systemMessage) {
    output.systemMessage = systemMessage;
  }
  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: eventName,
      additionalContext,
    };
  }
  return Object.keys(output).length > 0 ? JSON.stringify(output) : '';
}

/**
 * @param {'SessionStart' | 'UserPromptSubmit'} eventName - Hook event that failed.
 * @param {string} action - Human-readable action.
 * @param {unknown} error - Actual failure.
 * @returns {string} Visible, non-blocking failure output.
 */
export function buildFailureOutput(eventName, action, error) {
  const evidence = errorMessage(error);
  return buildHookOutput({
    eventName,
    continueValue: true,
    systemMessage: `Agent Evolve failed: ${action}. Evidence: ${evidence}`,
    additionalContext: [
      'AGENT EVOLVE FAILURE',
      `Why: ${action} failed; automatic feedback persistence was not changed for this event.`,
      `Evidence: ${evidence}`,
      'Continue the current user task without relying on automatic Agent Evolve behavior.',
    ].join('\n'),
  });
}

/**
 * @param {string} text - Serialized hook output.
 * @returns {void} No return value.
 */
export function writeStdoutSafely(text) {
  if (!text) {
    return;
  }
  try {
    process.stdout.write(text);
  } catch {
    // A closed hook stdout must not block the user session.
  }
}
```

- [ ] **步骤 4：运行 runtime 测试**

运行：

```bash
node --test tests/agent-evolve-runtime.test.ts
```

预期：8 个测试通过，0 个失败。

- [ ] **步骤 5：跨 state/runtime 边界运行类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS；`Mode` import 与全部 JSDoc 函数签名一致。

- [ ] **步骤 6：提交 runtime 切片**

```bash
git add hooks/agent-evolve-runtime.js tests/agent-evolve-runtime.test.ts
git commit -m "feat(agent-evolve): add hook runtime"
```

---

### Task 3：Agent Evolve Skill 与两份阶段手册

**文件：**

- 创建：`skills/agent-evolve/SKILL.md`
- 创建：`skills/agent-evolve/references/workflow.md`
- 创建：`skills/agent-evolve/references/validation.md`
- 创建：`tests/agent-evolve-skill.test.ts`
- 删除：`skills/agent-feedback-loop/SKILL.md`
- 删除：`skills/agent-feedback-loop/references/workflow.md`
- 删除：`skills/agent-feedback-loop/references/source-discovery.md`
- 删除：`skills/agent-feedback-loop/references/validation.md`

**接口：**

- 输入：注入头中的有效 mode、当前 human 消息、可见对话、项目文件/diff/测试/review 证据。
- 输出：`SKILL.md` 路由到 `workflow.md`，再在任何写入、提案或不沉淀前路由到 `validation.md`。
- 权威位置：feedback 判断与落点发现只在 `workflow.md`；安全门、证据门与回执模板只在 `validation.md`；不创建 `source-discovery.md`。

- [ ] **步骤 1：编写 skill 职责与行为合同测试**

创建 `tests/agent-evolve-skill.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const skillPath = 'skills/agent-evolve/SKILL.md';
const workflowPath = 'skills/agent-evolve/references/workflow.md';
const validationPath = 'skills/agent-evolve/references/validation.md';

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

test('agent-evolve has the approved name and routes only to workflow and validation', () => {
  const skill = read(skillPath);

  assert.match(skill, /^---\nname: agent-evolve\n/);
  assert.match(skill, /references\/workflow\.md/);
  assert.match(skill, /references\/validation\.md/);
  assert.doesNotMatch(skill, /source-discovery/);
  assert.equal(fs.existsSync('skills/agent-evolve/references/source-discovery.md'), false);
});

test('SKILL contains only triggers, mode routing, global boundaries, and prohibitions', () => {
  const skill = read(skillPath);

  assert.match(skill, /## 触发条件/);
  assert.match(skill, /## Mode 路由/);
  assert.match(skill, /## 全局边界/);
  assert.match(skill, /## 禁止动作/);
  assert.doesNotMatch(skill, /## 落点发现/);
  assert.doesNotMatch(skill, /Feedback decision: Updated/);
  assert.doesNotMatch(skill, /rg --files/);
});

test('workflow recognizes only direct human feedback without trigger-word dependence', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /直接来自 human/);
  assert.match(workflow, /不要求 human 使用“以后”“记住”“不要再”或“写进规则”/);
  assert.match(workflow, /普通问题/);
  assert.match(workflow, /单次任务需求/);
  assert.match(workflow, /只适用于当前文件的一次性选择/);
  assert.match(workflow, /Subagent 产生的观察/);
  assert.match(workflow, /Agent 自己的总结或建议/);
  assert.match(workflow, /没有得到 human 确认的 review finding/);
  assert.match(workflow, /mode 控制命令/);
});

test('workflow owns target discovery, duplicate/conflict checks, and future-read proof', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /## 落点发现/);
  assert.match(workflow, /用户明确指定的位置/);
  assert.match(workflow, /AGENTS\.md/);
  assert.match(workflow, /CLAUDE\.md/);
  assert.match(workflow, /未来 agent/);
  assert.match(workflow, /自动加载/);
  assert.match(workflow, /现有项目指令路由/);
  assert.match(workflow, /禁止把 grep 命中直接当成 owner/);
  assert.match(workflow, /重复时不追加第二份规则/);
  assert.match(workflow, /冲突时不覆盖旧规则/);
  assert.match(workflow, /修改前重新读取目标文件/);
  assert.match(workflow, /验证实际 diff/);
});

test('workflow routes safe, review, and manual-off behavior without hook event state', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /### Safe mode/);
  assert.match(workflow, /### Review mode/);
  assert.match(workflow, /### Off mode 的手动调用/);
  assert.match(workflow, /用户明确批准后/);
  assert.doesNotMatch(workflow, /eventPath|attempts|mark <eventPath>|pending event/);
});

test('validation owns safety gates, redaction, and per-candidate receipts', () => {
  const validation = read(validationPath);

  assert.match(validation, /## 安全门/);
  assert.match(validation, /唯一 owner/);
  assert.match(validation, /未来 agent 读取路径证据/);
  assert.match(validation, /敏感内容/);
  assert.match(validation, /密钥/);
  assert.match(validation, /私有 URL/);
  assert.match(validation, /邮箱/);
  assert.match(validation, /客户名/);
  assert.match(validation, /ticket/);
  assert.match(validation, /事故细节/);
  assert.match(validation, /每条候选分别输出/);
  assert.match(validation, /Decision/);
  assert.match(validation, /Why/);
  assert.match(validation, /Evidence/);
  assert.match(validation, /Target/);
  assert.match(validation, /Change/);
});

test('validation defines all five decisions and explicit not-applicable fields', () => {
  const validation = read(validationPath);

  for (const decision of ['Updated', 'Already covered', 'Proposed', 'Not persisted', 'Failed']) {
    assert.match(validation, new RegExp(`Feedback decision: ${decision}`));
  }
  assert.match(validation, /Target: 不适用/);
  assert.match(validation, /Change: 不适用/);
  assert.match(validation, /同一轮存在多条 feedback 候选时/);
});

test('new skill contains no old runtime protocol or forbidden extra audit', () => {
  const combined = [skillPath, workflowPath, validationPath].map(read).join('\n');

  assert.equal(combined.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(combined.includes(['agent', 'feedback', 'state'].join('-')), false);
  assert.doesNotMatch(combined, /instruction-doc-audit/);
  assert.doesNotMatch(combined, /rule-sources\.json/);
});
```

- [ ] **步骤 2：运行 skill 测试，确认新 skill 尚不存在**

运行：

```bash
node --test tests/agent-evolve-skill.test.ts
```

预期：FAIL，首个错误是 `skills/agent-evolve/SKILL.md` 不存在。

- [ ] **步骤 3：创建只负责入口路由的 SKILL.md**

创建 `skills/agent-evolve/SKILL.md`：

```markdown
---
name: agent-evolve
description: 当主 session 需要根据直接 human feedback 改进未来项目决策，或用户手动调用 Agent Evolve 评估、提案、批准沉淀时使用。该技能按 safe、review、off mode 路由，把可复用反馈安全合并到未来 agent 会读取的项目已有规则源，并为每条候选提供 Why + Evidence。
---

# Agent Evolve

## 触发条件

- 上下文存在 `AGENT EVOLVE ACTIVE — mode: safe` 时，对当前主 session 中直接来自 human 的 feedback 自动运行本技能。
- 上下文存在 `AGENT EVOLVE ACTIVE — mode: review` 时，对当前主 session 中直接来自 human 的 feedback 自动运行本技能。
- 用户手动调用 `$agent-evolve` 时运行本技能。
- Feedback 是否触发由完整语义决定，不由关键词决定。

## Mode 路由

- `safe`：读取 `references/workflow.md` 完成候选判断与落点分析；读取 `references/validation.md`；全部安全门通过时可以直接更新。
- `review`：读取 `references/workflow.md` 完成候选判断与精确提案；读取 `references/validation.md`；用户批准前不更新项目规则源。
- `off`：不自动运行；用户手动调用时读取 `references/workflow.md` 与 `references/validation.md`，只处理本次显式请求。

## 全局边界

- 只处理直接来自 human 的 feedback。
- 只在与 human 对话的主 session 自动处理。
- 先继续完成当前用户任务，再在同一轮完成 feedback 决策。
- Feedback 处理失败不得阻止当前用户任务继续完成。
- 每条 feedback 候选分别提供 `Decision`、`Why` 和 `Evidence`。
- 只使用当前可见对话、项目文件、diff、测试与 review 证据。
- 用户明确批准 review 提案后，按批准内容重新读取目标并再次验证。

## 禁止动作

- 禁止处理 Subagent 产生的观察、建议或未获 human 确认的 review finding。
- 禁止扫描完整 transcript 做会后复盘。
- 禁止使用模型记忆补造 feedback。
- 禁止创建 feedback inbox。
- 禁止创建随机规则文件绕过 owner 不明确。
- 禁止自动提交 git commit。
- 禁止启动额外 agent turn 处理 feedback。
```

- [ ] **步骤 4：创建 feedback 判断与写入 workflow 手册**

创建 `skills/agent-evolve/references/workflow.md`：

````markdown
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
````

- [ ] **步骤 5：创建安全门、证据门与回执手册**

创建 `skills/agent-evolve/references/validation.md`：

````markdown
# Agent Evolve Validation

## 目标

在更新、提案或不沉淀前验证安全性，并为每条 feedback 候选生成可核对的 `Why + Evidence` 回执。

## 安全门

直接写入必须同时满足：

- Workflow 已把当前 human 内容判定为可复用 feedback 候选。
- Workflow 已生成不依赖私有事故上下文的抽象规则。
- 已找到唯一 owner。
- 已取得未来 agent 读取路径证据。
- 目标文件可写。
- 已完成目标段落、相邻规则与同主题候选文件查重。
- 没有相同规则需要判为 `Already covered`。
- 已检查反向规则、例外与优先级约束。
- 没有未解决冲突。
- 抽象规则与 Evidence 不包含敏感内容。
- 当前 mode 允许写入，或 review/off 手动流程已经获得 human 明确批准。
- 修改前已重新读取目标文件。
- 并发变化后的查重与查冲突仍然通过。

- 任一安全门失败时禁止直接写入。
- Mode 是 `review` 且未获批准时禁止直接写入。
- 找不到唯一 owner 时禁止创建随机规则源。
- 找不到未来 agent 读取路径证据时禁止声称后续 session 会受益。

## 敏感内容门

规则与 Evidence 都不得保存或复述：

- 密钥。
- 私有 URL。
- 邮箱。
- 客户名。
- ticket 编号。
- 事故名称或事故细节。
- 私有项目标识。
- 长日志或原始堆栈。

- 只保留经过抽象、仍会改变未来决策的语义。
- 实际错误包含敏感内容时，先脱敏再写入 Evidence。

## Evidence 门

- `Why` 写明本次决策的直接原因。
- `Evidence` 引用 human 消息中会改变未来决策的语义，不复制敏感原文。
- 文件证据写明文件和标题或行号。
- 声明目标唯一时写明检查过的候选范围。
- 声明没有重复时写明查重范围。
- 声明没有冲突时写明检查过的相邻规则、反向规则或候选文件。
- 声明后续 session 会受益时写明自动加载机制或现有项目指令路由。
- 更新成功时引用实际 diff 或重新读取结果。
- 测试或 review 参与判断时写明命令、结果或结论位置。
- 禁止只写“已检查”“符合要求”或“判断安全”。

## 决策选择

- 安全写入成功：`Updated`。
- 已有规则语义相同：`Already covered`。
- 当前 mode、owner、读取路径或冲突条件不允许直接写，但存在精确建议：`Proposed`。
- 内容只适用于当前任务，或不适合作为长期规则：`Not persisted`。
- 已尝试的读取、状态、写入或验证动作失败：`Failed`。

- 同一轮存在多条 feedback 候选时，每条候选分别输出 `Decision`、`Why` 和 `Evidence`。
- 多条回执可以放在同一个紧凑区块中。
- 禁止用一条汇总结论覆盖不同候选的处理结果。

## 回执模板

### Updated

```text
Feedback decision: Updated
Why: <为什么该反馈会改变未来项目决策>
Evidence: <为什么该位置唯一、未来 agent 会读取、无重复且无冲突；以及实际 diff 证据>
Target: <文件和标题>
Change: <写入后的抽象规则>
```

### Already covered

```text
Feedback decision: Already covered
Why: 不应生成第二份相同规则。
Evidence: <现有文件、标题或行号，以及查重范围>
Target: <已有规则的文件和标题>
Change: 不适用
```

### Proposed

```text
Feedback decision: Proposed
Why: <为什么当前 mode 或安全门不允许直接写入>
Evidence: <候选位置、未来读取路径、冲突或缺失证据>
Target: <建议文件和标题>
Change: <精确提案>
```

### Not persisted

```text
Feedback decision: Not persisted
Why: <为什么反馈不适合成为长期项目规则>
Evidence: <当前 human 消息中的范围证据或项目证据>
Target: 不适用
Change: 不适用
```

### Failed

```text
Feedback decision: Failed
Why: <失败动作>
Evidence: <脱敏后的实际错误或验证结果>
Target: <尝试修改的文件或不适用>
Change: 不适用
```

## 失败边界

- Feedback 处理失败不得阻止当前用户任务继续完成。
- 读取目标失败时不声称已完成查重或查冲突。
- 写入失败时不声称规则已更新。
- Diff 验证失败时使用 `Failed` 回执。
- 保留失败前已有的用户工作区改动。
````

- [ ] **步骤 6：删除旧 skill 目录，不保留转发或兼容文件**

运行：

```bash
rm -rf skills/agent-feedback-loop
```

预期：`test ! -e skills/agent-feedback-loop` 返回 0；`skills/agent-evolve/` 只包含 `SKILL.md`、`references/workflow.md` 与 `references/validation.md`。

- [ ] **步骤 7：运行 skill 合同测试**

运行：

```bash
node --test tests/agent-evolve-skill.test.ts
```

预期：8 个测试通过，0 个失败。

- [ ] **步骤 8：提交 skill 切片**

```bash
git add skills/agent-evolve tests/agent-evolve-skill.test.ts
git add -u skills/agent-feedback-loop
git commit -m "feat(agent-evolve): replace feedback skill"
```

---

### Task 4：SessionStart 激活 Hook

**文件：**

- 创建：`hooks/agent-evolve-activate.js`
- 创建：`tests/agent-evolve-activate.test.ts`

**接口：**

- 输入：`HookInput`，其中 `hook_event_name` 必须是 `SessionStart` 且 `session_id` 非空。
- 使用：`getOrCreateSessionMode(sessionId, env)`、`loadSkillBody(skillPath)`、`buildActivationContext(mode, body)`、`buildHookOutput(options)`、`buildFailureOutput(...)`。
- 输出：`handleSessionStart(input, env, skillPath)` 返回完整 stdout 字符串；`main(env)` 从 stdin 读取后安全写出。

- [ ] **步骤 1：编写 SessionStart 激活测试**

创建 `tests/agent-evolve-activate.test.ts`：

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleSessionStart } from '../hooks/agent-evolve-activate.js';
import { readSessionMode, sessionStatePath, writeDefaultMode, writeSessionMode } from '../hooks/agent-evolve-state.js';

const activateScript = path.join(process.cwd(), 'hooks', 'agent-evolve-activate.js');

function tempEnv(host: 'codex' | 'claude' = 'codex'): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-evolve-activate-${host}-`));
  const pluginDataKey = host === 'codex' ? 'PLUGIN_DATA' : 'CLAUDE_PLUGIN_DATA';
  return {
    [pluginDataKey]: path.join(root, 'plugin-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };
}

function runActivate(input: Record<string, unknown> | string, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [activateScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: typeof input === 'string' ? input : JSON.stringify(input),
  });
}

test('new Codex session materializes safe and injects frontmatter-free skill without a badge', () => {
  const env = tempEnv('codex');
  const result = runActivate(
    {
      cwd: '/repo/project',
      hook_event_name: 'SessionStart',
      session_id: 'codex-session',
      source: 'startup',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.systemMessage, undefined);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /^AGENT EVOLVE ACTIVE — mode: safe/);
  assert.match(output.hookSpecificOutput.additionalContext, /# Agent Evolve/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /^---/m);
  assert.equal(readSessionMode('codex-session', env), 'safe');
});

test('new Claude Code session uses review default and the common hook output shape', () => {
  const env = tempEnv('claude');
  writeDefaultMode('review', env);

  const result = runActivate(
    {
      cwd: '/repo/project',
      hook_event_name: 'SessionStart',
      session_id: 'claude-session',
      source: 'startup',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  assert.match(output.hookSpecificOutput.additionalContext, /^AGENT EVOLVE ACTIVE — mode: review/);
  assert.equal(readSessionMode('claude-session', env), 'review');
});

test('off default materializes session state and emits no SessionStart output', () => {
  const env = tempEnv();
  writeDefaultMode('off', env);

  const result = runActivate(
    {
      hook_event_name: 'SessionStart',
      session_id: 'off-session',
      source: 'startup',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(readSessionMode('off-session', env), 'off');
});

test('resume, clear, and compact preserve the already-materialized session mode', () => {
  for (const source of ['resume', 'clear', 'compact']) {
    const env = tempEnv();
    writeDefaultMode('off', env);
    writeSessionMode('existing-session', 'review', env);

    const result = runActivate(
      {
        hook_event_name: 'SessionStart',
        session_id: 'existing-session',
        source,
      },
      env,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /mode: review/);
    assert.equal(readSessionMode('existing-session', env), 'review');
  }
});

test('corrupt default config produces visible evidence and does not create session state', () => {
  const env = tempEnv();
  const configPath = path.join(env.XDG_CONFIG_HOME as string, 'codeartz-skills', 'agent-evolve', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{bad json', 'utf8');

  const result = runActivate(
    {
      hook_event_name: 'SessionStart',
      session_id: 'broken-default',
      source: 'startup',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.match(output.systemMessage, /Agent Evolve failed: session activation/);
  assert.match(output.hookSpecificOutput.additionalContext, /Invalid Agent Evolve default config/);
  assert.equal(fs.existsSync(sessionStatePath('broken-default', env)), false);
});

test('corrupt session state produces visible evidence instead of guessing the mode', () => {
  const env = tempEnv();
  const statePath = sessionStatePath('broken-session', env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ mode: 'collect', updatedAt: 'now' }), 'utf8');

  const result = runActivate(
    {
      hook_event_name: 'SessionStart',
      session_id: 'broken-session',
      source: 'resume',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /Agent Evolve failed/);
  assert.match(output.hookSpecificOutput.additionalContext, /Invalid Agent Evolve session state/);
});

test('unreadable session state path produces visible evidence instead of built-in fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-unreadable-session-'));
  const pluginData = path.join(root, 'plugin-data-as-file');
  fs.writeFileSync(pluginData, 'not a directory', 'utf8');
  const env = {
    PLUGIN_DATA: pluginData,
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };

  const result = runActivate(
    {
      hook_event_name: 'SessionStart',
      session_id: 'unreadable-session',
      source: 'startup',
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /Agent Evolve failed: session activation/);
  assert.match(output.hookSpecificOutput.additionalContext, /Unable to read Agent Evolve session state/);
});

test('missing skill fails visibly and never injects a partial rule set', () => {
  const env = tempEnv();
  const output = JSON.parse(
    handleSessionStart(
      {
        hook_event_name: 'SessionStart',
        session_id: 'missing-skill',
      },
      env,
      path.join(os.tmpdir(), 'agent-evolve-does-not-exist', 'SKILL.md'),
    ),
  );

  assert.match(output.systemMessage, /Agent Evolve failed: session activation/);
  assert.match(output.hookSpecificOutput.additionalContext, /Unable to read Agent Evolve skill/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /AGENT EVOLVE ACTIVE/);
});

test('non-SessionStart and invalid JSON inputs stay silent', () => {
  const env = tempEnv();
  const wrongEvent = runActivate(
    {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'normal request',
      session_id: 'session',
    },
    env,
  );
  const invalidJson = runActivate('{bad json', env);

  assert.equal(wrongEvent.stdout, '');
  assert.equal(invalidJson.stdout, '');
});

test('activation source never reads prompt or edits project files', () => {
  const source = fs.readFileSync(activateScript, 'utf8');
  assert.doesNotMatch(source, /input\.prompt/);
  assert.doesNotMatch(source, /writeFile|appendFile|renameSync|rmSync/);
});
```

- [ ] **步骤 2：运行激活测试，确认新 hook 尚不存在**

运行：

```bash
node --test tests/agent-evolve-activate.test.ts
```

预期：FAIL，错误为 `hooks/agent-evolve-activate.js` 的 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现 SessionStart 激活 hook**

创建 `hooks/agent-evolve-activate.js`：

```js
// @ts-check

import { fileURLToPath } from 'node:url';

import { getOrCreateSessionMode } from './agent-evolve-state.js';
import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  loadSkillBody,
  readStdinWithTimeout,
  writeStdoutSafely,
} from './agent-evolve-runtime.js';

/**
 * @typedef {import('./agent-evolve-runtime.js').HookInput} HookInput
 */

/**
 * @param {HookInput} input - SessionStart hook payload.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {string} [skillPath] - Skill path override for tests.
 * @returns {string} Serialized hook output or empty string.
 */
export function handleSessionStart(input, env = process.env, skillPath) {
  if (input.hook_event_name !== 'SessionStart') {
    return '';
  }

  try {
    const sessionId = String(input.session_id || '');
    const mode = getOrCreateSessionMode(sessionId, env);
    if (mode === 'off') {
      return '';
    }
    const skillBody = loadSkillBody(skillPath);
    return buildHookOutput({
      eventName: 'SessionStart',
      additionalContext: buildActivationContext(mode, skillBody),
    });
  } catch (error) {
    return buildFailureOutput('SessionStart', 'session activation', error);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Promise<void>} Resolves after stdin is processed.
 */
export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input) {
    return;
  }
  writeStdoutSafely(handleSessionStart(input, env));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
```

- [ ] **步骤 4：运行激活测试**

运行：

```bash
node --test tests/agent-evolve-activate.test.ts
```

预期：10 个测试通过，0 个失败。

- [ ] **步骤 5：运行类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS；`handleSessionStart` 使用任务 1 与任务 2 的精确接口。

- [ ] **步骤 6：提交激活 hook**

```bash
git add hooks/agent-evolve-activate.js tests/agent-evolve-activate.test.ts
git commit -m "feat(agent-evolve): inject skill on session start"
```

---

### Task 5：精确 Mode 控制 Hook

**文件：**

- 创建：`hooks/agent-evolve-mode.js`
- 创建：`tests/agent-evolve-mode.test.ts`

**接口：**

- 输入：`UserPromptSubmit` 的完整 `prompt` 与 `session_id`。
- 输出：`parseModeCommand(prompt)` 返回 `{ scope: 'session' | 'default', mode: Mode } | null`；`handleUserPromptSubmit(input, env, skillPath)` 返回 stdout 字符串。
- 命令合同：用完整字符串表匹配 `$agent-evolve`、`/agent-evolve`、`@agent-evolve` 下的 `safe`、`review`、`off` 与 `default <mode>`；不使用 feedback regex 或关键词分类。

- [ ] **步骤 1：编写精确 mode 命令测试**

创建 `tests/agent-evolve-mode.test.ts`：

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseModeCommand } from '../hooks/agent-evolve-mode.js';
import {
  getOrCreateSessionMode,
  readDefaultMode,
  readSessionMode,
  sessionStatePath,
  writeDefaultMode,
  writeSessionMode,
} from '../hooks/agent-evolve-state.js';

const modeScript = path.join(process.cwd(), 'hooks', 'agent-evolve-mode.js');

function tempEnv(): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-mode-'));
  return {
    PLUGIN_DATA: path.join(root, 'plugin-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };
}

function runMode(prompt: string, sessionId: string, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify({
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt,
      session_id: sessionId,
    }),
  });
}

test('parseModeCommand accepts only the six approved commands and host prefixes', () => {
  assert.deepEqual(parseModeCommand('$agent-evolve safe'), { scope: 'session', mode: 'safe' });
  assert.deepEqual(parseModeCommand('/agent-evolve review'), { scope: 'session', mode: 'review' });
  assert.deepEqual(parseModeCommand('@agent-evolve off'), { scope: 'session', mode: 'off' });
  assert.deepEqual(parseModeCommand('$agent-evolve default safe'), {
    scope: 'default',
    mode: 'safe',
  });
  assert.deepEqual(parseModeCommand('/agent-evolve default review'), {
    scope: 'default',
    mode: 'review',
  });
  assert.deepEqual(parseModeCommand('@agent-evolve default off'), {
    scope: 'default',
    mode: 'off',
  });
});

test('parseModeCommand rejects partial, extended, legacy, and case-changed prompts', () => {
  for (const prompt of [
    '$agent-evolve',
    '$agent-evolve safe now',
    'please use $agent-evolve safe',
    '$agent-evolve collect',
    '$agent-evolve on',
    '$agent-feedback-loop safe',
    '$Agent-Evolve safe',
    'safe',
    'feedback off',
  ]) {
    assert.equal(parseModeCommand(prompt), null, prompt);
  }
});

test('ordinary prompts stay silent and never touch state even when state paths are unusable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-mode-silent-'));
  const env = { XDG_CONFIG_HOME: path.join(root, 'config') };
  const prompts = [
    'review this code',
    'turn the feature off',
    'use the safe parser',
    'summarize the feedback',
    'please implement $agent-evolve safe behavior in the UI',
  ];

  for (const prompt of prompts) {
    const result = runMode(prompt, 'ordinary-session', env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', prompt);
  }
});

test('session safe and review commands update only the current session and reinject the skill', () => {
  for (const mode of ['safe', 'review'] as const) {
    const env = tempEnv();
    writeDefaultMode('off', env);
    writeSessionMode('current-session', 'off', env);

    const result = runMode(`$agent-evolve ${mode}`, 'current-session', env);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.systemMessage, `Agent Evolve mode: ${mode}; default: off`);
    assert.match(output.hookSpecificOutput.additionalContext, new RegExp(`^AGENT EVOLVE ACTIVE — mode: ${mode}`));
    assert.match(output.hookSpecificOutput.additionalContext, /# Agent Evolve/);
    assert.equal(readSessionMode('current-session', env), mode);
    assert.equal(readDefaultMode(env), 'off');
  }
});

test('session off command disables automatic behavior and preserves manual invocation', () => {
  const env = tempEnv();
  writeSessionMode('current-session', 'safe', env);

  const result = runMode('$agent-evolve off', 'current-session', env);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.systemMessage, 'Agent Evolve mode: off; default: safe');
  assert.match(output.hookSpecificOutput.additionalContext, /AGENT EVOLVE OFF/);
  assert.match(output.hookSpecificOutput.additionalContext, /Manual \$agent-evolve invocation remains available/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /# Agent Evolve/);
  assert.equal(readSessionMode('current-session', env), 'off');
});

test('default commands update only future sessions and keep current session pinned', () => {
  for (const mode of ['safe', 'review', 'off'] as const) {
    const env = tempEnv();
    writeDefaultMode('safe', env);
    writeSessionMode('current-session', 'review', env);

    const result = runMode(`$agent-evolve default ${mode}`, 'current-session', env);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.systemMessage, `Agent Evolve mode: review; default: ${mode}`);
    assert.match(output.hookSpecificOutput.additionalContext, /Current session mode remains: review/);
    assert.equal(readSessionMode('current-session', env), 'review');
    assert.equal(readDefaultMode(env), mode);
    assert.equal(getOrCreateSessionMode('future-session', env), mode);
  }
});

test('default command pins an unmaterialized current session before changing the default', () => {
  const env = tempEnv();
  writeDefaultMode('review', env);

  const result = runMode('$agent-evolve default off', 'first-prompt-session', env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readSessionMode('first-prompt-session', env), 'review');
  assert.equal(readDefaultMode(env), 'off');
});

test('different sessions keep independent modes after a command', () => {
  const env = tempEnv();
  writeSessionMode('session-a', 'safe', env);
  writeSessionMode('session-b', 'review', env);

  const result = runMode('$agent-evolve off', 'session-a', env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readSessionMode('session-a', env), 'off');
  assert.equal(readSessionMode('session-b', env), 'review');
});

test('corrupt default state produces visible evidence and does not change session mode', () => {
  const env = tempEnv();
  writeSessionMode('current-session', 'review', env);
  const configPath = path.join(env.XDG_CONFIG_HOME as string, 'codeartz-skills', 'agent-evolve', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{bad json', 'utf8');

  const result = runMode('$agent-evolve safe', 'current-session', env);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
  assert.match(output.hookSpecificOutput.additionalContext, /Invalid Agent Evolve default config/);
  assert.equal(readSessionMode('current-session', env), 'review');
});

test(
  'failed session-state write keeps the previous mode and never claims success',
  { skip: process.platform === 'win32' },
  () => {
    const env = tempEnv();
    writeSessionMode('current-session', 'safe', env);
    const statePath = sessionStatePath('current-session', env);
    fs.chmodSync(path.dirname(statePath), 0o500);

    const result = (() => {
      try {
        return runMode('$agent-evolve review', 'current-session', env);
      } finally {
        fs.chmodSync(path.dirname(statePath), 0o700);
      }
    })();

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
    assert.doesNotMatch(output.systemMessage, /mode: review; default/);
    assert.equal(readSessionMode('current-session', env), 'safe');
  },
);

test(
  'failed default-state write keeps the previous default and current session',
  { skip: process.platform === 'win32' },
  () => {
    const env = tempEnv();
    writeDefaultMode('safe', env);
    writeSessionMode('current-session', 'review', env);
    const configPath = path.join(env.XDG_CONFIG_HOME as string, 'codeartz-skills', 'agent-evolve', 'config.json');
    fs.chmodSync(path.dirname(configPath), 0o500);

    const result = (() => {
      try {
        return runMode('$agent-evolve default off', 'current-session', env);
      } finally {
        fs.chmodSync(path.dirname(configPath), 0o700);
      }
    })();

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
    assert.equal(readDefaultMode(env), 'safe');
    assert.equal(readSessionMode('current-session', env), 'review');
  },
);

test('non-UserPromptSubmit and invalid JSON inputs stay silent', () => {
  const env = tempEnv();
  const wrongEvent = spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      prompt: '$agent-evolve off',
      session_id: 'session',
    }),
  });
  const invalidJson = spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: '{bad json',
  });

  assert.equal(wrongEvent.stdout, '');
  assert.equal(invalidJson.stdout, '');
});
```

- [ ] **步骤 2：运行 mode 测试，确认新 hook 尚不存在**

运行：

```bash
node --test tests/agent-evolve-mode.test.ts
```

预期：FAIL，错误为 `hooks/agent-evolve-mode.js` 的 `ERR_MODULE_NOT_FOUND`。

- [ ] **步骤 3：实现精确命令表与 mode 更新**

创建 `hooks/agent-evolve-mode.js`：

```js
// @ts-check

import { fileURLToPath } from 'node:url';

import { getOrCreateSessionMode, readDefaultMode, writeDefaultMode, writeSessionMode } from './agent-evolve-state.js';
import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  buildOffContext,
  loadSkillBody,
  readStdinWithTimeout,
  writeStdoutSafely,
} from './agent-evolve-runtime.js';

/**
 * @typedef {import('./agent-evolve-state.js').Mode} Mode
 * @typedef {import('./agent-evolve-runtime.js').HookInput} HookInput
 * @typedef {{ scope: 'session' | 'default'; mode: Mode }} ModeCommand
 */

/** @type {readonly ['$agent-evolve', '/agent-evolve', '@agent-evolve']} */
const PREFIXES = ['$agent-evolve', '/agent-evolve', '@agent-evolve'];
/** @type {readonly Mode[]} */
const MODES = ['safe', 'review', 'off'];
/** @type {Map<string, ModeCommand>} */
const COMMANDS = new Map();

for (const prefix of PREFIXES) {
  for (const mode of MODES) {
    COMMANDS.set(`${prefix} ${mode}`, { scope: 'session', mode });
    COMMANDS.set(`${prefix} default ${mode}`, { scope: 'default', mode });
  }
}

/**
 * @param {unknown} prompt - Raw user prompt.
 * @returns {ModeCommand | null} Exact approved command or null.
 */
export function parseModeCommand(prompt) {
  return COMMANDS.get(String(prompt || '').trim()) || null;
}

/**
 * @param {Mode} currentMode - Effective current session mode.
 * @param {Mode} defaultMode - Persistent default mode.
 * @returns {string} Visible status line.
 */
function modeStatus(currentMode, defaultMode) {
  return `Agent Evolve mode: ${currentMode}; default: ${defaultMode}`;
}

/**
 * @param {Mode} mode - New current session mode.
 * @param {Mode} defaultMode - Persistent default mode.
 * @param {string | undefined} skillPath - Skill path override for tests.
 * @returns {string} Context applied after a current-session switch.
 */
function sessionSwitchContext(mode, defaultMode, skillPath) {
  const activeContext = mode === 'off' ? buildOffContext() : buildActivationContext(mode, loadSkillBody(skillPath));
  return [
    activeContext,
    '',
    'AGENT EVOLVE MODE STATUS',
    `Current session mode: ${mode}`,
    `Persistent default mode: ${defaultMode}`,
  ].join('\n');
}

/**
 * @param {Mode} currentMode - Unchanged current session mode.
 * @param {Mode} defaultMode - New persistent default mode.
 * @returns {string} Context applied after a default switch.
 */
function defaultSwitchContext(currentMode, defaultMode) {
  return [
    'AGENT EVOLVE DEFAULT UPDATED',
    `Current session mode remains: ${currentMode}`,
    `Persistent default mode: ${defaultMode}`,
    'The new default applies only to future sessions.',
  ].join('\n');
}

/**
 * @param {HookInput} input - UserPromptSubmit hook payload.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {string} [skillPath] - Skill path override for tests.
 * @returns {string} Serialized hook output or empty string.
 */
export function handleUserPromptSubmit(input, env = process.env, skillPath) {
  if (input.hook_event_name !== 'UserPromptSubmit') {
    return '';
  }

  const command = parseModeCommand(input.prompt);
  if (!command) {
    return '';
  }

  try {
    const sessionId = String(input.session_id || '');
    if (command.scope === 'session') {
      const defaultMode = readDefaultMode(env);
      const additionalContext = sessionSwitchContext(command.mode, defaultMode, skillPath);
      writeSessionMode(sessionId, command.mode, env);
      return buildHookOutput({
        eventName: 'UserPromptSubmit',
        additionalContext,
        systemMessage: modeStatus(command.mode, defaultMode),
      });
    }

    const currentMode = getOrCreateSessionMode(sessionId, env);
    writeDefaultMode(command.mode, env);
    return buildHookOutput({
      eventName: 'UserPromptSubmit',
      additionalContext: defaultSwitchContext(currentMode, command.mode),
      systemMessage: modeStatus(currentMode, command.mode),
    });
  } catch (error) {
    return buildFailureOutput('UserPromptSubmit', 'mode switch', error);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Promise<void>} Resolves after stdin is processed.
 */
export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input) {
    return;
  }
  writeStdoutSafely(handleUserPromptSubmit(input, env));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
```

- [ ] **步骤 4：运行 mode 测试**

运行：

```bash
node --test tests/agent-evolve-mode.test.ts
```

预期：12 个测试通过，0 个失败；只在 Windows 跳过两个权限写入失败测试。

- [ ] **步骤 5：运行类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS；命令 parser、mode 状态与 hook output 类型一致。

- [ ] **步骤 6：提交 mode hook**

```bash
git add hooks/agent-evolve-mode.js tests/agent-evolve-mode.test.ts
git commit -m "feat(agent-evolve): add exact mode controls"
```

---

### Task 6：Lifecycle Manifest 切换与旧 Runtime 删除

**文件：**

- 修改：`hooks/claude-codex-hooks.json`
- 创建：`tests/agent-evolve-plugin.test.ts`
- 删除：`hooks/agent-feedback-capture.js`
- 删除：`hooks/agent-feedback-stop.js`
- 删除：`hooks/agent-feedback-runtime.js`
- 删除：`hooks/agent-feedback-state.js`
- 删除：`tests/agent-feedback-capture.test.ts`
- 删除：`tests/agent-feedback-stop.test.ts`
- 删除：`tests/agent-feedback-state-runtime.test.ts`
- 删除：`tests/agent-feedback-plugin.test.ts`
- 删除：`tests/agent-feedback-skill.test.ts`
- 删除：`docs/superpowers/plans/2026-07-09-agent-feedback-loop.md`

**接口：**

- Manifest 只暴露两个 lifecycle：`SessionStart` → `agent-evolve-activate.js`；`UserPromptSubmit` → `agent-evolve-mode.js`。
- `SessionStart` matcher 精确为 `startup|resume|clear|compact`。
- `UserPromptSubmit` 不配置 matcher；普通 prompt 的静默由 mode hook 内部完整命令表保证。

- [ ] **步骤 1：编写新 plugin lifecycle 合同测试**

创建 `tests/agent-evolve-plugin.test.ts`：

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface PluginManifest {
  hooks?: string;
}

interface HookCommand {
  type?: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

interface HookConfig {
  hooks: Record<string, HookGroup[]>;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

test('Codex and Claude plugin manifests use the shared hook config', () => {
  const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');
  const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('shared hook config contains only SessionStart and UserPromptSubmit', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
});

test('manifest runs the activation and exact-mode scripts on Unix and Windows', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const sessionHook = config.hooks.SessionStart[0].hooks[0];
  const promptHook = config.hooks.UserPromptSubmit[0].hooks[0];

  assert.equal(sessionHook.type, 'command');
  assert.match(sessionHook.command ?? '', /agent-evolve-activate\.js/);
  assert.match(sessionHook.commandWindows ?? '', /agent-evolve-activate\.js/);
  assert.equal(sessionHook.timeout, 5);
  assert.equal(sessionHook.statusMessage, undefined);

  assert.equal(promptHook.type, 'command');
  assert.match(promptHook.command ?? '', /agent-evolve-mode\.js/);
  assert.match(promptHook.commandWindows ?? '', /agent-evolve-mode\.js/);
  assert.equal(promptHook.timeout, 5);
  assert.equal(promptHook.statusMessage, undefined);
});

test('new runtime ships four typed JSDoc hook files', () => {
  const files = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^\/\/ @ts-check\n/);
    assert.match(source, /@typedef/);
    assert.match(source, /@param/);
    assert.match(source, /@returns/);
  }
});

test('old feedback runtime, tests, skill, and plan are absent', () => {
  const legacyHook = ['agent', 'feedback'].join('-');
  const legacySkill = `${legacyHook}-loop`;
  const removed = [
    `hooks/${legacyHook}-capture.js`,
    `hooks/${legacyHook}-stop.js`,
    `hooks/${legacyHook}-runtime.js`,
    `hooks/${legacyHook}-state.js`,
    `skills/${legacySkill}`,
    `tests/${legacyHook}-capture.test.ts`,
    `tests/${legacyHook}-stop.test.ts`,
    `tests/${legacyHook}-state-runtime.test.ts`,
    `tests/${legacyHook}-plugin.test.ts`,
    `tests/${legacyHook}-skill.test.ts`,
    `docs/superpowers/plans/2026-07-09-${legacySkill}.md`,
  ];

  for (const filePath of removed) {
    assert.equal(fs.existsSync(filePath), false, filePath);
  }
});

test('hook source has no feedback classifier or event-state protocol', () => {
  const source = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
  ]
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /classifyPrompt|durable-feedback|pending|attempts|eventPath|stop_hook_active/);
  assert.equal(source.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(source.includes(['AGENT', 'FEEDBACK'].join('-')), false);
});
```

- [ ] **步骤 2：运行 plugin 测试，确认旧 manifest 与旧文件使测试失败**

运行：

```bash
node --test tests/agent-evolve-plugin.test.ts
```

预期：FAIL；至少包含 lifecycle key 不等于 `SessionStart,UserPromptSubmit`，以及旧 runtime 文件仍存在。

- [ ] **步骤 3：把共享 manifest 改为两个新 hook**

把 `hooks/claude-codex-hooks.json` 完整替换为：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "exec node \"${CLAUDE_PLUGIN_ROOT}/hooks/agent-evolve-activate.js\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\agent-evolve-activate.js\" }",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "exec node \"${CLAUDE_PLUGIN_ROOT}/hooks/agent-evolve-mode.js\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\agent-evolve-mode.js\" }",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **步骤 4：删除旧 runtime、测试与旧实施计划**

运行：

```bash
rm -f hooks/agent-feedback-capture.js hooks/agent-feedback-stop.js hooks/agent-feedback-runtime.js hooks/agent-feedback-state.js
rm -f tests/agent-feedback-capture.test.ts tests/agent-feedback-stop.test.ts tests/agent-feedback-state-runtime.test.ts tests/agent-feedback-plugin.test.ts tests/agent-feedback-skill.test.ts
rm -f docs/superpowers/plans/2026-07-09-agent-feedback-loop.md
```

预期：三个命令都返回 0；`rg --files hooks tests docs/superpowers/plans | rg 'agent-feedback'` 无输出并返回 1。

- [ ] **步骤 5：运行 plugin 合同测试**

运行：

```bash
node --test tests/agent-evolve-plugin.test.ts
```

预期：6 个测试通过，0 个失败。

- [ ] **步骤 6：运行全部新 Agent Evolve 测试与类型检查**

运行：

```bash
node --test 'tests/agent-evolve-*.test.ts'
npm run typecheck
```

预期：Agent Evolve 测试全部通过；typecheck 无诊断。

- [ ] **步骤 7：提交 lifecycle 切换**

```bash
git add hooks/claude-codex-hooks.json hooks/agent-evolve-*.js tests/agent-evolve-*.test.ts
git add -u hooks tests docs/superpowers/plans/2026-07-09-agent-feedback-loop.md
git commit -m "feat(agent-evolve): replace feedback lifecycle hooks"
```

---

### Task 7：README、Plugin Metadata、Asset 与当前环境旧数据

**文件：**

- 修改：`README.md`
- 修改：`.codex-plugin/plugin.json`
- 修改：`.claude-plugin/plugin.json`
- 修改：`.claude-plugin/marketplace.json`
- 修改：`.agents/plugins/marketplace.json`
- 修改：`tests/agent-evolve-plugin.test.ts`
- 重命名：`assets/readme-illustrations/03-agent-feedback-loop.png` → `assets/readme-illustrations/03-agent-evolve.png`
- 删除当前环境数据：`~/.codex/plugins/data/codeartz-skills-codeartz/agent-feedback-loop`
- 删除当前环境数据：`~/.claude/plugins/data/codeartz-skills-inline/agent-feedback-loop`
- 删除当前环境数据：`~/.claude/agent-feedback-loop`

**接口：**

- README 明确默认 `safe`、三种 mode、六条控制命令、hook trust 步骤与 standalone skill 的手动调用边界。
- Plugin metadata 使用 Agent Evolve 新名称与新行为，不声明旧 alias 或迁移。
- 旧 plugin data 只在当前机器删除一次；不向 runtime 添加 cleanup API。

- [ ] **步骤 1：扩展 plugin 测试，先约束文档、metadata 与 asset**

在 `tests/agent-evolve-plugin.test.ts` 末尾追加：

```ts
test('README documents Agent Evolve modes, lifecycle hooks, and commands', () => {
  const readme = fs.readFileSync('README.md', 'utf8');

  assert.match(readme, /Agent Evolve/);
  assert.match(readme, /默认 mode 是 `safe`/);
  assert.match(readme, /\| `safe`/);
  assert.match(readme, /\| `review`/);
  assert.match(readme, /\| `off`/);
  assert.match(readme, /\$agent-evolve default off/);
  assert.match(readme, /SessionStart/);
  assert.match(readme, /UserPromptSubmit/);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
});

test('plugin metadata and README contain no legacy product identifier', () => {
  const legacySkill = ['agent', 'feedback', 'loop'].join('-');
  const legacyHook = ['agent', 'feedback'].join('-');
  const files = [
    'README.md',
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    'hooks/claude-codex-hooks.json',
  ];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content.includes(legacySkill), false, filePath);
    assert.equal(content.includes(legacyHook), false, filePath);
  }
});

test('README references only the renamed Agent Evolve illustration', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const newAsset = 'assets/readme-illustrations/03-agent-evolve.png';
  const legacyAsset = ['assets/readme-illustrations/03-agent', 'feedback', 'loop.png'].join('-');

  assert.equal(fs.existsSync(newAsset), true);
  assert.equal(fs.existsSync(legacyAsset), false);
  assert.match(readme, /03-agent-evolve\.png/);
});
```

- [ ] **步骤 2：运行 plugin 测试，确认旧 README 与 asset 使新增断言失败**

运行：

```bash
node --test tests/agent-evolve-plugin.test.ts
```

预期：FAIL；README 缺少 `Agent Evolve`/mode 命令，且新 asset 不存在。

- [ ] **步骤 3：用新产品说明完整替换 README**

把 `README.md` 完整替换为：

````markdown
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
````

- [ ] **步骤 4：重命名仍适用的正文配图**

运行：

```bash
mv assets/readme-illustrations/03-agent-feedback-loop.png assets/readme-illustrations/03-agent-evolve.png
```

预期：新文件存在，旧文件不存在；图片中的“反馈、原则、查重、隐私、合并、长期规则源”仍与新行为一致。

- [ ] **步骤 5：更新 Codex plugin metadata**

把 `.codex-plugin/plugin.json` 完整替换为：

```json
{
  "name": "codeartz-skills",
  "version": "0.1.0",
  "description": "面向 Codex agent 工作流的 Codeartz 技能集，支持边界分析、指令审查与 Agent Evolve feedback 沉淀。",
  "author": {
    "name": "Codeartz",
    "url": "https://github.com/hanjeahwan"
  },
  "homepage": "https://github.com/hanjeahwan/codeartz-skills",
  "repository": "https://github.com/hanjeahwan/codeartz-skills",
  "license": "MIT",
  "keywords": ["codex", "skills", "agent-workflow", "agent-evolve", "技术方案"],
  "skills": "./skills/",
  "hooks": "./hooks/claude-codex-hooks.json",
  "interface": {
    "displayName": "Codeartz 技能集",
    "shortDescription": "边界分析、指令审查与 Agent Evolve。",
    "longDescription": "帮助 agent 把复杂需求收敛为可评审工程产物，并把直接 human feedback 安全合并到未来 agent 会读取的项目规则源。",
    "developerName": "Codeartz",
    "category": "Productivity",
    "capabilities": ["Instructions", "Planning", "Review", "Lifecycle hooks"],
    "websiteURL": "https://github.com/hanjeahwan/codeartz-skills",
    "defaultPrompt": [
      "分析这组需求和代码上下文的边界。",
      "把这些资料整理成可评审的技术方案。",
      "为这个方案生成上下文交接文件。",
      "用 Agent Evolve 判断这条 human feedback 是否应沉淀。"
    ],
    "brandColor": "#A11D5F",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png"
  }
}
```

- [ ] **步骤 6：更新 Claude Code plugin metadata**

把 `.claude-plugin/plugin.json` 完整替换为：

```json
{
  "name": "codeartz-skills",
  "version": "0.1.0",
  "description": "面向 Claude Code 与 Codex 的工程 workflow 技能集，支持边界分析、指令审查与 Agent Evolve。",
  "author": {
    "name": "Codeartz",
    "url": "https://github.com/hanjeahwan"
  },
  "homepage": "https://github.com/hanjeahwan/codeartz-skills",
  "repository": "https://github.com/hanjeahwan/codeartz-skills",
  "license": "MIT",
  "keywords": ["claude-code", "codex", "skills", "agent-workflow", "agent-evolve"],
  "hooks": "./hooks/claude-codex-hooks.json"
}
```

把 `.claude-plugin/marketplace.json` 完整替换为：

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "codeartz",
  "description": "面向严肃 agent 工作流的 Codeartz 技能集。",
  "owner": {
    "name": "Codeartz",
    "url": "https://github.com/hanjeahwan"
  },
  "plugins": [
    {
      "name": "codeartz-skills",
      "description": "边界分析、指令审查，以及用 Agent Evolve 把 human feedback 安全沉淀到项目规则。",
      "source": "./",
      "category": "productivity"
    }
  ]
}
```

把 `.agents/plugins/marketplace.json` 完整替换为：

```json
{
  "name": "codeartz",
  "interface": {
    "displayName": "Codeartz 技能集"
  },
  "plugins": [
    {
      "name": "codeartz-skills",
      "description": "边界分析、指令审查与 Agent Evolve feedback 沉淀。",
      "source": {
        "source": "url",
        "url": "https://github.com/hanjeahwan/codeartz-skills.git",
        "ref": "main"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

- [ ] **步骤 7：运行 plugin 文档与 metadata 测试**

运行：

```bash
node --test tests/agent-evolve-plugin.test.ts
```

预期：9 个测试通过，0 个失败。

- [ ] **步骤 8：一次性删除当前机器的旧 plugin data**

运行：

```bash
rm -rf "$HOME/.codex/plugins/data/codeartz-skills-codeartz/agent-feedback-loop"
rm -rf "$HOME/.claude/plugins/data/codeartz-skills-inline/agent-feedback-loop"
rm -rf "$HOME/.claude/agent-feedback-loop"
```

预期：三个命令都返回 0；以下命令无输出并返回 1：

```bash
find "$HOME/.codex/plugins/data" "$HOME/.claude/plugins/data" "$HOME/.claude" -type d -path '*/agent-feedback-loop' -print 2>/dev/null
```

- [ ] **步骤 9：提交文档、metadata 与 asset**

```bash
git add README.md .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json .agents/plugins/marketplace.json tests/agent-evolve-plugin.test.ts assets/readme-illustrations/03-agent-evolve.png
git add -u assets/readme-illustrations/03-agent-feedback-loop.png
git commit -m "docs(agent-evolve): publish modes and lifecycle"
```

---

### Task 8：真实用户路径与最终仓库验证

**文件：**

- 验证：`hooks/agent-evolve-*.js`
- 验证：`skills/agent-evolve/**`
- 验证：`tests/agent-evolve-*.test.ts`
- 验证：`hooks/claude-codex-hooks.json`
- 验证：`README.md` 与 plugin metadata
- 不创建新的产品文件。

**接口：**

- 真实 dogfood 使用 Claude Code 的 `--plugin-dir` 加载当前 checkout，不依赖已发布缓存。
- 自动化 gate 使用仓库已有 `npm test`、`typecheck`、`format:all` 与 `lint`。
- 用户路径必须证明：无触发词 feedback 进入安全判断、规则落入未来读取路径、后续 session 受益、off 停止自动处理、default 只影响新 session。

- [ ] **步骤 1：记录实施后的预期变更范围**

运行：

```bash
git status --short
git log --oneline -8
```

预期：Agent Evolve 文件已经由前七个任务分别提交；`git status --short` 无输出，或只显示开始实施前已经记录的无关用户改动。

- [ ] **步骤 2：创建独立 dogfood 项目**

运行：

```bash
REPO_ROOT="$(pwd)"
DOGFOOD_ROOT="$(mktemp -d -t agent-evolve-dogfood.XXXXXX)"
mkdir -p "$DOGFOOD_ROOT/src" "$DOGFOOD_ROOT/tests"
git -C "$DOGFOOD_ROOT" init -q
printf '%s\n' '# Project Instructions' '' '## Architecture Rules' '' '- Keep stable project-wide architecture rules in this section.' > "$DOGFOOD_ROOT/CLAUDE.md"
printf '%s\n' '{"name":"agent-evolve-dogfood","private":true,"type":"module","scripts":{"test":"node --test"}}' > "$DOGFOOD_ROOT/package.json"
printf '%s\n' 'export function parsePayload(input) {' '  return JSON.parse(input);' '}' > "$DOGFOOD_ROOT/src/errors.js"
printf '%s\n' "import assert from 'node:assert/strict';" "import test from 'node:test';" "import { parsePayload } from '../src/errors.js';" '' "test('returns parsed input', () => {" "  assert.deepEqual(parsePayload('{\"ok\":true}'), { ok: true });" '});' > "$DOGFOOD_ROOT/tests/errors.test.js"
git -C "$DOGFOOD_ROOT" add .
git -C "$DOGFOOD_ROOT" commit -qm "test: seed dogfood project"
printf '%s\n' "$REPO_ROOT" "$DOGFOOD_ROOT"
```

预期：输出当前 CodeartzSkills 根目录与一个新的 `/tmp/.../agent-evolve-dogfood.*` 目录；fixture 初始 `npm test` 通过。

- [ ] **步骤 3：启动 safe session，并在第二轮给出不含触发词的项目级 feedback**

运行：

```bash
DOGFOOD_SESSION="$(uuidgen | tr '[:upper:]' '[:lower:]')"
claude --plugin-dir "$REPO_ROOT" --session-id "$DOGFOOD_SESSION" --permission-mode acceptEdits -p "运行 npm test，说明 src/errors.js 的当前错误行为，不要修改文件。" > "$DOGFOOD_ROOT/session-1.txt"
claude --plugin-dir "$REPO_ROOT" --resume "$DOGFOOD_SESSION" --permission-mode acceptEdits -p "这个项目的底层解析函数不能直接抛异常，必须返回带 ok 字段的结构化结果，让调用者决定如何处理；请修正 src/errors.js 和测试。" > "$DOGFOOD_ROOT/feedback.txt"
```

预期：第二条 human 消息不含“以后”“记住”“不要再”或“写进规则”；agent 完成代码/测试任务，同时把抽象后的项目级错误边界写入 `CLAUDE.md`。

- [ ] **步骤 4：验证 safe 更新回执、规则落点与当前任务结果**

运行：

```bash
rg -n "Feedback decision: Updated" "$DOGFOOD_ROOT/feedback.txt"
rg -n "Why:" "$DOGFOOD_ROOT/feedback.txt"
rg -n "Evidence:" "$DOGFOOD_ROOT/feedback.txt"
rg -n "Target: .*CLAUDE.md" "$DOGFOOD_ROOT/feedback.txt"
rg -n "底层解析|结构化结果|调用者" "$DOGFOOD_ROOT/CLAUDE.md"
npm --prefix "$DOGFOOD_ROOT" test
git -C "$DOGFOOD_ROOT" diff -- CLAUDE.md src/errors.js tests/errors.test.js
```

预期：四个回执查询都有命中；`CLAUDE.md` 的 `Architecture Rules` 出现一条抽象规则；测试通过；diff 同时包含当前代码修正与唯一规则源更新。

- [ ] **步骤 5：用后续新 session 验证规则可读取**

运行：

```bash
FUTURE_SESSION="$(uuidgen | tr '[:upper:]' '[:lower:]')"
claude --plugin-dir "$REPO_ROOT" --session-id "$FUTURE_SESSION" -p "根据项目规则，只回答：底层解析函数应该怎样返回错误，以及由谁决定如何处理？" > "$DOGFOOD_ROOT/future-session.txt"
rg -n "结构化|ok|调用者" "$DOGFOOD_ROOT/future-session.txt"
```

预期：新 session 的回答同时说明结构化结果与调用者决策；证据来自自动加载的 `CLAUDE.md`，不依赖前一个 session transcript。

- [ ] **步骤 6：切换当前 session 到 off，并验证不再自动沉淀**

运行：

```bash
claude --plugin-dir "$REPO_ROOT" --resume "$DOGFOOD_SESSION" -p '$agent-evolve off' > "$DOGFOOD_ROOT/off-command.txt"
RULE_HASH_BEFORE="$(shasum -a 256 "$DOGFOOD_ROOT/CLAUDE.md" | awk '{print $1}')"
claude --plugin-dir "$REPO_ROOT" --resume "$DOGFOOD_SESSION" --permission-mode acceptEdits -p "这个项目所有测试名都必须以动词开头；请把当前测试名改成动词短语。" > "$DOGFOOD_ROOT/off-feedback.txt"
RULE_HASH_AFTER="$(shasum -a 256 "$DOGFOOD_ROOT/CLAUDE.md" | awk '{print $1}')"
test "$RULE_HASH_BEFORE" = "$RULE_HASH_AFTER"
if rg -n "Feedback decision:" "$DOGFOOD_ROOT/off-feedback.txt"; then exit 1; fi
```

预期：`$agent-evolve off` 后代码任务仍可完成；`CLAUDE.md` hash 不变；off 轮次没有自动 feedback 回执。

- [ ] **步骤 7：验证 default mode 只影响后续新 session**

运行：

```bash
claude --plugin-dir "$REPO_ROOT" --resume "$DOGFOOD_SESSION" -p '$agent-evolve default review' > "$DOGFOOD_ROOT/default-review.txt"
rg -n "current.*off|当前.*off" "$DOGFOOD_ROOT/default-review.txt"
rg -n "default.*review|默认.*review" "$DOGFOOD_ROOT/default-review.txt"
REVIEW_SESSION="$(uuidgen | tr '[:upper:]' '[:lower:]')"
claude --plugin-dir "$REPO_ROOT" --session-id "$REVIEW_SESSION" -p "只回答当前注入的 Agent Evolve mode。" > "$DOGFOOD_ROOT/review-session.txt"
rg -n "review" "$DOGFOOD_ROOT/review-session.txt"
```

预期：原 session 仍为 `off`，持久默认值变为 `review`；新 session 回答 `review`。

- [ ] **步骤 8：用直接 hook smoke test 验证并发 session 隔离**

运行：

```bash
SMOKE_ROOT="$(mktemp -d -t agent-evolve-smoke.XXXXXX)"
SMOKE_ENV="PLUGIN_DATA=$SMOKE_ROOT/plugin-data XDG_CONFIG_HOME=$SMOKE_ROOT/config"
env $SMOKE_ENV node hooks/agent-evolve-mode.js <<'JSON' > "$SMOKE_ROOT/a.txt"
{"hook_event_name":"UserPromptSubmit","session_id":"parallel-a","prompt":"$agent-evolve off"}
JSON
env $SMOKE_ENV node hooks/agent-evolve-mode.js <<'JSON' > "$SMOKE_ROOT/b.txt"
{"hook_event_name":"UserPromptSubmit","session_id":"parallel-b","prompt":"$agent-evolve review"}
JSON
env $SMOKE_ENV node hooks/agent-evolve-activate.js <<'JSON' > "$SMOKE_ROOT/a-start.txt"
{"hook_event_name":"SessionStart","session_id":"parallel-a","source":"resume","cwd":"/tmp/project"}
JSON
env $SMOKE_ENV node hooks/agent-evolve-activate.js <<'JSON' > "$SMOKE_ROOT/b-start.txt"
{"hook_event_name":"SessionStart","session_id":"parallel-b","source":"resume","cwd":"/tmp/project"}
JSON
test ! -s "$SMOKE_ROOT/a-start.txt"
rg -n "AGENT EVOLVE ACTIVE — mode: review" "$SMOKE_ROOT/b-start.txt"
find "$SMOKE_ROOT/plugin-data/agent-evolve/sessions" -type f -name '*.json' | wc -l | tr -d ' '
```

预期：session A 的 `SessionStart` 静默，session B 注入 `review`，最后输出 `2` 个独立 session 文件。

- [ ] **步骤 9：运行 formatter 与全部自动化 gate**

运行：

```bash
npm run format:all
npm test
npm run typecheck
npm run lint
git diff --check
```

预期：formatter 成功；全部测试通过；typecheck 与 lint 无诊断；`git diff --check` 无输出。

- [ ] **步骤 10：提交 formatter 产生的机械变化**

运行：

```bash
git add hooks/agent-evolve-*.js hooks/claude-codex-hooks.json skills/agent-evolve tests/agent-evolve-*.test.ts README.md .codex-plugin .claude-plugin .agents/plugins assets/readme-illustrations/03-agent-evolve.png
if ! git diff --cached --quiet; then git commit -m "chore(agent-evolve): format implementation"; fi
```

预期：有 formatter diff 时生成一个机械提交；没有 diff 时不生成空提交。

- [ ] **步骤 11：验证仓库中没有旧产品入口或行为协议**

运行：

```bash
if rg -n "agent-feedback-loop|agent-feedback" hooks skills tests README.md .codex-plugin .claude-plugin .agents assets; then exit 1; fi
if rg -n '"Stop"|"SubagentStart"|"SubagentStop"|"SessionEnd"' hooks/claude-codex-hooks.json; then exit 1; fi
if rg -n "classifyPrompt|durable-feedback|eventPath|stop_hook_active|attempts" hooks/agent-evolve-*.js; then exit 1; fi
rg -n "agent-feedback-loop|agent-feedback" docs/superpowers/specs/2026-07-10-agent-evolve-design.md
```

预期：前三条检查无命中；最后一条只在已批准设计规范的删除/历史说明中命中。

- [ ] **步骤 12：验证最终 diff 范围与提交历史**

运行：

```bash
git status --short
git log --oneline --decorate -10
BASE_COMMIT="$(git merge-base origin/main HEAD)"
git diff "$BASE_COMMIT"..HEAD --stat
```

预期：工作区无 Agent Evolve 未提交改动；若实施前存在无关用户改动，它们仍原样保留；最近提交按任务展示 state、runtime、skill、activation、mode、lifecycle、docs 与可选 formatter 切片。
