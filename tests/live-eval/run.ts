import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAgentSession, judgeTranscript } from './agents.ts';
import { evaluateChecks, loadScenarios, materializeScenario } from './scenarios.ts';
import type {
  AgentName,
  AgentSession,
  AgentTurnResult,
  CheckResult,
  LiveEvalVerdict,
  Scenario,
  ScenarioTier,
} from './types.ts';

interface CliOptions {
  agents: AgentName[];
  dryRun: boolean;
  effortClaude: string;
  effortCodex: string;
  judge?: AgentName;
  keepWorkspace: boolean;
  modelClaude: string;
  modelCodex: string;
  resultsDir: string;
  scenarioIds?: Set<string>;
  skills?: Set<string>;
  tier: ScenarioTier | 'all';
  timeoutMs: number;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseAgentList(value: string): AgentName[] {
  const agents = value.split(',');
  if (
    agents.some((agent) => {
      return agent !== 'codex' && agent !== 'claude';
    })
  ) {
    throw new Error('--agent accepts codex, claude, or codex,claude');
  }
  return [...new Set(agents)] as AgentName[];
}

export function parseCli(args: string[]): CliOptions {
  const options: CliOptions = {
    agents: ['codex', 'claude'],
    dryRun: false,
    effortClaude: 'medium',
    effortCodex: 'medium',
    keepWorkspace: false,
    modelClaude: 'sonnet',
    modelCodex: 'gpt-5.5',
    resultsDir: 'tests/live-eval/results',
    tier: 'smoke',
    timeoutMs: 300_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case '--agent':
        options.agents = parseAgentList(takeValue(args, index, flag));
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--judge': {
        const value = takeValue(args, index, flag);
        if (value !== 'none' && value !== 'codex' && value !== 'claude') {
          throw new Error('--judge accepts none, codex, or claude');
        }
        options.judge = value === 'none' ? undefined : value;
        index += 1;
        break;
      }
      case '--keep-workspace':
        options.keepWorkspace = true;
        break;
      case '--effort-claude':
        options.effortClaude = takeValue(args, index, flag);
        index += 1;
        break;
      case '--effort-codex':
        options.effortCodex = takeValue(args, index, flag);
        index += 1;
        break;
      case '--model-claude':
        options.modelClaude = takeValue(args, index, flag);
        index += 1;
        break;
      case '--model-codex':
        options.modelCodex = takeValue(args, index, flag);
        index += 1;
        break;
      case '--results-dir':
        options.resultsDir = takeValue(args, index, flag);
        index += 1;
        break;
      case '--scenario':
        options.scenarioIds = new Set(takeValue(args, index, flag).split(','));
        index += 1;
        break;
      case '--skill':
        options.skills = new Set(takeValue(args, index, flag).split(','));
        index += 1;
        break;
      case '--tier': {
        const value = takeValue(args, index, flag);
        if (value !== 'smoke' && value !== 'full' && value !== 'all') {
          throw new Error('--tier accepts smoke, full, or all');
        }
        options.tier = value;
        index += 1;
        break;
      }
      case '--timeout-ms': {
        const value = Number(takeValue(args, index, flag));
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error('--timeout-ms must be positive');
        }
        options.timeoutMs = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runScenario(
  repoRoot: string,
  scenario: Scenario,
  agent: AgentName,
  options: CliOptions,
  batchRoot: string,
): Promise<LiveEvalVerdict> {
  const startedAt = Date.now();
  const runRoot = await mkdtemp(path.join(os.tmpdir(), `codeartz-${scenario.skill}-${agent}-`));
  const workspace = path.join(runRoot, 'workspace');
  const artifactRoot = path.join(batchRoot, scenario.skill, scenario.id, agent);
  const transcript: AgentTurnResult[] = [];
  const checks: CheckResult[] = [];
  await materializeScenario(scenario, workspace);
  let session: AgentSession | undefined;

  try {
    session = await createAgentSession({
      agent,
      effort: agent === 'codex' ? options.effortCodex : options.effortClaude,
      repoRoot,
      workspace,
      skillName: scenario.skill,
      plugin: scenario.plugin,
      model: agent === 'codex' ? options.modelCodex : options.modelClaude,
      timeoutMs: options.timeoutMs,
    });
    for (const turn of scenario.turns) {
      const result = await session.runTurn(turn.prompt);
      transcript.push(result);
      checks.push(...(await evaluateChecks(turn.checks ?? [], workspace, transcript, scenario.files ?? {})));
    }
    checks.push(...(await evaluateChecks(scenario.postChecks ?? [], workspace, transcript, scenario.files ?? {})));
    const judge = options.judge
      ? await judgeTranscript(
          options.judge,
          {
            repoRoot,
            workspace,
            effort: options.judge === 'codex' ? options.effortCodex : options.effortClaude,
            model: options.judge === 'codex' ? options.modelCodex : options.modelClaude,
            timeoutMs: options.timeoutMs,
          },
          scenario,
          transcript,
        )
      : undefined;
    const verdict: LiveEvalVerdict = {
      agent,
      effort: agent === 'codex' ? options.effortCodex : options.effortClaude,
      model: agent === 'codex' ? options.modelCodex : options.modelClaude,
      scenarioId: scenario.id,
      skill: scenario.skill,
      verdict:
        checks.every((check) => {
          return check.passed;
        }) &&
        (!judge || judge.verdict === 'pass')
          ? 'pass'
          : 'fail',
      checks,
      ...(judge ? { judge } : {}),
      durationMs: Date.now() - startedAt,
    };
    await writeJson(path.join(artifactRoot, 'scenario.json'), scenario);
    await writeJson(path.join(artifactRoot, 'transcript.json'), transcript);
    await writeJson(path.join(artifactRoot, 'verdict.json'), verdict);
    await cp(workspace, path.join(artifactRoot, 'workspace'), { recursive: true });
    return verdict;
  } catch (error) {
    const verdict: LiveEvalVerdict = {
      agent,
      effort: agent === 'codex' ? options.effortCodex : options.effortClaude,
      model: agent === 'codex' ? options.modelCodex : options.modelClaude,
      scenarioId: scenario.id,
      skill: scenario.skill,
      verdict: 'indeterminate',
      checks,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
    await writeJson(path.join(artifactRoot, 'scenario.json'), scenario);
    await writeJson(path.join(artifactRoot, 'transcript.json'), transcript);
    await writeJson(path.join(artifactRoot, 'verdict.json'), verdict);
    return verdict;
  } finally {
    await session?.close();
    if (!options.keepWorkspace) {
      await rm(runRoot, { recursive: true, force: true });
    }
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const repoRoot = process.cwd();
  const options = parseCli(args);
  let scenarios = await loadScenarios(repoRoot, options.skills, options.tier);
  if (options.scenarioIds) {
    scenarios = scenarios.filter((scenario) => {
      return options.scenarioIds?.has(scenario.id);
    });
  }
  if (scenarios.length === 0) {
    throw new Error('No live-eval scenarios matched the filters');
  }

  const matrix = scenarios.flatMap((scenario) => {
    return options.agents.map((agent) => {
      return {
        agent,
        scenario: `${scenario.skill}/${scenario.id}`,
      };
    });
  });
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          judge: options.judge ?? 'none',
          matrix,
          models: {
            claude: { effort: options.effortClaude, model: options.modelClaude },
            codex: { effort: options.effortCodex, model: options.modelCodex },
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const batchRoot = path.resolve(repoRoot, options.resultsDir, timestamp());
  await writeJson(path.join(batchRoot, 'config.json'), {
    agents: options.agents,
    judge: options.judge ?? 'none',
    models: {
      claude: { effort: options.effortClaude, model: options.modelClaude },
      codex: { effort: options.effortCodex, model: options.modelCodex },
    },
    tier: options.tier,
  });
  const verdicts: LiveEvalVerdict[] = [];
  for (const scenario of scenarios) {
    for (const agent of options.agents) {
      process.stdout.write(`running ${scenario.skill}/${scenario.id} on ${agent}\n`);
      const verdict = await runScenario(repoRoot, scenario, agent, options, batchRoot);
      verdicts.push(verdict);
      process.stdout.write(`${verdict.verdict} ${scenario.skill}/${scenario.id} on ${agent}\n`);
    }
  }
  await writeJson(path.join(batchRoot, 'summary.json'), verdicts);
  process.stdout.write(`results: ${batchRoot}\n`);
  return verdicts.every((verdict) => {
    return verdict.verdict === 'pass';
  })
    ? 0
    : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 2;
    });
}
