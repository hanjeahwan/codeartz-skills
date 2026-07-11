import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface PluginManifest {
  hooks?: string;
}

interface HookCommand {
  type?: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

interface HookConfig {
  hooks: Record<string, HookGroup[]>;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

test('Codex and Claude plugin manifests use the shared hook config', () => {
  const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');
  const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('shared hook config contains only SessionStart and UserPromptSubmit', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
});

test('manifest runs the activation and exact-mode scripts on Unix and Windows', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const sessionHook = config.hooks.SessionStart[0].hooks[0];
  const promptHook = config.hooks.UserPromptSubmit[0].hooks[0];

  assert.equal(sessionHook.type, 'command');
  assert.match(sessionHook.command ?? '', /agent-evolve-activate\.js/);
  assert.match(sessionHook.commandWindows ?? '', /agent-evolve-activate\.js/);
  assert.equal(sessionHook.timeout, 5);
  assert.equal(sessionHook.statusMessage, undefined);

  assert.equal(promptHook.type, 'command');
  assert.match(promptHook.command ?? '', /agent-evolve-mode\.js/);
  assert.match(promptHook.commandWindows ?? '', /agent-evolve-mode\.js/);
  assert.equal(promptHook.timeout, 5);
  assert.equal(promptHook.statusMessage, undefined);
});

test('new runtime ships four typed JSDoc hook files', () => {
  const files = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^\/\/ @ts-check\n/);
    assert.match(source, /@typedef/);
    assert.match(source, /@param/);
    assert.match(source, /@returns/);
  }
});

test('old feedback runtime, tests, skill, and plan are absent', () => {
  const legacyHook = ['agent', 'feedback'].join('-');
  const legacySkill = `${legacyHook}-loop`;
  const removed = [
    `hooks/${legacyHook}-capture.js`,
    `hooks/${legacyHook}-stop.js`,
    `hooks/${legacyHook}-runtime.js`,
    `hooks/${legacyHook}-state.js`,
    `skills/${legacySkill}`,
    `tests/${legacyHook}-capture.test.ts`,
    `tests/${legacyHook}-stop.test.ts`,
    `tests/${legacyHook}-state-runtime.test.ts`,
    `tests/${legacyHook}-plugin.test.ts`,
    `tests/${legacyHook}-skill.test.ts`,
    `docs/superpowers/plans/2026-07-09-${legacySkill}.md`,
  ];

  for (const filePath of removed) {
    assert.equal(fs.existsSync(filePath), false, filePath);
  }
});

test('hook source has no feedback classifier or event-state protocol', () => {
  const source = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
  ]
    .map((filePath) => {
      return fs.readFileSync(filePath, 'utf8');
    })
    .join('\n');

  assert.doesNotMatch(source, /classifyPrompt|durable-feedback|pending|attempts|eventPath|stop_hook_active/);
  assert.equal(source.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(source.includes(['AGENT', 'FEEDBACK'].join('-')), false);
});

test('README documents Agent Evolve modes, lifecycle hooks, and commands', () => {
  const readme = fs.readFileSync('README.md', 'utf8');

  assert.match(readme, /Agent Evolve/);
  assert.match(readme, /默认 mode 是 `safe`/);
  assert.match(readme, /\| `safe`/);
  assert.match(readme, /\| `review`/);
  assert.match(readme, /\| `off`/);
  assert.match(readme, /\$agent-evolve default off/);
  assert.match(readme, /SessionStart/);
  assert.match(readme, /UserPromptSubmit/);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
});

test('plugin metadata and README contain no legacy product identifier', () => {
  const legacySkill = ['agent', 'feedback', 'loop'].join('-');
  const legacyHook = ['agent', 'feedback'].join('-');
  const files = [
    'README.md',
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    'hooks/claude-codex-hooks.json',
  ];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content.includes(legacySkill), false, filePath);
    assert.equal(content.includes(legacyHook), false, filePath);
  }
});

test('README references only the renamed Agent Evolve illustration', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const newAsset = 'assets/readme-illustrations/03-agent-evolve.png';
  const legacyAsset = ['assets/readme-illustrations/03-agent', 'feedback', 'loop.png'].join('-');

  assert.equal(fs.existsSync(newAsset), true);
  assert.equal(fs.existsSync(legacyAsset), false);
  assert.match(readme, /03-agent-evolve\.png/);
});
