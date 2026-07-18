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

test('共用 hook 配置包含 SessionStart、UserPromptSubmit 与 PermissionRequest', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['PermissionRequest', 'SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.PermissionRequest.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
  assert.equal(config.hooks.PermissionRequest[0].matcher, 'Read|Bash');
});

test('manifest 在 Unix 与 Windows 运行 activation、mode 与 reference access 脚本', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const sessionHook = config.hooks.SessionStart[0].hooks[0];
  const promptHook = config.hooks.UserPromptSubmit[0].hooks[0];
  const accessHook = config.hooks.PermissionRequest[0].hooks[0];

  assert.equal(sessionHook.type, 'command');
  assert.match(sessionHook.command ?? '', /agent-evolve-activate\.js/);
  assert.doesNotMatch(sessionHook.command ?? '', /^exec\s/);
  assert.match(sessionHook.commandWindows ?? '', /agent-evolve-activate\.js/);
  assert.equal(sessionHook.timeout, 5);
  assert.equal(sessionHook.statusMessage, '正在加载 Agent Evolve 模式...');

  assert.equal(promptHook.type, 'command');
  assert.match(promptHook.command ?? '', /agent-evolve-mode\.js/);
  assert.doesNotMatch(promptHook.command ?? '', /^exec\s/);
  assert.match(promptHook.commandWindows ?? '', /agent-evolve-mode\.js/);
  assert.equal(promptHook.timeout, 5);
  assert.equal(promptHook.statusMessage, '正在更新 Agent Evolve 模式...');

  assert.equal(accessHook.type, 'command');
  assert.match(accessHook.command ?? '', /agent-evolve-reference-access\.js/);
  assert.match(accessHook.commandWindows ?? '', /agent-evolve-reference-access\.js/);
  assert.equal(accessHook.timeout, 5);
  assert.equal(accessHook.statusMessage, '正在检查 Agent Evolve 阶段手册访问权限...');
});

test('新 runtime 提供薄入口与五个带类型 JSDoc 的逻辑文件', () => {
  const files = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate-runtime.js',
    'hooks/agent-evolve-mode-runtime.js',
    'hooks/agent-evolve-reference-access-runtime.js',
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^\/\/ @ts-check\n/);
    assert.match(source, /@typedef/);
    assert.match(source, /@param/);
    assert.match(source, /@returns/);
  }
});

test('三个可执行 hook 在顶层无条件调用 runtime main', () => {
  for (const filePath of [
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
    'hooks/agent-evolve-reference-access.js',
  ]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env node\n/, filePath);
    assert.match(source, /import \{ main \} from '.\/agent-evolve-.+-runtime\.js';/, filePath);
    assert.match(source, /main\(\)\.catch/, filePath);
    assert.doesNotMatch(source, /import\.meta|process\.argv|realpathSync/, filePath);
  }
});
