# Agent Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex + Claude Code plugin skill that turns user feedback into durable project rule updates by capturing feedback hooks, resolving existing rule sources, checking duplicates and conflicts, and updating or proposing changes.

**Architecture:** The shared command-hook layer captures high-confidence feedback and keeps a pending event in runtime-local state. The `agent-feedback-loop` skill owns all judgment: durable principle extraction, known-source-first discovery, grep fallback, duplicate/conflict checks, edit/proposal decisions, and verification. Plugin manifests expose the same hooks to Codex and Claude Code, following Ponytail's shared-hook adapter pattern.

**Tech Stack:** Node.js ESM scripts with built-in `node:test`, no runtime dependencies, Codex/Claude command hooks, Markdown skill manuals, existing `oxfmt` and `oxlint` repository tooling.

## Global Constraints

- Hook scripts must use command hooks only, because command handlers are the Codex + Claude Code shared subset.
- Hooks must not edit long-term rule sources directly; hooks may only write pending event state and inject additional context.
- The skill must prefer known long-term rule sources, then current context, then grep-based project evidence discovery.
- The implementation must not create a persistent `rule-sources.json` or any separate ownership registry.
- The skill must not assume `SKILL.md` is the target rule source; `skills/**` is only a candidate when the project itself contains skills.
- Rule updates must check duplicates and conflicts before writing.
- Sensitive incident details, customer names, credentials, private URLs, and long logs must not be stored in durable rules.
- The same `hooks/claude-codex-hooks.json` file must be referenced by `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`.
- Node scripts must stay dependency-free and work under this repository's `"type": "module"`.

---

## File Structure

- Create `hooks/agent-feedback-runtime.js`: detect Codex vs Claude Code and build runtime-specific hook stdout JSON.
- Create `hooks/agent-feedback-state.js`: store, read, sanitize, list, and mark feedback event state.
- Create `hooks/agent-feedback-capture.js`: parse `UserPromptSubmit` JSON, detect feedback signals, persist pending events, and inject context.
- Create `hooks/agent-feedback-stop.js`: parse `Stop` JSON, keep the agent working on unprocessed pending feedback, and prevent hook loops.
- Create `hooks/claude-codex-hooks.json`: shared hook config for Codex and Claude Code.
- Create `tests/agent-feedback-state-runtime.test.js`: unit tests for runtime output and state helpers.
- Create `tests/agent-feedback-capture.test.js`: unit tests for capture classification and CLI behavior.
- Create `tests/agent-feedback-stop.test.js`: unit tests for Stop continuation and loop limits.
- Create `tests/agent-feedback-plugin.test.js`: manifest and hook wiring tests.
- Create `skills/agent-feedback-loop/SKILL.md`: trigger, route, global boundaries, and reference loading.
- Create `skills/agent-feedback-loop/references/workflow.md`: execution workflow and output modes.
- Create `skills/agent-feedback-loop/references/source-discovery.md`: known-source-first discovery, grep fallback, duplicate and conflict rules.
- Create `skills/agent-feedback-loop/references/validation.md`: edit gates, privacy gates, status marking, and output contracts.
- Modify `package.json`: make `npm test` run the new Node test suite.
- Modify `.codex-plugin/plugin.json`: add shared hooks and include Lifecycle hooks in capabilities.
- Modify `.claude-plugin/plugin.json`: add shared hooks.
- Modify `README.md`: document the new skill and hook trust/setup steps.

---

### Task 1: Runtime Adapter And State Store

**Files:**

- Create: `hooks/agent-feedback-runtime.js`
- Create: `hooks/agent-feedback-state.js`
- Create: `tests/agent-feedback-state-runtime.test.js`
- Modify: `package.json`

**Interfaces:**

- Produces: `detectRuntime(env: Record<string, string | undefined>): "codex" | "claude" | "unknown"`
- Produces: `buildHookOutput(options: { eventName: string; additionalContext?: string; systemMessage?: string; env?: Record<string, string | undefined> }): string`
- Produces: `sanitizeExcerpt(text: string, maxLength?: number): string`
- Produces: `createEvent(input: HookInput, signal: string, prompt: string, env?: NodeJS.ProcessEnv): FeedbackEvent`
- Produces: `writeEvent(event: FeedbackEvent): FeedbackEvent`
- Produces: `readEvent(eventPath: string): FeedbackEvent | null`
- Produces: `findPendingEvent(input: HookInput, env?: NodeJS.ProcessEnv): FeedbackEvent | null`
- Produces: `markEventStatus(eventPath: string, status: FeedbackStatus): FeedbackEvent`
- Produces: `incrementAttempts(eventPath: string): FeedbackEvent`
- Produces CLI: `node hooks/agent-feedback-state.js mark <eventPath> <status>`
- Consumes: no earlier project code.

- [ ] **Step 1: Write the failing runtime and state tests**

