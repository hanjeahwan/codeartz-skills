import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEvent, readEvent, writeEvent } from '../hooks/agent-feedback-state.js';
import { shouldContinueForEvent } from '../hooks/agent-feedback-stop.js';

const stopScript = path.join(process.cwd(), 'hooks', 'agent-feedback-stop.js');

function runStop(input: Record<string, unknown>, env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
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
  assert.ok(updated);
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
  const blocked = readEvent(event.eventPath);
  assert.ok(blocked);
  assert.equal(blocked.status, 'blocked');
});
