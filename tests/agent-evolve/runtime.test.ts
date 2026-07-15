import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  buildOffContext,
  readJsonFromString,
} from '../../hooks/agent-evolve-runtime.js';

test('readJsonFromString 只接受 JSON record', () => {
  assert.deepEqual(readJsonFromString('{"hook_event_name":"SessionStart","session_id":"s1"}'), {
    hook_event_name: 'SessionStart',
    session_id: 's1',
  });
  assert.equal(readJsonFromString('{bad json'), null);
  assert.equal(readJsonFromString('[]'), null);
  assert.equal(readJsonFromString('"text"'), null);
});

test('buildActivationContext 生成宿主无关的短路由', () => {
  const context = buildActivationContext('review');

  assert.match(context, /^AGENT EVOLVE ACTIVE — mode: review/);
  assert.match(context, /已安装的 `agent-evolve` Skill/);
  assert.match(context, /直接提出可复用规则/);
  assert.match(context, /明确要求项目沉淀/);
  assert.match(context, /暂定、待验证、冲突和未确认的精确候选仍加载 Skill/);
  assert.match(context, /只有当前细节、明确禁止泛化或普通否定时不加载/);
  assert.match(context, /普通请求禁止加载/);
  assert.ok(context.split('\n').length <= 8);
  assert.doesNotMatch(context, /references\/workflow|references\/validation/);
});

test('buildOffContext 关闭自动行为但保留手动调用', () => {
  const context = buildOffContext();
  assert.match(context, /AGENT EVOLVE OFF/);
  assert.match(context, /automatic feedback recognition and persistence are disabled/);
  assert.match(context, /Manual \$agent-evolve invocation remains available/);
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