Create `tests/agent-feedback-state-runtime.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHookOutput, detectRuntime } from '../hooks/agent-feedback-runtime.js';
import {
  createEvent,
  findPendingEvent,
  incrementAttempts,
  markEventStatus,
  readEvent,
  sanitizeExcerpt,
  writeEvent,
} from '../hooks/agent-feedback-state.js';

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-state-'));
  return { dir, env: { AGENT_FEEDBACK_STATE_DIR: dir } };
}

test('detectRuntime identifies Codex, Claude Code, and unknown hosts', () => {
  assert.equal(detectRuntime({ PLUGIN_DATA: '/tmp/codex' }), 'codex');
  assert.equal(detectRuntime({ CLAUDE_PLUGIN_ROOT: '/tmp/plugin' }), 'claude');
  assert.equal(detectRuntime({ CLAUDE_CONFIG_DIR: '/tmp/claude' }), 'claude');
  assert.equal(detectRuntime({}), 'unknown');
});

test('buildHookOutput emits Codex systemMessage plus hookSpecificOutput', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'UserPromptSubmit',
      additionalContext: 'Pending feedback event: /tmp/event.json',
      systemMessage: 'AGENT-FEEDBACK:PENDING',
      env: { PLUGIN_DATA: '/tmp/codex' },
    }),
  );

  assert.equal(output.systemMessage, 'AGENT-FEEDBACK:PENDING');
  assert.deepEqual(output.hookSpecificOutput, {
    hookEventName: 'UserPromptSubmit',
    additionalContext: 'Pending feedback event: /tmp/event.json',
  });
});

test('buildHookOutput emits Claude-compatible hookSpecificOutput without Codex badge', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'Stop',
      additionalContext: 'Process pending feedback before stopping.',
      systemMessage: 'AGENT-FEEDBACK:PENDING',
      env: { CLAUDE_PLUGIN_ROOT: '/tmp/plugin' },
    }),
  );

  assert.equal(output.systemMessage, undefined);
  assert.deepEqual(output.hookSpecificOutput, {
    hookEventName: 'Stop',
    additionalContext: 'Process pending feedback before stopping.',
  });
});

test('sanitizeExcerpt redacts secrets, emails, private URLs, and long content', () => {
  const excerpt = sanitizeExcerpt(
    '以后记住: token sk-test1234567890abcdef should not appear. Email me at user@example.com. See https://internal.example.test/path',
    120,
  );

  assert.match(excerpt, /以后记住/);
  assert.doesNotMatch(excerpt, /sk-test/);
  assert.doesNotMatch(excerpt, /user@example.com/);
  assert.doesNotMatch(excerpt, /internal\.example/);
  assert.ok(excerpt.length <= 120);
});

test('createEvent and writeEvent store pending event under runtime state directory', () => {
  const { env, dir } = tempEnv();
  const event = createEvent(
    {
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt_id: 'prompt-1',
      session_id: 'session-1',
    },
    'durable-feedback',
    '以后不要把未授权范围写成风险',
    env,
  );

  assert.equal(event.status, 'pending');
  assert.equal(event.attempts, 0);
  assert.equal(event.cwd, '/repo/project');
  assert.match(event.eventPath, new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  writeEvent(event);
  const stored = readEvent(event.eventPath);

  assert.equal(stored.id, event.id);
  assert.equal(stored.excerpt, '以后不要把未授权范围写成风险');
});

test('findPendingEvent returns newest pending event for same cwd and session', () => {
  const { env } = tempEnv();
  const baseInput = {
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    prompt_id: 'prompt-1',
    session_id: 'session-1',
  };
  const event = writeEvent(createEvent(baseInput, 'durable-feedback', '下次应该先查已有规范', env));

  const found = findPendingEvent(
    {
      cwd: '/repo/project',
      hook_event_name: 'Stop',
      session_id: 'session-1',
    },
    env,
  );

  assert.equal(found.id, event.id);
});

test('markEventStatus and incrementAttempts update existing event files', () => {
  const { env } = tempEnv();
  const event = writeEvent(
    createEvent(
      {
        cwd: '/repo/project',
        hook_event_name: 'UserPromptSubmit',
        prompt_id: 'prompt-1',
        session_id: 'session-1',
      },
      'durable-feedback',
      '写进规则',
      env,
    ),
  );

  const attempted = incrementAttempts(event.eventPath);
  assert.equal(attempted.attempts, 1);

  const marked = markEventStatus(event.eventPath, 'updated');
  assert.equal(marked.status, 'updated');
  assert.equal(readEvent(event.eventPath).status, 'updated');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/agent-feedback-state-runtime.test.js
```

Expected: FAIL with module resolution errors for `hooks/agent-feedback-runtime.js` and `hooks/agent-feedback-state.js`.

- [ ] **Step 3: Implement the runtime adapter**

Create `hooks/agent-feedback-runtime.js`:

```js
export function detectRuntime(env = process.env) {
  if (env.PLUGIN_DATA) return 'codex';
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_CONFIG_DIR) return 'claude';
  return 'unknown';
}

export function buildHookOutput({ eventName, additionalContext = '', systemMessage = '', env = process.env }) {
  const runtime = detectRuntime(env);
  const output = {};

  if (runtime === 'codex' && systemMessage) {
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

export function writeStdoutSafely(text) {
  if (!text) return;
  try {
    process.stdout.write(text);
  } catch {
    // Hook stdout can close during process shutdown; keep hooks best-effort.
  }
}
```

- [ ] **Step 4: Implement the state store**

Create `hooks/agent-feedback-state.js`:

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_STATUSES = new Set(['pending', 'processing', 'updated', 'proposed', 'no-durable-update', 'blocked']);

function stateRoot(env = process.env) {
  if (env.AGENT_FEEDBACK_STATE_DIR) return env.AGENT_FEEDBACK_STATE_DIR;
  if (env.PLUGIN_DATA) return path.join(env.PLUGIN_DATA, 'agent-feedback-loop');
  if (env.CLAUDE_CONFIG_DIR) return path.join(env.CLAUDE_CONFIG_DIR, 'agent-feedback-loop');
  return path.join(os.homedir(), '.claude', 'agent-feedback-loop');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function safeSegment(value) {
  return (
    String(value || 'unknown')
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .slice(0, 80) || 'unknown'
  );
}

function eventsDir(env = process.env) {
  return path.join(stateRoot(env), 'events');
}

function nowIso() {
  return new Date().toISOString();
}

export function sanitizeExcerpt(text, maxLength = 500) {
  let sanitized = String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted-secret]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    .replace(/https?:\/\/[^\s)]+/g, '[redacted-url]')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, Math.max(0, maxLength - 16)).trimEnd()} ...[truncated]`;
  }

  return sanitized;
}

export function createEvent(input, signal, prompt, env = process.env) {
  const sessionId = String(input.session_id || 'unknown-session');
  const promptId = String(input.prompt_id || hash(prompt || nowIso()));
  const cwd = String(input.cwd || process.cwd());
  const id = `${safeSegment(sessionId)}-${safeSegment(promptId)}-${hash(cwd)}`;
  const eventPath = path.join(eventsDir(env), `${id}.json`);

  return {
    id,
    cwd,
    eventPath,
    excerpt: sanitizeExcerpt(prompt),
    promptId,
    sessionId,
    signal,
    status: 'pending',
    attempts: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function writeEvent(event) {
  fs.mkdirSync(path.dirname(event.eventPath), { recursive: true });
  fs.writeFileSync(event.eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return event;
}

export function readEvent(eventPath) {
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function listEvents(env = process.env) {
  const dir = eventsDir(env);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readEvent(path.join(dir, name)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function findPendingEvent(input, env = process.env) {
  const cwd = String(input.cwd || process.cwd());
  const sessionId = String(input.session_id || 'unknown-session');
  return (
    listEvents(env)
      .filter((event) => event.status === 'pending')
      .filter((event) => event.cwd === cwd)
      .filter((event) => event.sessionId === sessionId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null
  );
}

export function markEventStatus(eventPath, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid feedback event status: ${status}`);
  }

  const event = readEvent(eventPath);
  if (!event) throw new Error(`Feedback event not found: ${eventPath}`);

  event.status = status;
  event.updatedAt = nowIso();
  return writeEvent(event);
}

