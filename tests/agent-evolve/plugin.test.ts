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

test('Codex 与 Claude plugin manifest 使用共用 hook 配置', () => {
  const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');
  const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('共用 hook 配置只包含 SessionStart 与 UserPromptSubmit', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
});

test('manifest 在 Unix 与 Windows 运行 activation 和精确 mode 脚本', () => {
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

test('新 runtime 提供四个带类型 JSDoc 的 hook 文件', () => {
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

test('旧 feedback runtime、tests、skill 与 plan 均不存在', () => {
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

test('hook 源码不包含 feedback classifier 或 event-state 协议', () => {
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

test('README 说明 Agent Evolve mode、lifecycle hook 与命令', () => {
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

test('plugin metadata 与 README 不包含旧产品标识', () => {
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

test('README 只引用重命名后的 Agent Evolve 插图', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const newAsset = 'assets/readme-illustrations/03-agent-evolve.png';
  const legacyAsset = ['assets/readme-illustrations/03-agent', 'feedback', 'loop.png'].join('-');

  assert.equal(fs.existsSync(newAsset), true);
  assert.equal(fs.existsSync(legacyAsset), false);
  assert.match(readme, /03-agent-evolve\.png/);
});
