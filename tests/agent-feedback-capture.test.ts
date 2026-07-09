import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyPrompt } from '../hooks/agent-feedback-capture.js';
import { readEvent } from '../hooks/agent-feedback-state.js';

const captureScript = path.join(process.cwd(), 'hooks', 'agent-feedback-capture.js');

function runCapture(input: Record<string, unknown>, env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
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
  assert.deepEqual(classifyPrompt('remember this rule: check duplicate rules first'), {
    signal: 'durable-feedback',
    reason: 'future-behavior',
  });
  assert.deepEqual(classifyPrompt('记住这个规则：先 grep 项目有没有已有手册'), {
    signal: 'durable-feedback',
    reason: 'memory-to-rule',
  });
});

test('classifyPrompt ignores ordinary implementation requests', () => {
  assert.equal(classifyPrompt('add a feedback button to settings'), null);
  assert.equal(classifyPrompt('summarize customer feedback from this issue'), null);
  assert.equal(classifyPrompt('build a feedback form'), null);
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

  const eventPathMatch = output.hookSpecificOutput.additionalContext.match(/Event path: (.+)$/m);
  assert.ok(eventPathMatch);
  const eventPath = eventPathMatch[1];
  const event = readEvent(eventPath);
  assert.ok(event);
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
