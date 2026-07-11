import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  defaultConfigPath,
  getOrCreateSessionMode,
  hashSessionId,
  readDefaultMode,
  readSessionMode,
  sessionStatePath,
  writeDefaultMode,
  writeSessionMode,
} from '../hooks/agent-evolve-state.js';

function tempRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function codexEnv(root: string): NodeJS.ProcessEnv {
  return {
    PLUGIN_DATA: path.join(root, 'codex-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
  };
}

test('defaultConfigPath follows Unix and Windows contracts', () => {
  assert.equal(
    defaultConfigPath({ XDG_CONFIG_HOME: '/tmp/xdg' }, 'darwin', '/Users/tester'),
    '/tmp/xdg/codeartz-skills/agent-evolve/config.json',
  );
  assert.equal(
    defaultConfigPath({}, 'linux', '/home/tester'),
    '/home/tester/.config/codeartz-skills/agent-evolve/config.json',
  );
  assert.equal(
    defaultConfigPath({ APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'win32', 'C:\\Users\\tester'),
    'C:\\Users\\tester\\AppData\\Roaming\\codeartz-skills\\agent-evolve\\config.json',
  );
  assert.throws(() => {
    return defaultConfigPath({}, 'win32', 'C:\\Users\\tester');
  }, /APPDATA is required/);
});

test('missing default config resolves to built-in safe and valid config round-trips', () => {
  const root = tempRoot('agent-evolve-default');
  const env = codexEnv(root);

  assert.equal(readDefaultMode(env), 'safe');
  writeDefaultMode('review', env);
  assert.equal(readDefaultMode(env), 'review');
  assert.deepEqual(JSON.parse(fs.readFileSync(defaultConfigPath(env), 'utf8')), {
    defaultMode: 'review',
  });
});

test('default config rejects corrupt JSON, unsupported modes, and extra fields', () => {
  const root = tempRoot('agent-evolve-invalid-default');
  const env = codexEnv(root);
  const configPath = defaultConfigPath(env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  fs.writeFileSync(configPath, '{bad json', 'utf8');
  assert.throws(() => {
    return readDefaultMode(env);
  }, /Invalid Agent Evolve default config/);

  fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'collect' }), 'utf8');
  assert.throws(() => {
    return readDefaultMode(env);
  }, /Invalid Agent Evolve default config/);

  fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'safe', enabled: true }), 'utf8');
  assert.throws(() => {
    return readDefaultMode(env);
  }, /Invalid Agent Evolve default config/);
});

test('unreadable default config path fails instead of guessing safe', () => {
  const root = tempRoot('agent-evolve-unreadable-default');
  const configRoot = path.join(root, 'config-as-file');
  fs.writeFileSync(configRoot, 'not a directory', 'utf8');

  assert.throws(() => {
    return readDefaultMode({ XDG_CONFIG_HOME: configRoot });
  }, /Unable to read Agent Evolve default config/);
});

test('session paths use the full SHA-256 and never persist the raw session id', () => {
  const root = tempRoot('agent-evolve-hash');
  const env = codexEnv(root);
  const sessionId = 'private/session:id@example.com';
  const digest = hashSessionId(sessionId);
  const statePath = sessionStatePath(sessionId, env);

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(path.basename(statePath), `${digest}.json`);
  assert.doesNotMatch(path.basename(statePath), /private|session|example/);

  writeSessionMode(sessionId, 'review', env, () => {
    return new Date('2026-07-10T00:00:00.000Z');
  });
  const raw = fs.readFileSync(statePath, 'utf8');
  assert.doesNotMatch(raw, /private|session:id|example\.com/);
  assert.deepEqual(JSON.parse(raw), {
    mode: 'review',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
});

test('Codex and Claude Code session state use their own plugin data roots', () => {
  const root = tempRoot('agent-evolve-hosts');
  const codexPath = sessionStatePath('same-session', {
    PLUGIN_DATA: path.join(root, 'codex'),
  });
  const claudePath = sessionStatePath('same-session', {
    CLAUDE_PLUGIN_DATA: path.join(root, 'claude'),
  });

  assert.match(codexPath, /codex[/\\]agent-evolve[/\\]sessions/);
  assert.match(claudePath, /claude[/\\]agent-evolve[/\\]sessions/);
  assert.notEqual(codexPath, claudePath);
  assert.throws(() => {
    return sessionStatePath('session', {});
  }, /plugin data directory is unavailable/);
});

test('getOrCreateSessionMode pins the effective default once per session', () => {
  const root = tempRoot('agent-evolve-pin');
  const env = codexEnv(root);

  writeDefaultMode('review', env);
  assert.equal(
    getOrCreateSessionMode('session-a', env, () => {
      return new Date('2026-07-10T01:00:00.000Z');
    }),
    'review',
  );

  writeDefaultMode('off', env);
  assert.equal(getOrCreateSessionMode('session-a', env), 'review');
  assert.equal(getOrCreateSessionMode('session-b', env), 'off');
});

test('different session ids have isolated modes', () => {
  const root = tempRoot('agent-evolve-isolation');
  const env = codexEnv(root);

  writeSessionMode('session-a', 'safe', env);
  writeSessionMode('session-b', 'review', env);

  assert.equal(readSessionMode('session-a', env), 'safe');
  assert.equal(readSessionMode('session-b', env), 'review');
});

test('session state rejects corrupt JSON, invalid timestamps, and extra fields', () => {
  const root = tempRoot('agent-evolve-invalid-session');
  const env = codexEnv(root);
  const statePath = sessionStatePath('session-a', env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  fs.writeFileSync(statePath, '{bad json', 'utf8');
  assert.throws(() => {
    return readSessionMode('session-a', env);
  }, /Invalid Agent Evolve session state/);

  fs.writeFileSync(statePath, JSON.stringify({ mode: 'safe', updatedAt: 'yesterday' }), 'utf8');
  assert.throws(() => {
    return readSessionMode('session-a', env);
  }, /Invalid Agent Evolve session state/);

  fs.writeFileSync(
    statePath,
    JSON.stringify({ mode: 'safe', updatedAt: '2026-07-10T00:00:00.000Z', prompt: 'secret' }),
    'utf8',
  );
  assert.throws(() => {
    return readSessionMode('session-a', env);
  }, /Invalid Agent Evolve session state/);
});

test('failed atomic session write preserves the previous state', { skip: process.platform === 'win32' }, () => {
  const root = tempRoot('agent-evolve-atomic');
  const env = codexEnv(root);
  const statePath = sessionStatePath('session-a', env);

  writeSessionMode('session-a', 'safe', env);
  fs.chmodSync(path.dirname(statePath), 0o500);
  try {
    assert.throws(() => {
      return writeSessionMode('session-a', 'review', env);
    }, /Unable to write Agent Evolve state/);
  } finally {
    fs.chmodSync(path.dirname(statePath), 0o700);
  }

  assert.equal(readSessionMode('session-a', env), 'safe');
});
