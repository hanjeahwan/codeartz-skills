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
  assert.match(context, /先过排除门/);
  assert.match(context, /禁止加载 Skill、补写提案或输出回执/);
  assert.match(context, /可观察条件、明确决策后果、可靠依据和未来决策差异/);
  assert.match(context, /“以后”“必须”等词不能补齐缺失语义/);
  assert.match(context, /发送最终回复前必须回答/);
  assert.match(context, /未来会重现的 A→B 选择/);
  assert.match(context, /不要求先发生故障/);
  assert.match(context, /Agent 自行建议或待确认合同不算/);
  assert.match(context, /在修改实现或测试前加载 Skill 并停止选边/);
  assert.match(context, /任务证据候选未经用户确认只能提案/);
  assert.match(context, /主观 Agent 观察需独立证据/);
  assert.match(context, /未批准的高风险变更也只能提案/);
  assert.match(context, /只执行现有规则且用户与证据未提出候选/);
  assert.match(context, /一次性操作边界/);
  assert.match(context, /无决策差异的失败、无佐证观察/);
  assert.match(context, /其他普通请求禁止加载/);
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
