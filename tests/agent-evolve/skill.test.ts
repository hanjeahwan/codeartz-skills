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

test('active routes use injected chapters and never reread plugin references', () => {
  const skill = read(skillPath);

  assert.match(skill, /`safe`：[\s\S]*当前上下文已注入的 `# Agent Evolve Workflow` 与 `# Agent Evolve Validation`/);
  assert.match(skill, /`review`：[\s\S]*当前上下文已注入的 `# Agent Evolve Workflow` 与 `# Agent Evolve Validation`/);
  assert.match(skill, /Active route 禁止再次读取 plugin-relative `references\/\*`/);
});

test('manual invocation without an ACTIVE header explicitly routes to manual-off', () => {
  const skill = read(skillPath);
  const workflow = read(workflowPath);

  assert.match(skill, /没有 `AGENT EVOLVE ACTIVE — mode: safe\|review`/);
  assert.match(skill, /进入 `Off mode 的手动调用`/);
  assert.match(
    skill,
    /当前上下文缺少完整章节时，才读取相对 `references\/workflow\.md` 与 `references\/validation\.md`/,
  );
  assert.match(workflow, /只处理用户本次手动指定的 feedback/);
  assert.match(workflow, /用户明确要求写入或批准精确变更时，才进入写入步骤/);
  assert.match(workflow, /写入仍须通过当前上下文中的 `# Agent Evolve Validation` 全部安全门/);
  assert.match(workflow, /用户未明确要求写入或批准精确变更时，只输出精确提案/);
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

test('workflow uses the injected Validation chapter without instructing a file reread', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /当前上下文中的 `# Agent Evolve Validation`/);
  assert.doesNotMatch(workflow, /读取 `?validation\.md`?/);
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
  assert.match(validation, /字段名必须精确使用 `Feedback decision`、`Why`、`Evidence`、`Target` 与 `Change`/);
  assert.match(validation, /禁止翻译、改写或追加括号说明/);
});

test('new skill contains no old runtime protocol or forbidden extra audit', () => {
  const combined = [skillPath, workflowPath, validationPath].map(read).join('\n');

  assert.equal(combined.includes(['agent', 'feedback', 'loop'].join('-')), false);
  assert.equal(combined.includes(['agent', 'feedback', 'state'].join('-')), false);
  assert.doesNotMatch(combined, /instruction-doc-audit/);
  assert.doesNotMatch(combined, /rule-sources\.json/);
});

test('executable rules have one authoritative owner', () => {
  const skill = read(skillPath);
  const workflow = read(workflowPath);
  const validation = read(validationPath);

  // Workflow exclusively owns candidate/source qualification and write operations.
  assert.doesNotMatch(skill, /候选 feedback 必须同时满足/);
  assert.doesNotMatch(skill, /Subagent 产生的观察/);
  assert.doesNotMatch(skill, /没有得到 human 确认的 review finding/);
  assert.doesNotMatch(skill, /找不到唯一 owner 时不随机/);
  assert.doesNotMatch(skill, /用户明确批准后才进入写入步骤/);
  assert.doesNotMatch(skill, /修改前重新读取目标文件/);
  assert.doesNotMatch(skill, /只处理本次显式 feedback/);
  assert.doesNotMatch(skill, /未明确要求写入或批准精确变更时，只输出提案/);
  assert.doesNotMatch(skill, /写入仍须通过 `# Agent Evolve Validation` 的全部安全门/);

  // SKILL exclusively owns model-memory and commit prohibitions.
  assert.doesNotMatch(workflow, /模型记忆/);
  assert.doesNotMatch(workflow, /自动提交 git commit/);

  // Workflow exclusively owns mode decisions, rereads, concurrency, and workspace preservation.
  assert.doesNotMatch(validation, /review\/off 手动流程已经获得 human 明确批准/);
  assert.doesNotMatch(validation, /Mode 是 `review` 且未获批准/);
  assert.doesNotMatch(validation, /重新读取目标文件/);
  assert.doesNotMatch(validation, /并发变化/);
  assert.doesNotMatch(validation, /保留失败前已有的用户工作区改动/);

  // Workflow exclusively owns owner discovery; Validation only consumes its result.
  assert.doesNotMatch(validation, /创建随机规则源/);

  // Validation exclusively owns failure receipts and failure boundaries.
  assert.doesNotMatch(skill, /Feedback 处理失败不得阻止当前用户任务继续完成/);
});
