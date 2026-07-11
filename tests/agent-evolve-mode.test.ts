import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseModeCommand } from '../hooks/agent-evolve-mode.js';
import {
  getOrCreateSessionMode,
  readDefaultMode,
  readSessionMode,
  sessionStatePath,
  writeDefaultMode,
  writeSessionMode,
} from '../hooks/agent-evolve-state.js';

const modeScript = path.join(process.cwd(), 'hooks', 'agent-evolve-mode.js');

function tempEnv(): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-mode-'));
  return {
    PLUGIN_DATA: path.join(root, 'plugin-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };
}

function runMode(prompt: string, sessionId: string, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify({
      cwd: '/repo/project',
      hook_event_name: 'UserPromptSubmit',
      prompt,
      session_id: sessionId,
    }),
  });
}

test('parseModeCommand accepts only the six approved commands and host prefixes', () => {
  assert.deepEqual(parseModeCommand('$agent-evolve safe'), { scope: 'session', mode: 'safe' });
  assert.deepEqual(parseModeCommand('/agent-evolve review'), { scope: 'session', mode: 'review' });
  assert.deepEqual(parseModeCommand('@agent-evolve off'), { scope: 'session', mode: 'off' });
  assert.deepEqual(parseModeCommand('$agent-evolve default safe'), {
    scope: 'default',
    mode: 'safe',
  });
  assert.deepEqual(parseModeCommand('/agent-evolve default review'), {
    scope: 'default',
    mode: 'review',
  });
  assert.deepEqual(parseModeCommand('@agent-evolve default off'), {
    scope: 'default',
    mode: 'off',
  });
});

test('parseModeCommand rejects partial, extended, legacy, and case-changed prompts', () => {
  for (const prompt of [
    '$agent-evolve',
    '$agent-evolve safe now',
    'please use $agent-evolve safe',
    '$agent-evolve collect',
    '$agent-evolve on',
    '$agent-feedback-loop safe',
    '$Agent-Evolve safe',
    'safe',
    'feedback off',
  ]) {
    assert.equal(parseModeCommand(prompt), null, prompt);
  }
});

test('ordinary prompts stay silent and never touch state even when state paths are unusable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-mode-silent-'));
  const env = { XDG_CONFIG_HOME: path.join(root, 'config') };
  const prompts = [
    'review this code',
    'turn the feature off',
    'use the safe parser',
    'summarize the feedback',
    'please implement $agent-evolve safe behavior in the UI',
  ];

  for (const prompt of prompts) {
    const result = runMode(prompt, 'ordinary-session', env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', prompt);
  }
});

test('session safe and review commands update only the current session and reinject the skill', () => {
  for (const mode of ['safe', 'review'] as const) {
    const env = tempEnv();
    writeDefaultMode('off', env);
    writeSessionMode('current-session', 'off', env);

    const result = runMode(`$agent-evolve ${mode}`, 'current-session', env);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.systemMessage, `Agent Evolve mode: ${mode}; default: off`);
    assert.match(output.hookSpecificOutput.additionalContext, new RegExp(`^AGENT EVOLVE ACTIVE — mode: ${mode}`));
    assert.match(output.hookSpecificOutput.additionalContext, /# Agent Evolve/);
    assert.equal(readSessionMode('current-session', env), mode);
    assert.equal(readDefaultMode(env), 'off');
  }
});

test('session off command disables automatic behavior and preserves manual invocation', () => {
  const env = tempEnv();
  writeSessionMode('current-session', 'safe', env);

  const result = runMode('$agent-evolve off', 'current-session', env);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.systemMessage, 'Agent Evolve mode: off; default: safe');
  assert.match(output.hookSpecificOutput.additionalContext, /AGENT EVOLVE OFF/);
  assert.match(output.hookSpecificOutput.additionalContext, /Manual \$agent-evolve invocation remains available/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /# Agent Evolve/);
  assert.equal(readSessionMode('current-session', env), 'off');
});

