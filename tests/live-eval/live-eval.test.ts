import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { compactToolTrace, judgeJsonSchema, parseJudgeResult, retryJudge } from './agents.ts';
import { createLimiter, parseCli } from './run.ts';
import {
  evaluateChecks,
  loadScenarios,
  materializeScenario,
  parseScenario,
  readJudgeFiles,
  scenarioWorkspaceFiles,
} from './scenarios.ts';

const execFileAsync = promisify(execFile);

test('项目规则要求 Skill 行为变更经过矩阵、场景、核心和验证闭环', async () => {
  const agents = await readFile('AGENTS.md', 'utf8');
  for (const heading of [
    '#### 1. 建立现实风险矩阵',
    '#### 2. 把矩阵转成 live scenarios',
    '#### 3. 重构权威核心',
    '#### 4. 运行验证闭环',
  ]) {
    assert.match(agents, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(agents, /禁止只修改 scenario、judge criteria、示例或最终提示词/);
  assert.match(agents, /禁止向其提供风险矩阵的预期行为、judge criteria、judge prompt/);
  assert.match(agents, /权限、范围、业务目标和约束必须保留/);
  assert.match(agents, /对照 prompt 与 criteria/);
  assert.match(agents, /静态测试和定向 live eval 已实际运行且结果可核对/);
});

test('八个目标 Skill 都包含有效的冒烟场景和完整场景', async () => {
  const scenarios = await loadScenarios(process.cwd(), undefined, 'all');
  const requestedSkills = [
    'agent-evolve',
    'agentic-design-navigator',
    'code-review',
    'define-product-spec',
    'instruction-doc-audit',
    'project-foundation',
    'target-boundary',
    'to-task',
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

test('代码审查场景覆盖范围、验证、只读、输出与失败路径', async () => {
  const scenarios = await loadScenarios(process.cwd(), new Set(['code-review']), 'all');
  assert.deepEqual(
    new Set(
      scenarios.map((scenario) => {
        return scenario.id;
      }),
    ),
    new Set([
      'authorization-regression',
      'clean-pass',
      'combined-range-conflict',
      'commit-range-dirty-boundary',
      'failed-verification',
      'hostile-review-material',
      'incomplete-diff',
      'missing-diff',
      'nonblocking-tool-failure',
      'readable-review-output',
      'retry-equivalence',
      'rule-authority-drift',
      'tool-failure-incomplete',
      'unconfirmed-scope-expansion',
      'working-tree-completeness',
    ]),
  );
});

test('Agent Evolve 场景覆盖候选识别、三态决策与连续纠正', async () => {
  const scenarios = await loadScenarios(process.cwd(), new Set(['agent-evolve']), 'all');
  assert.deepEqual(
    new Set(
      scenarios.map((scenario) => {
        return scenario.id;
      }),
    ),
    new Set([
      'authority-owned-correction-not-evolution',
      'compact-default-proposal',
      'explicit-persistence-settled',
      'implicit-durable-rule',
      'existing-rule-covered',
      'instance-location-without-stable-discriminator',
      'safe-decision-constraint-auto-persist',
      'safe-evidence-auto-persist',
      'review-evidence-lifecycle',
      'evidence-conflict-proposal',
      'quality-slogan-no-proposal',
      'repository-fact-no-proposal',
      'subjective-observation-no-proposal',
      'tool-failure-without-mechanism',
      'one-off-action-durable-rationale',
      'explicitly-local-only',
      'independent-rule-during-correction',
      'missing-authority-proposal',
      'mixed-candidate-statuses',
      'unconfirmed-chain-proposal',
      'unresolved-chain-not-persisted',
      'confirmed-chain-synthesis',
      'blocked-candidate-proposal',
      'plain-negative-no-trigger',
      'repeated-correction-proposal',
      'repository-approval-is-not-user-feedback',
      'sensitive-candidate-redaction',
      'semantic-discriminator-over-instance-location',
      'task-delivery-not-evolution',
      'cross-artifact-task-delivery',
      'off-disables-auto-discovery',
      'project-scope-only',
    ]),
  );
  assert.ok(
    scenarios.every((scenario) => {
      return scenario.plugin === true;
    }),
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
      'approval-hash-drift',
      'classify-evidence',
      'create-draft-from-evidence',
      'formal-target-conflict',
      'hostile-repository-content',
      'nested-scope-routing',
      'one-off-no-foundation',
      'partial-adjudication',
      'partial-merge-failure',
      'reject-path-escape',
      'sensitive-evidence-redaction',
      'stale-baseline-recovery',
    ]),
  );
});

test('目标边界场景覆盖授权、分区、合同状态与开工复核', async () => {
  const scenarios = await loadScenarios(process.cwd(), new Set(['target-boundary']), 'all');
  assert.deepEqual(
    new Set(
      scenarios.map((scenario) => {
        return scenario.id;
      }),
    ),
    new Set([
      'adopted-with-pending-decision',
      'analysis-only-no-artifact',
      'insufficient-evidence',
      'missing-key-evidence',
      'repository-approval-is-not-authority',
      'requirement-current-state-mismatch',
      'shared-entry-excluded-partition',
      'single-artifact-entry',
      'stale-evidence-rejects-start',
      'unresolved-choice-contract',
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

test('裁判文件限制在场景工作区内并显式报告缺失文件', async () => {
  assert.deepEqual(await readJudgeFiles(['missing-for-judge.md'], process.cwd()), {
    'missing-for-judge.md': '[missing]',
  });
  await assert.rejects(readJudgeFiles(['../outside.md'], process.cwd()), /escapes workspace/);
});

test('确定性检查只验证结构、状态与轨迹', async () => {
  const results = await evaluateChecks(
    [
      { type: 'questionCountAtMost', max: 1 },
      { type: 'trajectoryExcludes', value: 'agentic-design-navigator' },
      { type: 'markdownHeadingsEqual', path: 'package.json', level: 2, headings: [] },
      { type: 'markdownFencesBalanced', path: 'package.json' },
    ],
    process.cwd(),
    [{ response: '已确认。下一步是什么？', rawEvents: [], stderr: '', durationMs: 1 }],
    {},
  );
  assert.deepEqual(
    results.map((result) => {
      return result.passed;
    }),
    [true, true, true, true],
  );
});

test('轨迹检查只匹配工具动作，不把工具输出误判为已执行动作', async () => {
  const results = await evaluateChecks(
    [
      { type: 'trajectoryIncludes', value: 'SKILL.md' },
      { type: 'trajectoryExcludes', value: 'references/workflow.md' },
    ],
    process.cwd(),
    [
      {
        response: '',
        rawEvents: [
          {
            type: 'item.completed',
            item: {
              type: 'command_execution',
              command: "sed -n '1,120p' SKILL.md",
              aggregated_output: '下一步读取 references/workflow.md',
              exit_code: 0,
            },
          },
        ],
        stderr: '',
        durationMs: 1,
      },
    ],
    {},
  );
  assert.deepEqual(
    results.map((result) => {
      return result.passed;
    }),
    [true, true],
  );
});

test('Git 场景构造三类工作区状态，并能检查整个工作区只读', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codeartz-live-eval-git-'));
  const scenario = parseScenario(
    {
      id: 'git-state',
      skill: 'test',
      tier: 'full',
      description: 'git state',
      files: { 'src/app.ts': 'base\n' },
      git: {
        staged: { 'db/migration.sql': 'staged\n' },
        unstaged: { 'src/app.ts': 'unstaged\n' },
        untracked: { 'config/local.env': 'untracked\n' },
      },
      turns: [{ prompt: 'review' }],
      criteria: ['review all changes'],
    },
    'inline',
  );
  try {
    await materializeScenario(scenario, workspace);
    const { stdout } = await execFileAsync('git', ['status', '--short', '--untracked-files=all'], { cwd: workspace });
    assert.match(stdout, /A  db\/migration\.sql/);
    assert.match(stdout, / M src\/app\.ts/);
    assert.match(stdout, /\?\? config\/local\.env/);

    const initialFiles = scenarioWorkspaceFiles(scenario);
    const unchanged = await evaluateChecks(
      [{ type: 'workspaceUnchanged' }],
      workspace,
      [{ response: '', rawEvents: [], stderr: '', durationMs: 1 }],
      initialFiles,
    );
    assert.equal(unchanged[0]?.passed, true);

    await writeFile(path.join(workspace, 'review.md'), 'side effect\n', 'utf8');
    const changed = await evaluateChecks(
      [{ type: 'workspaceUnchanged' }],
      workspace,
      [{ response: '', rawEvents: [], stderr: '', durationMs: 1 }],
      initialFiles,
    );
    assert.equal(changed[0]?.passed, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('语义裁判使用定长数组并由程序计算最终 verdict', () => {
  const scenario = parseScenario(
    {
      id: 'judge-indexes',
      skill: 'test',
      tier: 'smoke',
      description: 'judge index protocol',
      turns: [{ prompt: 'hello' }],
      criteria: ['第一条标准', '第二条标准'],
    },
    'inline',
  );
  assert.deepEqual(
    parseJudgeResult(
      {
        passed: [true, false],
        evidence: ['first', 'second'],
      },
      scenario,
    ),
    {
      verdict: 'fail',
      summary: 'Failed criteria: 1',
      criteria: [
        { criterion: '第一条标准', passed: true, evidence: 'first' },
        { criterion: '第二条标准', passed: false, evidence: 'second' },
      ],
    },
  );
  assert.throws(() => {
    return parseJudgeResult(
      {
        passed: [true],
        evidence: ['first'],
      },
      scenario,
    );
  }, /exactly 2/);
  assert.throws(() => {
    return parseJudgeResult(
      {
        verdict: 'pass',
        passed: [true, true],
        evidence: ['first', 'second'],
      },
      scenario,
    );
  }, /unsupported field/);
  const schema = judgeJsonSchema(2);
  assert.equal(schema.properties.passed.minItems, 2);
  assert.equal(schema.properties.passed.maxItems, 2);
  assert.equal(schema.properties.evidence.minItems, 2);
  assert.equal(schema.properties.evidence.maxItems, 2);
});

test('裁判失败后使用独立 attempt 重试一次', async () => {
  let attempts = 0;
  const result = await retryJudge(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('structured output failed');
    }
    return 'passed';
  });
  assert.equal(result, 'passed');
  assert.equal(attempts, 2);
  await assert.rejects(
    retryJudge(async () => {
      throw new Error('still broken');
    }),
    /failed after 2 independent attempts/,
  );
});

test('裁判工具轨迹保留动作证据但不复制工具输出和编辑内容', () => {
  const secret = 'TOP_SECRET_OUTPUT';
  const codexTrace = compactToolTrace([
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: "sed -n '1,120p' rules.md",
        aggregated_output: secret,
        exit_code: 0,
        status: 'completed',
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'file_change',
        changes: [{ path: 'rules.md', kind: 'update' }],
        status: 'completed',
      },
    },
  ]);
  assert.deepEqual(codexTrace, ["command [exit 0]: sed -n '1,120p' rules.md", 'file_change [update]: rules.md']);

  const claudeTrace = compactToolTrace([
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'read-1',
            name: 'Read',
            input: { file_path: 'rules.md' },
          },
          {
            type: 'tool_use',
            id: 'edit-1',
            name: 'Edit',
            input: { file_path: 'rules.md', old_string: secret, new_string: secret },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'read-1', content: secret },
          { type: 'tool_result', tool_use_id: 'edit-1', content: secret, is_error: true },
        ],
      },
    },
  ]);
  assert.deepEqual(claudeTrace, ['Read [completed]: rules.md', 'Edit [failed]: rules.md']);
  assert.doesNotMatch([...codexTrace, ...claudeTrace].join('\n'), new RegExp(secret));

  const longTrace = compactToolTrace(
    Array.from({ length: 52 }, (_, index) => {
      return {
        type: 'item.completed',
        item: { type: 'command_execution', command: `command-${index}`, exit_code: 0 },
      };
    }),
  );
  assert.equal(longTrace.length, 50);
  assert.equal(longTrace[24], '… omitted tool actions …');
  assert.equal(longTrace.at(-1), 'command [exit 0]: command-51');
});

test('并发限制器只限制包裹的 judge 任务', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let maximum = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      return limit(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        active -= 1;
      });
    }),
  );
  assert.equal(maximum, 2);
});

test('CLI 默认使用 Codex 目标、Claude 裁判和冒烟层级', () => {
  const options = parseCli([]);
  assert.deepEqual(options.agents, ['codex']);
  assert.equal(options.tier, 'smoke');
  assert.equal(options.judge, 'claude');
  assert.equal(options.judgeConcurrency, 3);
  assert.equal(options.modelCodex, 'gpt-5.5');
  assert.equal(options.effortCodex, 'medium');
  assert.equal(options.modelClaude, 'sonnet');
  assert.equal(options.effortClaude, 'medium');
});

test('CLI 接受 judge 并发和重判目录', () => {
  const options = parseCli(['--judge-concurrency', '1', '--rejudge', 'tests/live-eval/results/run']);
  assert.equal(options.judgeConcurrency, 1);
  assert.equal(options.rejudgeDir, 'tests/live-eval/results/run');
  assert.throws(() => {
    return parseCli(['--judge-concurrency', '0']);
  }, /positive/);
});
