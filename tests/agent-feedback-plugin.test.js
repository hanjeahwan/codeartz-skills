import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

test('Codex and Claude plugin manifests point at the shared feedback hooks', () => {
  const codex = readJson('.codex-plugin/plugin.json');
  const claude = readJson('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('shared hook config references shipped capture and stop scripts', () => {
  const hooks = readJson('hooks/claude-codex-hooks.json');
  const commands = Object.values(hooks.hooks)
    .flat()
    .flatMap((group) => {
      return group.hooks;
    })
    .flatMap((hook) => {
      return [hook.command, hook.commandWindows].filter(Boolean);
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

test('README documents agent-feedback-loop and hook trust setup', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /agent-feedback-loop/);
  assert.match(readme, /\/hooks/);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Codex/);
});
