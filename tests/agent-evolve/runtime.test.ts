import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFailureOutput, buildHookOutput, readJsonFromString } from '../../hooks/agent-evolve-runtime.js';

test('readJsonFromString 只接受 JSON record', () => {
  assert.deepEqual(readJsonFromString('{"hook_event_name":"SessionStart","session_id":"s1"}'), {
    hook_event_name: 'SessionStart',
    session_id: 's1',
  });
  assert.equal(readJsonFromString('{bad json'), null);
  assert.equal(readJsonFromString('[]'), null);
  assert.equal(readJsonFromString('"text"'), null);
});

test('buildHookOutput 使用 Codex 与 Claude Code 都支持的结构', () => {
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

test('buildHookOutput 仅在明确请求时包含 systemMessage', () => {
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

test('buildFailureOutput 提供可见且非阻塞的证据', () => {
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
