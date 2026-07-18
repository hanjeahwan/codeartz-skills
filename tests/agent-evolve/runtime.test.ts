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
  assert.match(context, /已安装的 agent-evolve Skill/);
  assert.match(context, /当前项目/);
  assert.match(context, /任务分离/);
  assert.match(context, /关闭 Agent Evolve/);
  assert.match(context, /当前任务本来仍须交付的条件、后果和作用域/);
  assert.match(context, /目标文件不同不能证明独立/);
  assert.match(context, /相同依据还能约束未来同类任务/);
  assert.doesNotMatch(context, /同一目标文件|普通任务不会更新规则源/);
  assert.match(context, /适用条件、决策后果、可靠依据和未来差异/);
  assert.match(context, /项目合同直接排除或优先可行方案/);
  assert.match(context, /不要求先失败/);
  assert.match(context, /选型关卡/);
  assert.match(context, /不得因当前实现已经完成而跳过/);
  assert.match(context, /空泛口号/);
  assert.match(context, /无项目证据的 runner 或 sandbox 限制不加载 Skill/);
  assert.match(context, /发送最终回复前逐项检查全部独立记录/);
  assert.match(context, /逐项检查/);
  assert.match(context, /safe 预授权/);
  assert.match(context, /来源只影响依据，不新增确认门/);
  assert.match(context, /review 只提案/);
  assert.match(context, /用户当前禁止写入/);
  assert.match(context, /修改实现或测试前加载 Skill 并停止选边/);
  assert.match(context, /评估可能成为规则的反馈/);
  assert.match(context, /作用域、重复、冲突和正式结果只能由工作流判断/);
  assert.ok(context.split('\n').length <= 8);
  assert.doesNotMatch(context, /references\/workflow|references\/validation/);
  assert.doesNotMatch(context, /任务证据候选未经用户确认只能提案/);
});

test('buildOffContext 关闭自动行为但保留手动调用', () => {
  const context = buildOffContext();
  assert.match(context, /AGENT EVOLVE OFF/);
  assert.match(context, /automatic feedback recognition and persistence are disabled/);
  assert.match(context, /Manual \$agent-evolve invocation remains available/);
  assert.match(context, /Do not persist project rules unless the user manually invokes/);
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
