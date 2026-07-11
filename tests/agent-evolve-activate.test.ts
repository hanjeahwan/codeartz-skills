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
