import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDraft } from '../../skills/project-foundation/scripts/validate-draft.ts';

const validDraft = `# 项目知识草稿

## 检查范围

- 已检查 package.json。

## 建议变更

### 建议 1

- 目标：AGENTS.md
- 动作：创建
- 精确内容：完整内容见最终内容。
- 依据：package.json
- 不确定性：不适用

## 待裁决

不适用

## 最终内容

### AGENTS.md

\`\`\`markdown
# Agent 指南
\`\`\`

### docs/project-foundation-baseline.json

\`\`\`json
{
  "version": 1,
  "sourceCommit": null,
  "knowledgeFiles": ["AGENTS.md"]
}
\`\`\`

## 验证计划

- 重新读取文件。
`;

test('有效草稿通过并返回稳定 SHA-256', () => {
  const first = validateDraft(validDraft);
  const second = validateDraft(validDraft);
  assert.equal(first.status, 'pass');
  assert.match(first.draftSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.draftSha256, second.draftSha256);
});

test('待裁决未解决时拒绝最终正文与 baseline', () => {
  const result = validateDraft(
    validDraft
      .replace('不适用\n\n## 最终内容', '### 范围\n\n- 选择 A 或 B。\n\n## 最终内容')
      .replace('### AGENTS.md', '默认采用 A。\n\n### AGENTS.md'),
  );
  assert.equal(result.status, 'fail');
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'no-pending-decisions';
    })?.status,
    'fail',
  );
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'pending-decision-final-content';
    })?.status,
    'fail',
  );
});

test('拒绝额外一级区块、未闭合围栏与不支持的建议动作', () => {
  const result = validateDraft(
    validDraft
      .replace('## 验证计划', '## 额外结论\n\n内容\n\n## 验证计划')
      .replace('- 动作：创建', '- 动作：保持不变')
      .concat('\n```\n'),
  );
  assert.equal(result.status, 'fail');
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'fixed-headings';
    })?.status,
    'fail',
  );
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'balanced-fences';
    })?.status,
    'fail',
  );
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'allowed-actions';
    })?.status,
    'fail',
  );
});

test('拒绝缺少字段的建议与损坏的 baseline 合同', () => {
  const result = validateDraft(
    validDraft.replace('- 不确定性：不适用\n', '').replace('"version": 1,', '"version": 2,'),
  );
  assert.equal(result.status, 'fail');
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'suggestion-fields';
    })?.status,
    'fail',
  );
  assert.equal(
    result.checks.find((check) => {
      return check.id === 'baseline-contract';
    })?.status,
    'fail',
  );
});
