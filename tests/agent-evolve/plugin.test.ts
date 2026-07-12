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

test('共用 hook 配置包含 SessionStart、UserPromptSubmit 与 PreToolUse', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['PreToolUse', 'SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.PreToolUse.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
  assert.equal(config.hooks.PreToolUse[0].matcher, 'Read|Bash');
});

test('manifest 在 Unix 与 Windows 运行 activation、mode 与 reference access 脚本', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const sessionHook = config.hooks.SessionStart[0].hooks[0];
  const promptHook = config.hooks.UserPromptSubmit[0].hooks[0];
  const accessHook = config.hooks.PreToolUse[0].hooks[0];

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
    'hooks/agent-evolve-activate-runtime.js',
    'hooks/agent-evolve-mode-runtime.js',
  ]
    .map((filePath) => {
      return fs.readFileSync(filePath, 'utf8');
    })
    .join('\n');

  assert.doesNotMatch(source, /classifyPrompt|durable-feedback|pending|attempts|eventPath|stop_hook_active/);
  assert.equal(source.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(source.includes(['AGENT', 'FEEDBACK'].join('-')), false);
});

test('Agent Evolve 按触发、工作流、安全验证三阶段延迟读取', () => {
  const skill = fs.readFileSync('skills/agent-evolve/SKILL.md', 'utf8');
  const workflow = fs.readFileSync('skills/agent-evolve/references/workflow.md', 'utf8');
  const activation = fs.readFileSync('hooks/agent-evolve-runtime.js', 'utf8');

  assert.match(activation, /普通请求禁止加载/);
  assert.doesNotMatch(activation, /# Agent Evolve 工作流|# Agent Evolve 安全验证/);
  assert.match(skill, /读取相对 `references\/workflow\.md`/);
  assert.match(skill, /禁止预读 `references\/validation\.md`/);
  assert.match(workflow, /进入安全验证阶段时，读取相对 `validation\.md`/);
});

test('plugin metadata 不包含旧产品标识', () => {
  const legacySkill = ['agent', 'feedback', 'loop'].join('-');
  const legacyHook = ['agent', 'feedback'].join('-');
  const files = [
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
