import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleSessionStart } from '../../hooks/agent-evolve-activate-runtime.js';
import {
  readSessionMode,
  sessionStatePath,
  writeDefaultMode,
  writeSessionMode,
} from '../../hooks/agent-evolve-state.js';

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

test('新 Codex session 固化 safe 并只注入按需加载路由', () => {
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
  assert.equal(output.systemMessage, 'AGENT-EVOLVE:SAFE');
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /^AGENT EVOLVE ACTIVE — mode: safe/);
  assert.match(output.hookSpecificOutput.additionalContext, /已安装的 `agent-evolve` Skill/);
  assert.match(output.hookSpecificOutput.additionalContext, /当前任务、连续纠正中形成精确反馈候选/);
  assert.match(output.hookSpecificOutput.additionalContext, /未确认的精确候选仍加载 Skill/);
  assert.match(output.hookSpecificOutput.additionalContext, /普通否定时不加载/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /# Agent Evolve 工作流/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /# Agent Evolve 安全验证/);
  assert.ok(output.hookSpecificOutput.additionalContext.split('\n').length <= 8);
  assert.equal(readSessionMode('codex-session', env), 'safe');
});

test('新 Claude Code session 使用 review 默认值与共用 hook 输出结构', () => {
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

test('off 默认值会固化 session 状态且不输出 SessionStart 内容', () => {
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

test('resume、clear 与 compact 保留已固化的 session mode', () => {
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

test('损坏的默认配置产生可见证据且不创建 session 状态', () => {
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

test('损坏的 session 状态产生可见证据而不是猜测 mode', () => {
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

test('session 状态路径不可读时产生可见证据而不是使用内建 fallback', () => {
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

test('SessionStart 路由不依赖读取 skill 文件', () => {
  const env = tempEnv();
  const output = JSON.parse(
    handleSessionStart(
      {
        hook_event_name: 'SessionStart',
        session_id: 'missing-skill',
      },
      env,
    ),
  );

  assert.equal(output.systemMessage, 'AGENT-EVOLVE:SAFE');
  assert.match(output.hookSpecificOutput.additionalContext, /AGENT EVOLVE ACTIVE/);
  assert.match(output.hookSpecificOutput.additionalContext, /已安装的 `agent-evolve` Skill/);
});

test('SessionStart 路由不预读 workflow 或 validation', () => {
  const output = JSON.parse(
    handleSessionStart({ hook_event_name: 'SessionStart', session_id: 'missing-workflow' }, tempEnv()),
  );

  assert.match(output.hookSpecificOutput.additionalContext, /AGENT EVOLVE ACTIVE/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /Unable to read/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /# Agent Evolve$/m);
});

test('activation 信任 manifest 事件路由且仅对无效 JSON 保持静默', () => {
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

  assert.match(JSON.parse(wrongEvent.stdout).hookSpecificOutput.additionalContext, /mode: safe/);
  assert.equal(invalidJson.stdout, '');
});

test('activation 源码不读取 prompt 且不编辑项目文件', () => {
  const source = fs.readFileSync(activateScript, 'utf8');
  assert.doesNotMatch(source, /input\.prompt/);
  assert.doesNotMatch(source, /writeFile|appendFile|renameSync|rmSync/);
});