export function incrementAttempts(eventPath) {
  const event = readEvent(eventPath);
  if (!event) throw new Error(`Feedback event not found: ${eventPath}`);

  event.attempts = Number(event.attempts || 0) + 1;
  event.updatedAt = nowIso();
  return writeEvent(event);
}

function printUsage() {
  process.stderr.write(
    'Usage: node hooks/agent-feedback-state.js mark <eventPath> <pending|processing|updated|proposed|no-durable-update|blocked>\n',
  );
}

function runCli(argv) {
  const [, , command, eventPath, status] = argv;
  if (command !== 'mark' || !eventPath || !status) {
    printUsage();
    return 2;
  }

  const event = markEventStatus(eventPath, status);
  process.stdout.write(`${JSON.stringify({ eventPath: event.eventPath, status: event.status })}\n`);
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: Update the test script**

Modify `package.json`:

```json
{
  "scripts": {
    "bump": "node scripts/bump-version.ts",
    "format": "oxfmt",
    "format:all": "oxfmt .",
    "lint": "oxlint",
    "lint:all": "oxlint . --fix",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "node --test 'tests/**/*.test.js'"
  }
}
```

- [ ] **Step 6: Run the task tests**

Run:

```bash
node --test tests/agent-feedback-state-runtime.test.js
npm test
```

Expected: PASS for `tests/agent-feedback-state-runtime.test.js`. `npm test` should run the same test file and pass.

- [ ] **Step 7: Commit**

```bash
git add package.json hooks/agent-feedback-runtime.js hooks/agent-feedback-state.js tests/agent-feedback-state-runtime.test.js
git commit -m "feat: add agent feedback hook state runtime"
```

---

### Task 2: UserPromptSubmit Capture Hook

**Files:**

- Create: `hooks/agent-feedback-capture.js`
- Create: `tests/agent-feedback-capture.test.js`
- Modify: `hooks/agent-feedback-state.js`

**Interfaces:**

- Consumes: `buildHookOutput(...)` from `hooks/agent-feedback-runtime.js`
- Consumes: `createEvent(...)` and `writeEvent(...)` from `hooks/agent-feedback-state.js`
- Produces: `classifyPrompt(prompt: string): null | { signal: "durable-feedback"; reason: string }`
- Produces: `readJsonFromStdin(timeoutMs?: number): Promise<object | null>`
- Produces CLI: `node hooks/agent-feedback-capture.js`, reading hook JSON from stdin.

- [ ] **Step 1: Write the failing capture tests**

Create `tests/agent-feedback-capture.test.js`:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyPrompt } from '../hooks/agent-feedback-capture.js';
import { readEvent } from '../hooks/agent-feedback-state.js';

const captureScript = path.join(process.cwd(), 'hooks', 'agent-feedback-capture.js');

function runCapture(input, env = {}) {
  return spawnSync(process.execPath, [captureScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify(input),
  });
}

test('classifyPrompt detects explicit durable feedback in Chinese and English', () => {
  assert.deepEqual(classifyPrompt('以后不要把未授权范围写成风险'), {
    signal: 'durable-feedback',
    reason: 'future-behavior',
  });
  assert.deepEqual(classifyPrompt('Please write this into AGENTS.md: always check duplicate rules first'), {
    signal: 'durable-feedback',
    reason: 'explicit-rule-source',
  });
  assert.deepEqual(classifyPrompt('记住这个规则：先 grep 项目有没有已有手册'), {
    signal: 'durable-feedback',
    reason: 'memory-to-rule',
  });
});

test('classifyPrompt ignores ordinary implementation requests', () => {
  assert.equal(classifyPrompt('add a button to the settings page'), null);
  assert.equal(classifyPrompt('run npm test and show me the output'), null);
  assert.equal(classifyPrompt('explain this function'), null);
});

test('capture hook writes a pending event and emits additional context', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-capture-'));
  const result = runCapture(
    {
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt: '以后不要把未授权范围写成风险',
      prompt_id: 'prompt-1',
      session_id: 'session-1',
    },
    {
      AGENT_FEEDBACK_STATE_DIR: stateDir,
      PLUGIN_DATA: path.join(stateDir, 'codex-data'),
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.systemMessage, 'AGENT-FEEDBACK:PENDING');
  assert.match(output.hookSpecificOutput.additionalContext, /Pending durable feedback event/);
  assert.match(output.hookSpecificOutput.additionalContext, /agent-feedback-loop/);

  const eventPath = output.hookSpecificOutput.additionalContext.match(/Event path: (.+)$/m)[1];
  const event = readEvent(eventPath);
  assert.equal(event.status, 'pending');
  assert.equal(event.signal, 'durable-feedback');
  assert.equal(event.excerpt, '以后不要把未授权范围写成风险');
});

