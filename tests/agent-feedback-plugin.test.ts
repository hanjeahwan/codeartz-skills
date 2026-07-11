import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface PluginManifest {
  hooks?: string;
}

interface HookCommand {
  command?: string;
  commandWindows?: string;
}

interface HookGroup {
  hooks: HookCommand[];
}

interface HookConfig {
  hooks: Record<string, HookGroup[]>;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

test('Codex 和 Claude 插件清单指向共享的反馈 Hook', () => {
  const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');
  const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('共享 Hook 配置引用随插件提供的捕获与停止脚本', () => {
  const hooks = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const commands = Object.values(hooks.hooks)
    .flat()
    .flatMap((group) => {
      return group.hooks;
    })
    .flatMap((hook) => {
      return [hook.command, hook.commandWindows].filter((command): command is string => {
        return Boolean(command);
      });
    });

  assert.ok(
    commands.some((command) => {
      return command.includes('agent-feedback-capture.js');
    }),
  );
  assert.ok(
    commands.some((command) => {
      return command.includes('agent-feedback-stop.js');
    }),
  );

  assert.ok(fs.existsSync('hooks/agent-feedback-capture.js'));
  assert.ok(fs.existsSync('hooks/agent-feedback-stop.js'));
});

test('README 说明 agent-feedback-loop 和 Hook 信任设置', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /agent-feedback-loop/);
  assert.match(readme, /\/hooks/);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
});
