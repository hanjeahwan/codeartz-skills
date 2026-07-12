import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const bumpScript = path.resolve('scripts/bump-version.ts');

test('staged skill changes bump patch once and new skills bump minor', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'codeartz-bump-'));
  const git = (...args: string[]) => {return execFileSync('git', args, { cwd })};
  const bump = () => {return execFileSync(process.execPath, [bumpScript, 'auto'], { cwd })};
  const version = () => {
    return JSON.parse(readFileSync(path.join(cwd, '.codex-plugin/plugin.json'), 'utf8')).version;
  };

  mkdirSync(path.join(cwd, '.claude-plugin'));
  mkdirSync(path.join(cwd, '.codex-plugin'));
  mkdirSync(path.join(cwd, 'skills/existing'), { recursive: true });
  writeFileSync(path.join(cwd, '.claude-plugin/plugin.json'), '{"version":"0.2.10"}\n');
  writeFileSync(path.join(cwd, '.codex-plugin/plugin.json'), '{"version":"0.2.10"}\n');
  writeFileSync(path.join(cwd, 'skills/existing/SKILL.md'), 'before\n');
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('add', '.');
  git('commit', '-qm', 'initial');

  mkdirSync(path.join(cwd, 'assets'));
  writeFileSync(path.join(cwd, 'assets/icon.png'), 'changed');
  git('add', '.');
  bump();
  assert.equal(version(), '0.2.10');
  git('reset', '-q', 'HEAD', '--', 'assets/icon.png');

  writeFileSync(path.join(cwd, 'skills/existing/SKILL.md'), 'after\n');
  git('add', '.');
  bump();
  assert.equal(version(), '0.2.11');
  bump();
  assert.equal(version(), '0.2.11');
  git('commit', '-qm', 'patch');

  mkdirSync(path.join(cwd, 'skills/new'));
  writeFileSync(path.join(cwd, 'skills/new/SKILL.md'), 'new\n');
  git('add', '.');
  bump();
  assert.equal(version(), '0.3.0');
});