test('default commands update only future sessions and keep current session pinned', () => {
  for (const mode of ['safe', 'review', 'off'] as const) {
    const env = tempEnv();
    writeDefaultMode('safe', env);
    writeSessionMode('current-session', 'review', env);

    const result = runMode(`$agent-evolve default ${mode}`, 'current-session', env);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.systemMessage, `Agent Evolve mode: review; default: ${mode}`);
    assert.match(output.hookSpecificOutput.additionalContext, /Current session mode remains: review/);
    assert.equal(readSessionMode('current-session', env), 'review');
    assert.equal(readDefaultMode(env), mode);
    assert.equal(getOrCreateSessionMode('future-session', env), mode);
  }
});

test('default command visibly fails when current session state is missing and preserves default', () => {
  const env = tempEnv();
  writeDefaultMode('review', env);

  const result = runMode('$agent-evolve default off', 'first-prompt-session', env);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
  assert.match(output.hookSpecificOutput.additionalContext, /Current Agent Evolve session state is missing/);
  assert.equal(readSessionMode('first-prompt-session', env), null);
  assert.equal(readDefaultMode(env), 'review');
});

test('different sessions keep independent modes after a command', () => {
  const env = tempEnv();
  writeSessionMode('session-a', 'safe', env);
  writeSessionMode('session-b', 'review', env);

  const result = runMode('$agent-evolve off', 'session-a', env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readSessionMode('session-a', env), 'off');
  assert.equal(readSessionMode('session-b', env), 'review');
});

test('corrupt default state produces visible evidence and does not change session mode', () => {
  const env = tempEnv();
  writeSessionMode('current-session', 'review', env);
  const configPath = path.join(env.XDG_CONFIG_HOME as string, 'codeartz-skills', 'agent-evolve', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{bad json', 'utf8');

  const result = runMode('$agent-evolve safe', 'current-session', env);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
  assert.match(output.hookSpecificOutput.additionalContext, /Invalid Agent Evolve default config/);
  assert.equal(readSessionMode('current-session', env), 'review');
});

test(
  'failed session-state write keeps the previous mode and never claims success',
  { skip: process.platform === 'win32' },
  () => {
    const env = tempEnv();
    writeSessionMode('current-session', 'safe', env);
    const statePath = sessionStatePath('current-session', env);
    fs.chmodSync(path.dirname(statePath), 0o500);

    const result = (() => {
      try {
        return runMode('$agent-evolve review', 'current-session', env);
      } finally {
        fs.chmodSync(path.dirname(statePath), 0o700);
      }
    })();

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
    assert.doesNotMatch(output.systemMessage, /mode: review; default/);
    assert.equal(readSessionMode('current-session', env), 'safe');
  },
);

test(
  'failed default-state write keeps the previous default and current session',
  { skip: process.platform === 'win32' },
  () => {
    const env = tempEnv();
    writeDefaultMode('safe', env);
    writeSessionMode('current-session', 'review', env);
    const configPath = path.join(env.XDG_CONFIG_HOME as string, 'codeartz-skills', 'agent-evolve', 'config.json');
    fs.chmodSync(path.dirname(configPath), 0o500);

    const result = (() => {
      try {
        return runMode('$agent-evolve default off', 'current-session', env);
      } finally {
        fs.chmodSync(path.dirname(configPath), 0o700);
      }
    })();

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.systemMessage, /Agent Evolve failed: mode switch/);
    assert.equal(readDefaultMode(env), 'safe');
    assert.equal(readSessionMode('current-session', env), 'review');
  },
);

test('non-UserPromptSubmit and invalid JSON inputs stay silent', () => {
  const env = tempEnv();
  const wrongEvent = spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      prompt: '$agent-evolve off',
      session_id: 'session',
    }),
  });
  const invalidJson = spawnSync(process.execPath, [modeScript], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: '{bad json',
  });

  assert.equal(wrongEvent.stdout, '');
  assert.equal(invalidJson.stdout, '');
});
