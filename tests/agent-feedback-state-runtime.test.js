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
  assert.equal(detectRuntime({ CLAUDE_PLUGIN_DATA: '/tmp/claude-data' }), 'claude');
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

test('createEvent uses CLAUDE_PLUGIN_DATA unless AGENT_FEEDBACK_STATE_DIR overrides it', () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-claude-'));
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-feedback-override-'));

  const claudeEvent = createEvent(
    {
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt_id: 'prompt-claude',
      session_id: 'session-1',
    },
    'durable-feedback',
    'remember this rule: check duplicate rules first',
    { CLAUDE_PLUGIN_DATA: claudeDir },
  );

  assert.match(claudeEvent.eventPath, new RegExp(`^${claudeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(claudeEvent.eventPath, /agent-feedback-loop\/events\//);

  const overriddenEvent = createEvent(
    {
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt_id: 'prompt-override',
      session_id: 'session-1',
    },
    'durable-feedback',
    'remember this rule: check duplicate rules first',
    {
      AGENT_FEEDBACK_STATE_DIR: overrideDir,
      CLAUDE_PLUGIN_DATA: claudeDir,
    },
  );

  assert.match(overriddenEvent.eventPath, new RegExp(`^${overrideDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
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
