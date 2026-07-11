import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const skillPath = 'skills/agent-evolve/SKILL.md';
const workflowPath = 'skills/agent-evolve/references/workflow.md';
const validationPath = 'skills/agent-evolve/references/validation.md';

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

test('agent-evolve has the approved name and routes only to workflow and validation', () => {
  const skill = read(skillPath);

  assert.match(skill, /^---\nname: agent-evolve\n/);
  assert.match(skill, /references\/workflow\.md/);
  assert.match(skill, /references\/validation\.md/);
  assert.doesNotMatch(skill, /source-discovery/);
  assert.equal(fs.existsSync('skills/agent-evolve/references/source-discovery.md'), false);
});

test('SKILL contains only triggers, mode routing, global boundaries, and prohibitions', () => {
  const skill = read(skillPath);

  assert.match(skill, /## 触发条件/);
  assert.match(skill, /## Mode 路由/);
  assert.match(skill, /## 全局边界/);
  assert.match(skill, /## 禁止动作/);
  assert.doesNotMatch(skill, /## 落点发现/);
  assert.doesNotMatch(skill, /Feedback decision: Updated/);
  assert.doesNotMatch(skill, /rg --files/);
});

test('workflow recognizes only direct human feedback without trigger-word dependence', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /直接来自 human/);
  assert.match(workflow, /不要求 human 使用“以后”“记住”“不要再”或“写进规则”/);
  assert.match(workflow, /普通问题/);
  assert.match(workflow, /单次任务需求/);
  assert.match(workflow, /只适用于当前文件的一次性选择/);
  assert.match(workflow, /Subagent 产生的观察/);
  assert.match(workflow, /Agent 自己的总结或建议/);
  assert.match(workflow, /没有得到 human 确认的 review finding/);
  assert.match(workflow, /mode 控制命令/);
});

test('workflow owns target discovery, duplicate/conflict checks, and future-read proof', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /## 落点发现/);
  assert.match(workflow, /用户明确指定的位置/);
  assert.match(workflow, /AGENTS\.md/);
  assert.match(workflow, /CLAUDE\.md/);
  assert.match(workflow, /未来 agent/);
  assert.match(workflow, /自动加载/);
  assert.match(workflow, /现有项目指令路由/);
  assert.match(workflow, /禁止把 grep 命中直接当成 owner/);
  assert.match(workflow, /重复时不追加第二份规则/);
  assert.match(workflow, /冲突时不覆盖旧规则/);
  assert.match(workflow, /修改前重新读取目标文件/);
  assert.match(workflow, /验证实际 diff/);
});

test('workflow routes safe, review, and manual-off behavior without hook event state', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /### Safe mode/);
  assert.match(workflow, /### Review mode/);
  assert.match(workflow, /### Off mode 的手动调用/);
  assert.match(workflow, /用户明确批准后/);
  assert.doesNotMatch(workflow, /eventPath|attempts|mark <eventPath>|pending event/);
});

test('validation owns safety gates, redaction, and per-candidate receipts', () => {
  const validation = read(validationPath);

  assert.match(validation, /## 安全门/);
  assert.match(validation, /唯一 owner/);
  assert.match(validation, /未来 agent 读取路径证据/);
  assert.match(validation, /敏感内容/);
  assert.match(validation, /密钥/);
  assert.match(validation, /私有 URL/);
  assert.match(validation, /邮箱/);
  assert.match(validation, /客户名/);
  assert.match(validation, /ticket/);
  assert.match(validation, /事故细节/);
  assert.match(validation, /每条候选分别输出/);
  assert.match(validation, /Decision/);
  assert.match(validation, /Why/);
  assert.match(validation, /Evidence/);
  assert.match(validation, /Target/);
  assert.match(validation, /Change/);
});

test('validation defines all five decisions and explicit not-applicable fields', () => {
  const validation = read(validationPath);

  for (const decision of ['Updated', 'Already covered', 'Proposed', 'Not persisted', 'Failed']) {
    assert.match(validation, new RegExp(`Feedback decision: ${decision}`));
  }
  assert.match(validation, /Target: 不适用/);
  assert.match(validation, /Change: 不适用/);
  assert.match(validation, /同一轮存在多条 feedback 候选时/);
});

test('new skill contains no old runtime protocol or forbidden extra audit', () => {
  const combined = [skillPath, workflowPath, validationPath].map(read).join('\n');

  assert.equal(combined.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(combined.includes(['agent', 'feedback', 'state'].join('-')), false);
  assert.doesNotMatch(combined, /instruction-doc-audit/);
  assert.doesNotMatch(combined, /rule-sources\.json/);
});
