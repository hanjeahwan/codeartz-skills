import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const skillPath = 'skills/agent-feedback-loop/SKILL.md';
const workflowPath = 'skills/agent-feedback-loop/references/workflow.md';
const sourcePath = 'skills/agent-feedback-loop/references/source-discovery.md';
const validationPath = 'skills/agent-feedback-loop/references/validation.md';

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

test('agent-feedback-loop Skill 包含必要的 frontmatter 和参考资料路由', () => {
  const skill = read(skillPath);
  assert.match(skill, /^---\nname: agent-feedback-loop\n/);
  assert.match(skill, /description: .+feedback.+长期规则源/s);
  assert.match(skill, /references\/workflow\.md/);
  assert.match(skill, /references\/source-discovery\.md/);
  assert.match(skill, /references\/validation\.md/);
});

test('Skill 不会引入持久化的所有权注册表', () => {
  const combined = [skillPath, workflowPath, sourcePath, validationPath].map(read).join('\n');
  assert.doesNotMatch(combined, /rule-sources\.json/);
  assert.doesNotMatch(combined, /source registry/i);
});

test('来源发现优先检查已知来源，再使用 grep 兜底', () => {
  const source = read(sourcePath);
  assert.match(source, /已知长期规则源优先/);
  assert.match(source, /结构探测/);
  assert.match(source, /\.codex-plugin\/plugin\.json/);
  assert.match(source, /skills\/\*\*\/SKILL\.md/);
  assert.match(source, /只有确认存在 skill\/plugin 结构后，才进入 `skills\/\*\*` 和 plugin path 分支。/);
  assert.match(source, /grep 兜底/);
  assert.match(source, /禁止.*全库.*默认扫描/);
  assert.match(source, /重复时合并，不追加第二份/);
  assert.match(source, /冲突时输出冲突位置/);
});

test('验证手册定义事件路径合同、隐私关卡和事件状态标记', () => {
  const validation = read(validationPath);
  assert.match(validation, /Event path: <path>/);
  assert.match(validation, /mark <eventPath>/);
  assert.match(validation, /blocked/);
  assert.match(validation, /长期规则禁止保存/);
  assert.match(validation, /私有 URL/);
  assert.match(validation, /Updated:/);
  assert.match(validation, /Proposed target:/);
  assert.match(validation, /No durable update made/);
  assert.match(validation, /agent-feedback-state\.js mark/);
});