test('capture hook stays silent for non-feedback prompts', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-capture-silent-'));
  const result = runCapture(
    {
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'add a settings button',
      prompt_id: 'prompt-1',
      session_id: 'session-1',
    },
    {
      AGENT_FEEDBACK_STATE_DIR: stateDir,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('capture hook exits cleanly on invalid JSON', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-capture-invalid-'));
  const result = spawnSync(process.execPath, [captureScript], {
    encoding: 'utf8',
    env: { ...process.env, AGENT_FEEDBACK_STATE_DIR: stateDir },
    input: '{bad json',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/agent-feedback-capture.test.js
```

Expected: FAIL with module resolution errors for `hooks/agent-feedback-capture.js`.

- [ ] **Step 3: Add stdin reading helper to state module**

Append this export to `hooks/agent-feedback-state.js` before the CLI section:

```js
export function readJsonFromString(text) {
  try {
    return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export function readStdinWithTimeout(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let input = '';
    let done = false;

    function finish() {
      if (done) return;
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
```

- [ ] **Step 4: Implement the capture hook**

Create `hooks/agent-feedback-capture.js`:

```js
import { buildHookOutput, writeStdoutSafely } from './agent-feedback-runtime.js';
import { createEvent, readStdinWithTimeout, writeEvent } from './agent-feedback-state.js';

const EXPLICIT_SOURCE_RE =
  /\b(AGENTS\.md|CLAUDE\.md|README\.md|rules?|guide|handbook|manual|policy|conventions?|instructions?)\b/i;
const CHINESE_SOURCE_RE = /(规则源|规则|手册|规范|指令|约定|文档)/;
const FUTURE_BEHAVIOR_RE = /(以后|下次|以后不要|不要再|应该先|必须先|刚才的问题|刚才错|这次的问题)/;
const MEMORY_TO_RULE_RE = /(记住|沉淀|长期规则|写进|更新|放进|加到|合并到)/;
const ENGLISH_FEEDBACK_RE =
  /\b(remember this|next time|from now on|do not do this again|write this into|add this to|update the rule|update the docs|durable rule|long-term rule|feedback)\b/i;

export function classifyPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return null;

  if (
    (EXPLICIT_SOURCE_RE.test(text) || CHINESE_SOURCE_RE.test(text)) &&
    /(写进|更新|放进|加到|合并|write|add|update)/i.test(text)
  ) {
    return { signal: 'durable-feedback', reason: 'explicit-rule-source' };
  }

  if (MEMORY_TO_RULE_RE.test(text) && (CHINESE_SOURCE_RE.test(text) || ENGLISH_FEEDBACK_RE.test(text))) {
    return { signal: 'durable-feedback', reason: 'memory-to-rule' };
  }

  if (FUTURE_BEHAVIOR_RE.test(text) || ENGLISH_FEEDBACK_RE.test(text)) {
    return { signal: 'durable-feedback', reason: 'future-behavior' };
  }

  return null;
}

function buildCaptureContext(event, reason) {
  return [
    'Pending durable feedback event detected.',
    `Signal: ${event.signal}`,
    `Reason: ${reason}`,
    `Excerpt: ${event.excerpt}`,
    `Event path: ${event.eventPath}`,
    'Use the agent-feedback-loop skill before finishing this turn.',
    'After handling the event, mark the event status with `node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>`.',
  ].join('\n');
}

export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input || input.hook_event_name !== 'UserPromptSubmit') return;

  const prompt = String(input.prompt || '');
  const classification = classifyPrompt(prompt);
  if (!classification) return;

  const event = writeEvent(createEvent(input, classification.signal, prompt, env));
  const output = buildHookOutput({
    eventName: 'UserPromptSubmit',
    additionalContext: buildCaptureContext(event, classification.reason),
    systemMessage: 'AGENT-FEEDBACK:PENDING',
    env,
  });

  writeStdoutSafely(output);
}

if (process.argv[1] && process.argv[1].endsWith('agent-feedback-capture.js')) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
```

- [ ] **Step 5: Run the capture tests**

Run:

```bash
node --test tests/agent-feedback-capture.test.js
npm test
```

Expected: PASS for capture tests and all existing tests.

- [ ] **Step 6: Commit**

```bash
git add hooks/agent-feedback-capture.js hooks/agent-feedback-state.js tests/agent-feedback-capture.test.js
git commit -m "feat: capture durable agent feedback prompts"
```

---

### Task 3: Stop Hook Continuation And Shared Hook Config

**Files:**

- Create: `hooks/agent-feedback-stop.js`
- Create: `hooks/claude-codex-hooks.json`
- Create: `tests/agent-feedback-stop.test.js`

**Interfaces:**

- Consumes: `findPendingEvent(...)`, `incrementAttempts(...)`, and `markEventStatus(...)` from `hooks/agent-feedback-state.js`
- Consumes: `buildHookOutput(...)` from `hooks/agent-feedback-runtime.js`
- Produces: `shouldContinueForEvent(input: object, event: FeedbackEvent, maxAttempts?: number): boolean`
- Produces CLI: `node hooks/agent-feedback-stop.js`, reading Stop hook JSON from stdin.

- [ ] **Step 1: Write the failing Stop hook tests**

Create `tests/agent-feedback-stop.test.js`:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEvent, readEvent, writeEvent } from '../hooks/agent-feedback-state.js';
import { shouldContinueForEvent } from '../hooks/agent-feedback-stop.js';

const stopScript = path.join(process.cwd(), 'hooks', 'agent-feedback-stop.js');

function runStop(input, env = {}) {
  return spawnSync(process.execPath, [stopScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify(input),
  });
}

test('shouldContinueForEvent respects stop_hook_active and max attempts', () => {
  const event = { attempts: 0, status: 'pending' };
  assert.equal(shouldContinueForEvent({ stop_hook_active: false }, event, 3), true);
  assert.equal(shouldContinueForEvent({ stop_hook_active: true }, event, 3), false);
  assert.equal(shouldContinueForEvent({ stop_hook_active: false }, { ...event, attempts: 3 }, 3), false);
  assert.equal(shouldContinueForEvent({ stop_hook_active: false }, { ...event, status: 'updated' }, 3), false);
});

test('Stop hook injects continuation context and increments attempts for pending event', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-stop-'));
  const env = {
    AGENT_FEEDBACK_STATE_DIR: stateDir,
    PLUGIN_DATA: path.join(stateDir, 'codex-data'),
  };

  const event = writeEvent(
    createEvent(
      {
        cwd: '/repo/project',
        hook_event_name: 'UserPromptSubmit',
        prompt: '以后不要忽略用户反馈',
        prompt_id: 'prompt-1',
        session_id: 'session-1',
      },
      'durable-feedback',
      '以后不要忽略用户反馈',
      env,
    ),
  );

  const result = runStop(
    {
      cwd: '/repo/project',
      hook_event_name: 'Stop',
      last_assistant_message: 'Done.',
      session_id: 'session-1',
      stop_hook_active: false,
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.systemMessage, 'AGENT-FEEDBACK:PENDING');
  assert.match(output.hookSpecificOutput.additionalContext, /Unprocessed durable feedback event/);
  assert.match(output.hookSpecificOutput.additionalContext, /agent-feedback-loop/);

  const updated = readEvent(event.eventPath);
  assert.equal(updated.attempts, 1);
  assert.equal(updated.status, 'pending');
});

test('Stop hook stays silent when stop hook is already active', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-stop-active-'));
  const env = { AGENT_FEEDBACK_STATE_DIR: stateDir };

  writeEvent(
    createEvent(
      {
        cwd: '/repo/project',
        hook_event_name: 'UserPromptSubmit',
        prompt: '下次应该查重',
        prompt_id: 'prompt-1',
        session_id: 'session-1',
      },
      'durable-feedback',
      '下次应该查重',
      env,
    ),
  );

  const result = runStop(
    {
      cwd: '/repo/project',
      hook_event_name: 'Stop',
      session_id: 'session-1',
      stop_hook_active: true,
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('Stop hook marks event blocked after repeated unprocessed attempts', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-stop-block-'));
  const env = { AGENT_FEEDBACK_STATE_DIR: stateDir };

  const event = writeEvent({
    ...createEvent(
      {
        cwd: '/repo/project',
        hook_event_name: 'UserPromptSubmit',
        prompt: '记住这个规则',
        prompt_id: 'prompt-1',
        session_id: 'session-1',
      },
      'durable-feedback',
      '记住这个规则',
      env,
    ),
    attempts: 3,
  });

  const result = runStop(
    {
      cwd: '/repo/project',
      hook_event_name: 'Stop',
      session_id: 'session-1',
      stop_hook_active: false,
    },
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(readEvent(event.eventPath).status, 'blocked');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/agent-feedback-stop.test.js
```

Expected: FAIL with module resolution errors for `hooks/agent-feedback-stop.js`.

- [ ] **Step 3: Implement the Stop hook**

Create `hooks/agent-feedback-stop.js`:

```js
import { buildHookOutput, writeStdoutSafely } from './agent-feedback-runtime.js';
import { findPendingEvent, incrementAttempts, markEventStatus, readStdinWithTimeout } from './agent-feedback-state.js';

const MAX_STOP_ATTEMPTS = 3;

export function shouldContinueForEvent(input, event, maxAttempts = MAX_STOP_ATTEMPTS) {
  if (!event || event.status !== 'pending') return false;
  if (input.stop_hook_active) return false;
  return Number(event.attempts || 0) < maxAttempts;
}

function buildStopContext(event) {
  return [
    'Unprocessed durable feedback event is still pending.',
    `Excerpt: ${event.excerpt}`,
    `Event path: ${event.eventPath}`,
    'Use the agent-feedback-loop skill now.',
    'Resolve the event as Updated, Proposed, or No durable update made.',
    'After handling the event, mark the event status with `node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>`.',
  ].join('\n');
}

export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input || input.hook_event_name !== 'Stop') return;

  const event = findPendingEvent(input, env);
  if (!event) return;

  if (!shouldContinueForEvent(input, event)) {
    if (!input.stop_hook_active && Number(event.attempts || 0) >= MAX_STOP_ATTEMPTS) {
      markEventStatus(event.eventPath, 'blocked');
    }
    return;
  }

  const updatedEvent = incrementAttempts(event.eventPath);
  const output = buildHookOutput({
    eventName: 'Stop',
    additionalContext: buildStopContext(updatedEvent),
    systemMessage: 'AGENT-FEEDBACK:PENDING',
    env,
  });

  writeStdoutSafely(output);
}

if (process.argv[1] && process.argv[1].endsWith('agent-feedback-stop.js')) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
```

- [ ] **Step 4: Add the shared hook config**

Create `hooks/claude-codex-hooks.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "exec node \"${CLAUDE_PLUGIN_ROOT}/hooks/agent-feedback-capture.js\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\agent-feedback-capture.js\" }",
            "timeout": 5,
            "statusMessage": "Checking durable feedback..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "exec node \"${CLAUDE_PLUGIN_ROOT}/hooks/agent-feedback-stop.js\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\agent-feedback-stop.js\" }",
            "timeout": 5,
            "statusMessage": "Checking pending feedback..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Run the Stop tests and full tests**

Run:

```bash
node --test tests/agent-feedback-stop.test.js
npm test
```

Expected: PASS for Stop tests and all test files.

- [ ] **Step 6: Commit**

```bash
git add hooks/agent-feedback-stop.js hooks/claude-codex-hooks.json tests/agent-feedback-stop.test.js
git commit -m "feat: continue turns for pending feedback events"
```

---

### Task 4: Agent Feedback Loop Skill And Manuals

**Files:**

- Create: `skills/agent-feedback-loop/SKILL.md`
- Create: `skills/agent-feedback-loop/references/workflow.md`
- Create: `skills/agent-feedback-loop/references/source-discovery.md`
- Create: `skills/agent-feedback-loop/references/validation.md`
- Create: `tests/agent-feedback-skill.test.js`

**Interfaces:**

- Consumes: hook additional context containing `Event path: <path>`
- Consumes: `node hooks/agent-feedback-state.js mark <eventPath> <status>`
- Produces: a model-invoked skill named `agent-feedback-loop`
- Produces: output contracts `Updated`, `Proposed target`, and `No durable update made`
- Produces: instructions to use known long-term rule sources first and grep fallback only when owner is unknown.

- [ ] **Step 1: Write the failing skill structure tests**

Create `tests/agent-feedback-skill.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const skillPath = 'skills/agent-feedback-loop/SKILL.md';
const workflowPath = 'skills/agent-feedback-loop/references/workflow.md';
const sourcePath = 'skills/agent-feedback-loop/references/source-discovery.md';
const validationPath = 'skills/agent-feedback-loop/references/validation.md';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('agent-feedback-loop skill has required frontmatter and reference routing', () => {
  const skill = read(skillPath);
  assert.match(skill, /^---\nname: agent-feedback-loop\n/);
  assert.match(skill, /description: .+feedback.+长期规则源/s);
  assert.match(skill, /references\/workflow\.md/);
  assert.match(skill, /references\/source-discovery\.md/);
  assert.match(skill, /references\/validation\.md/);
});

test('skill does not introduce a persistent ownership registry', () => {
  const combined = [skillPath, workflowPath, sourcePath, validationPath].map(read).join('\n');
  assert.doesNotMatch(combined, /rule-sources\.json/);
  assert.doesNotMatch(combined, /source registry/i);
});

test('source discovery prioritizes known sources before grep fallback', () => {
  const source = read(sourcePath);
  assert.match(source, /已知长期规则源优先/);
  assert.match(source, /grep 兜底/);
  assert.match(source, /禁止.*全库.*默认扫描/);
});

test('validation reference defines all output contracts and event status marking', () => {
  const validation = read(validationPath);
  assert.match(validation, /Updated:/);
  assert.match(validation, /Proposed target:/);
  assert.match(validation, /No durable update made/);
  assert.match(validation, /agent-feedback-state\.js mark/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/agent-feedback-skill.test.js
```

Expected: FAIL with missing `skills/agent-feedback-loop/SKILL.md`.

- [ ] **Step 3: Create the skill entry file**

Create `skills/agent-feedback-loop/SKILL.md`:

```markdown
---
name: agent-feedback-loop
description: 当用户给出 agent 行为反馈、纠正、失败复盘、review 结论、长期规则源更新诉求，或说“以后 / 下次 / 记住 / 写进规则 / 更新手册 / 不要再”时使用。该技能把 feedback 抽象成可复用规则，优先合并到已知长期规则源；不知道 owner 时，通过项目 grep 和文档证据发现落点，查重、查冲突后再更新或提案。
---

# Agent Feedback Loop

## 使用时机

用户反馈能改变未来 agent 决策时，使用本技能。

典型信号：

- 用户纠正 agent 行为。
- 用户要求把经验写进规则、规范、手册、文档或长期规则源。
- 用户指出重复错误、review 结论、失败复盘或行为漂移。
- Hook 上下文提示存在 pending durable feedback event。

## 工作模式

- 用户明确要求分析、评审、只提案或不要改文件时，使用提案模式。
- 用户明确要求更新规则源时，使用编辑模式。
- Hook 捕获到 pending event 且当前项目可写时，先按编辑模式判断；任一编辑门失败时降级为提案模式或不沉淀。

## 全局边界

- Hook 只提供 feedback event 和上下文，不直接编辑长期规则源。
- 优先使用已知长期规则源。
- 不知道长期规则源时，才用 grep 和项目证据发现 owner。
- 不创建持久规则源索引。
- 不预设 `SKILL.md` 是规则落点。
- 规则更新前必须查重。
- 规则更新前必须查冲突。
- 没有唯一 owner 时，不写文件。
- feedback 只是当前任务偏好时，不沉淀为长期规则。
- 禁止把事故细节、客户名、密钥、私有 URL、长日志或 ticket 细节写进长期规则。

## 执行路由

- 读取 `references/workflow.md` 执行主流程。
- 需要定位规则源、查重或查冲突时，读取 `references/source-discovery.md`。
- 写入、提案或拒绝沉淀前，读取 `references/validation.md`。

## 停止条件

- 已更新唯一长期规则源，并完成验证。
- 已输出可审提案，并说明不能直接写入的原因。
- 已判定没有 durable update，并说明原因。

Hook 事件处理完成后，按 `references/validation.md` 标记 event status。
```

- [ ] **Step 4: Create the workflow manual**

Create `skills/agent-feedback-loop/references/workflow.md`:

```markdown
# Feedback To Rules Workflow

## 目标

把高信号 feedback 转成下一次 agent 能执行的长期规则。

## 输入

- 当前用户消息。
- Hook 注入的 pending durable feedback event。
- 当前对话中可见的 correction、review、失败复盘或行为观察。
- 当前项目已有规则、规范、手册、文档和配置。

## 执行步骤

1. 提取 feedback signal。
   - 只使用当前对话、hook event、文件 diff、测试结果、review 输出或用户纠正中可见的证据。
   - 不用记忆补造 feedback。
   - 没有可复用决策信号时，输出 `No durable update made`。

2. 判断是否 durable。
   - durable 条件：能改变未来多个任务里的 agent 决策。
   - 非 durable 条件：只适用于当前回答、当前文件、当前一次口吻或一次性偏好。
   - 非 durable 时，不写长期规则源。

3. 抽象原则。
   - 写成可复用决策规则。
   - 去掉事故细节、客户名、日期、ticket、日志和私有路径。
   - 保留会改变未来行为的判断条件、动作和禁止项。

4. 定位长期规则源。
   - 按 `source-discovery.md` 先查已知长期规则源。
   - 已知来源不足时，按 `source-discovery.md` 执行 grep 兜底。

5. 查重和查冲突。
   - 找相同规则。
   - 找相邻规则。
   - 找反向规则。
   - 重复时合并，不追加第二份。
   - 冲突时输出提案或待裁决。

6. 选择输出模式。
   - 唯一 owner、无冲突、可写、规则通过验证时，编辑文件。
   - owner 不唯一、存在冲突、项目不可写或用户只要提案时，输出提案。
   - feedback 不 durable 或会污染规则源时，输出不沉淀。

7. 验证结果。
   - 按 `validation.md` 运行编辑门、隐私门、重复门和输出门。
   - 改动指令或手册时，按本仓库的 `instruction-doc-audit` 规则做自检。

8. 标记 hook event。
   - 更新成功标记为 `updated`。
   - 提案标记为 `proposed`。
   - 不沉淀标记为 `no-durable-update`。
   - 阻塞且无法继续标记为 `blocked`。

## 禁止

- 禁止把用户原始抱怨直接写成规则。
- 禁止为了落地而创建并行规则源。
- 禁止跳过已有规则源查重。
- 禁止把未解决冲突写成已更新。
- 禁止让 hook 自己编辑长期规则源。
```

- [ ] **Step 5: Create the source discovery manual**

Create `skills/agent-feedback-loop/references/source-discovery.md`:

````markdown
# Source Discovery

## 目标

找到当前项目里最合适的长期规则源，并避免重复或冲突。

## 已知长期规则源优先

按以下顺序判断 owner：

1. 用户明确指定的位置。
2. 当前任务正在编辑或审查的规则文件。
3. 当前项目已存在的 agent 指令文件。
4. 当前项目已存在的 docs、手册、规范、policy、guide、manual、convention 或 instruction 文件。
5. 当前项目如果包含 skills/plugin 结构，再考虑 `skills/**`、`.codex-plugin/**`、`.claude-plugin/**`。

禁止因为本技能运行在 skills 仓库里，就把其他项目的 feedback 默认写进 `SKILL.md`。

## grep 兜底

已知 owner 不足时，才使用 grep 发现。

先列候选文件：

```bash
rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g 'README.md' -g 'docs/**' -g '.github/copilot-instructions.md' -g '.cursor/rules/**' -g '.windsurf/rules/**' -g '.clinerules'
```
````

如果候选文件或 manifest 证明当前项目存在 skill/plugin 结构，再追加技能规则候选：

```bash
rg --files -g 'skills/**/SKILL.md' -g 'skills/**/references/**' -g '.codex-plugin/**' -g '.claude-plugin/**'
```

再搜索规则源线索：

```bash
rg -n "规则|手册|规范|指令|约定|长期|feedback|rule|guide|handbook|manual|policy|instruction|convention" AGENTS.md CLAUDE.md README.md docs .github .cursor .windsurf .clinerules 2>/dev/null
```

如果已确认存在 skill/plugin 结构，再搜索技能规则线索：

```bash
rg -n "规则|手册|规范|指令|约定|长期|feedback|rule|guide|handbook|manual|policy|instruction|convention" skills .codex-plugin .claude-plugin 2>/dev/null
```

最后搜索 feedback 关键词和相邻概念。关键词来自用户反馈，不使用通用空词。

禁止把 grep 命中当成 owner。grep 只提供候选，owner 必须由文档职责和相邻规则确认。

禁止默认全库扫描。只有已知来源和当前上下文都不足时，才扩大搜索。

## owner 判定

可以编辑的 owner 必须满足全部条件：

- 文件是规则、规范、手册、agent 指令、项目约定或同等长期规则源。
- 命中段落与 feedback 原则属于同一决策主题。
- 新规则能并入已有段落，或能创建最小相邻段落。
- 没有同等强度的反向规则。
- 不需要用户裁决才能选择位置。

## 查重

发现相同语义时：

- 优先收紧已有规则。
- 删除或避免新增重复句。
- 不把同一规则同时写进多个文件。

发现 feedback 只是已有规则的例子时：

- 不新增规则。
- 只有原规则含糊时，才改写原规则。

## 冲突

发现冲突时：

- 不覆盖旧规则。
- 输出冲突位置。
- 输出建议原则。
- 标记为 `Proposed target` 或待裁决。

## 无 owner

找不到 owner 时：

- 不随机写入 README。
- 不随机创建 docs 文件。
- 输出建议创建的最小规则源和原因。

````

- [ ] **Step 6: Create the validation manual**

Create `skills/agent-feedback-loop/references/validation.md`:

```markdown
# Validation

## 编辑门

直接编辑必须全部通过：

- feedback 是长期规则。
- 已找到唯一 owner。
- 已查重。
- 已查冲突。
- 新规则能独立勾选。
- 新规则有明确触发条件或适用边界。
- 新规则没有保存敏感细节。
- 用户没有要求只提案。

任一失败时，不直接编辑。

## 隐私门

长期规则禁止保存：

- 客户名。
- 私有项目名。
- ticket 编号。
- 邮箱。
- 密钥。
- 私有 URL。
- 长日志。
- 原始事故细节。
- 可识别个人或组织的上下文。

需要保留来源时，只写抽象来源，例如“用户反馈指出该行为会导致规则漂移”。

## 规则质量门

每条新增或改写规则必须满足：

- 一条规则只表达一个动作或约束。
- 条件、动作、禁止分开写。
- 有互斥分支时，用命名槽位。
- 不使用“适当”“合理”“高质量”这类不可测词。
- 不用示例替代规则。

## 事件状态标记

处理 hook event 后运行：

```bash
node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>
````

状态含义：

- `updated`：已修改长期规则源。
- `proposed`：已输出提案，但未修改长期规则源。
- `no-durable-update`：feedback 不适合沉淀。
- `blocked`：缺少 owner、权限、上下文或用户裁决，无法继续。

## 输出格式

更新成功：

```markdown
Updated: <file path>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Merge strategy: <merged existing rule / rewritten section / removed duplicate>
Validation: <checks passed>
Verification: <commands run or reason not run>
```

只提案：

```markdown
Proposed target: <file path and heading>
Feedback signal: <context evidence in one sentence>
Principle: <one-sentence generalized rule>
Reason: <why direct edit was not safe>
Proposed text: <exact text to merge>
Validation: <checks passed>
Verification: <evidence used to verify target>
```

不沉淀：

```markdown
No durable update made.
Reason: <why the feedback was not durable, coherent, safe, or actionable>
```

## 验证命令

当前仓库改动完成后运行：

```bash
npm test
npm run format:all
npm run lint
```

如果只修改 Markdown 且 lint 无匹配代码，仍运行 `npm test` 和 `npm run format:all`。

````

- [ ] **Step 7: Run the skill tests**

Run:

```bash
node --test tests/agent-feedback-skill.test.js
npm test
````

Expected: PASS for skill tests and all test files.

- [ ] **Step 8: Self-audit the new instruction documents**

Run this manual check by reading the four new Markdown files:

```bash
sed -n '1,220p' skills/agent-feedback-loop/SKILL.md
sed -n '1,260p' skills/agent-feedback-loop/references/workflow.md
sed -n '1,260p' skills/agent-feedback-loop/references/source-discovery.md
sed -n '1,260p' skills/agent-feedback-loop/references/validation.md
```

Expected: rules are flat, branch rules use explicit slots, `SKILL.md` contains routing and global boundaries only, references contain execution details.

- [ ] **Step 9: Commit**

```bash
git add skills/agent-feedback-loop tests/agent-feedback-skill.test.js
git commit -m "feat: add agent feedback loop skill"
```

---

### Task 5: Plugin Manifests And README Integration

**Files:**

- Create: `tests/agent-feedback-plugin.test.js`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: `hooks/claude-codex-hooks.json`
- Consumes: `skills/agent-feedback-loop/SKILL.md`
- Produces: Codex plugin manifest with `hooks: "./hooks/claude-codex-hooks.json"`
- Produces: Claude Code plugin manifest with `hooks: "./hooks/claude-codex-hooks.json"`
- Produces: README entries for the new skill and hook trust flow.

- [ ] **Step 1: Write the failing plugin wiring tests**

Create `tests/agent-feedback-plugin.test.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

test('Codex and Claude plugin manifests point at the shared feedback hooks', () => {
  const codex = readJson('.codex-plugin/plugin.json');
  const claude = readJson('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('shared hook config references shipped capture and stop scripts', () => {
  const hooks = readJson('hooks/claude-codex-hooks.json');
  const commands = Object.values(hooks.hooks)
    .flat()
    .flatMap((group) => group.hooks)
    .flatMap((hook) => [hook.command, hook.commandWindows].filter(Boolean));

  assert.ok(commands.some((command) => command.includes('agent-feedback-capture.js')));
  assert.ok(commands.some((command) => command.includes('agent-feedback-stop.js')));

  assert.ok(fs.existsSync('hooks/agent-feedback-capture.js'));
  assert.ok(fs.existsSync('hooks/agent-feedback-stop.js'));
});

test('README documents agent-feedback-loop and hook trust setup', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /agent-feedback-loop/);
  assert.match(readme, /\/hooks/);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test tests/agent-feedback-plugin.test.js
```

Expected: FAIL because manifests do not yet declare `hooks` and README does not mention `agent-feedback-loop`.

- [ ] **Step 3: Update the Codex plugin manifest**

Modify `.codex-plugin/plugin.json` to include `hooks` and add Lifecycle hooks capability. The file should keep existing metadata and include these fields:

```json
{
  "name": "codeartz-skills",
  "version": "0.1.0",
  "description": "面向 Codex agent 工作流的 Codeartz 技能集，用于把复杂任务收敛为可执行、可评审、可交接的工作产物。",
  "author": {
    "name": "Codeartz",
    "url": "https://github.com/hanjeahwan"
  },
  "homepage": "https://github.com/hanjeahwan/codeartz-skills",
  "repository": "https://github.com/hanjeahwan/codeartz-skills",
  "license": "MIT",
  "keywords": ["codex", "skills", "agent-workflow", "技术方案"],
  "skills": "./skills/",
  "hooks": "./hooks/claude-codex-hooks.json",
  "interface": {
    "displayName": "Codeartz 技能集",
    "shortDescription": "面向 agent 工作流的 Codeartz 技能集。",
    "longDescription": "帮助 agent 把复杂需求、代码证据、评审意见、用户反馈和执行上下文收敛为有边界、可评审、可交接、可沉淀的工程工作流产物。",
    "developerName": "Codeartz",
    "category": "Productivity",
    "capabilities": ["Instructions", "Planning", "Review", "Lifecycle hooks"],
    "websiteURL": "https://github.com/hanjeahwan/codeartz-skills",
    "defaultPrompt": [
      "分析这组需求和代码上下文的边界。",
      "把这些资料整理成可评审的技术方案。",
      "为这个方案生成上下文交接文件。",
      "把这条反馈沉淀成长期规则。"
    ],
    "brandColor": "#A11D5F",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png"
  }
}
```

- [ ] **Step 4: Update the Claude Code plugin manifest**

Modify `.claude-plugin/plugin.json` to include `hooks`. Preserve existing metadata and add:

```json
{
  "name": "codeartz-skills",
  "version": "0.1.0",
  "description": "面向 agent 工作流的 Codeartz 技能集，用于把复杂任务收敛为可执行、可评审、可交接的工作产物。",
  "author": {
    "name": "Codeartz",
    "url": "https://github.com/hanjeahwan"
  },
  "homepage": "https://github.com/hanjeahwan/codeartz-skills",
  "repository": "https://github.com/hanjeahwan/codeartz-skills",
  "license": "MIT",
  "keywords": ["claude-code", "codex", "skills", "agent-workflow", "技术方案"],
  "hooks": "./hooks/claude-codex-hooks.json"
}
```

- [ ] **Step 5: Update README skill tables and install notes**

Modify `README.md`:

Add a row to the `What it is` table:

```markdown
| [`agent-feedback-loop`](skills/agent-feedback-loop/) | 用户给出行为纠正、失败复盘、review 结论或“以后 / 下次 / 记住 / 写进规则”这类反馈时 | 抽象成可复用规则，优先合并到已知长期规则源；无法安全写入时输出提案或不沉淀原因 |
```

Add a `When to use` subsection:

```markdown
使用 `agent-feedback-loop`：

- 用户要求把反馈写进长期规则源。
- 用户指出 agent 的重复错误或行为漂移。
- 用户说“以后”“下次”“记住”“不要再”“写进规则”“更新手册”。
- 需要先查重、查冲突，再把规则合并进已有 docs、手册、规范或 agent 指令。
```

Update Codex install notes:

```markdown
Codex 安装后打开 `/hooks`，review 并 trust Codeartz 的 lifecycle hooks；然后重启应用或开启新线程。
```

Update Commands table:

```markdown
| `agent-feedback-loop` | 把用户 feedback 抽象成长期规则，查重、查冲突后合并到已有规则源或输出提案 |
```

- [ ] **Step 6: Run plugin tests and full verification**

Run:

```bash
node --test tests/agent-feedback-plugin.test.js
npm test
npm run format:all
npm run lint
```

Expected: PASS for tests. `npm run format:all` should finish without formatting errors. `npm run lint` should finish without lint violations.

- [ ] **Step 7: Commit**

```bash
git add .codex-plugin/plugin.json .claude-plugin/plugin.json README.md tests/agent-feedback-plugin.test.js
git commit -m "feat: wire agent feedback loop into plugins"
```

---

## Self-Review

**Spec coverage:**  
Task 1 covers runtime detection, state files, status marking, and dependency-free Node scripts. Task 2 covers `UserPromptSubmit` capture. Task 3 covers `Stop` continuation, loop prevention, and shared hook config. Task 4 covers the skill, known-source-first discovery, grep fallback, duplicate/conflict handling, privacy gates, and output contracts. Task 5 covers Codex + Claude Code manifests, README, hook trust instructions, and integration tests.

**Placeholder scan:**  
The plan contains exact file paths, commands, expected results, and complete code blocks for tests and implementation. It does not rely on unspecified future work.

**Type consistency:**  
The state helper names used in Task 2 and Task 3 match the functions produced in Task 1. The status names in tests, hook scripts, and validation docs are identical: `pending`, `processing`, `updated`, `proposed`, `no-durable-update`, and `blocked`.

**Execution Handoff:**  
Plan complete and saved to `docs/superpowers/plans/2026-07-09-agent-feedback-loop.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
