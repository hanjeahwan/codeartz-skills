import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCli } from './run.ts';
import { evaluateChecks, loadScenarios, parseScenario } from './scenarios.ts';

test('五个目标 Skill 都包含有效的冒烟场景和完整场景', async () => {
  const scenarios = await loadScenarios(process.cwd(), undefined, 'all');
  const requestedSkills = [
    'agent-evolve',
    'agentic-design-navigator',
    'instruction-doc-audit',
    'project-foundation',
    'target-boundary',
  ];
  for (const skill of requestedSkills) {
    const skillScenarios = scenarios.filter((scenario) => {
      return scenario.skill === skill;
    });
    assert.ok(skillScenarios.length >= 2);
    assert.deepEqual(
      new Set(
        skillScenarios.map((scenario) => {
          return scenario.tier;
        }),
      ),
      new Set(['smoke', 'full']),
    );
  }
});

test('Agent Evolve 场景覆盖完整的 manual-off 语义矩阵', async () => {
  const scenarios = await loadScenarios(process.cwd(), new Set(['agent-evolve']), 'all');
  assert.deepEqual(
    new Set(
      scenarios.map((scenario) => {
        return scenario.id;
      }),
    ),
    new Set([
      'manual-already-covered',
      'manual-conflict',
      'manual-multiple-candidates',
      'manual-not-persisted',
      'manual-proposal',
      'manual-redaction',
      'manual-unrouted-doc',
    ]),
  );
});

test('项目知识奠基场景覆盖诊断、裁决、批准与合并边界', async () => {
  const scenarios = await loadScenarios(process.cwd(), new Set(['project-foundation']), 'all');
  assert.deepEqual(
    new Set(
      scenarios.map((scenario) => {
        return scenario.id;
      }),
    ),
    new Set([
      'classify-evidence',
      'create-draft',
      'formal-target-conflict',
      'merge-approved-draft',
      'partial-adjudication',
      'refresh-knowledge',
      'reject-ambiguous-approval',
    ]),
  );
});

test('场景解析器拒绝不支持的检查项', () => {
  assert.throws(() => {
    return parseScenario(
      {
        id: 'broken',
        skill: 'broken',
        tier: 'smoke',
        description: 'broken scenario',
        turns: [{ prompt: 'hello', checks: [{ type: 'unknown' }] }],
        criteria: ['must work'],
      },
      'inline',
    );
  }, /unsupported/);
});

test('确定性响应检查会报告证据', async () => {
  const results = await evaluateChecks(
    [
      { type: 'responseIncludes', value: '已确认' },
      { type: 'questionCountAtMost', max: 1 },
      { type: 'fileExcludes', path: 'package.json', value: '不存在的内容' },
    ],
    process.cwd(),
    [{ response: '已确认。下一步是什么？', rawEvents: [], stderr: '', durationMs: 1 }],
    {},
  );
  assert.deepEqual(
    results.map((result) => {
      return result.passed;
    }),
    [true, true, true],
  );
});

test('CLI 默认使用两个真实宿主和冒烟层级', () => {
  const options = parseCli([]);
  assert.deepEqual(options.agents, ['codex', 'claude']);
  assert.equal(options.tier, 'smoke');
  assert.equal(options.judge, undefined);
  assert.equal(options.modelCodex, 'gpt-5.5');
  assert.equal(options.effortCodex, 'medium');
  assert.equal(options.modelClaude, 'sonnet');
  assert.equal(options.effortClaude, 'medium');
});
