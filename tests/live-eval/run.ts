import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAgentSession, judgeTranscript } from './agents.ts';
import { evaluateChecks, loadScenarios, materializeScenario, parseScenario, readJudgeFiles } from './scenarios.ts';
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
  judge: AgentName;
  judgeConcurrency: number;
  keepWorkspace: boolean;
  modelClaude: string;
  modelCodex: string;
  resultsDir: string;
  rejudgeDir?: string;
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
    agents: ['codex'],
    dryRun: false,
    effortClaude: 'medium',
    effortCodex: 'medium',
    judge: 'claude',
    judgeConcurrency: 3,
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
        if (value !== 'codex' && value !== 'claude') {
          throw new Error('--judge accepts codex or claude');
        }
        options.judge = value;
        index += 1;
        break;
      }
      case '--judge-concurrency': {
        const value = Number(takeValue(args, index, flag));
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error('--judge-concurrency must be positive');
        }
        options.judgeConcurrency = value;
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
      case '--rejudge':
        options.rejudgeDir = takeValue(args, index, flag);
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

export function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function findVerdictFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findVerdictFiles(target)));
    } else if (entry.name === 'verdict.json') {
      files.push(target);
    }
  }
  return files.sort();
}

function parseStoredTranscript(value: unknown, source: string): AgentTurnResult[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} must contain an array`);
  }
  for (const [index, turn] of value.entries()) {
    if (
      !isRecord(turn) ||
      typeof turn.response !== 'string' ||
      !Array.isArray(turn.rawEvents) ||
      typeof turn.stderr !== 'string' ||
      typeof turn.durationMs !== 'number'
    ) {
      throw new Error(`${source}[${index}] is invalid`);
    }
  }
  return value as AgentTurnResult[];
}

function parseStoredArtifacts(value: unknown, source: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${source} must contain an object`);
  }
  const artifacts: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(value)) {
    if (typeof content !== 'string') {
      throw new Error(`${source}.${filePath} must be a string`);
    }
    artifacts[filePath] = content;
  }
  return artifacts;
}

function parseStoredVerdict(value: unknown, source: string): LiveEvalVerdict {
  if (
    !isRecord(value) ||
    (value.agent !== 'codex' && value.agent !== 'claude') ||
    typeof value.effort !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.scenarioId !== 'string' ||
    typeof value.skill !== 'string' ||
    (value.verdict !== 'pass' && value.verdict !== 'fail' && value.verdict !== 'indeterminate') ||
    !Array.isArray(value.checks) ||
    typeof value.durationMs !== 'number' ||
    (value.indeterminatePhase !== undefined &&
      value.indeterminatePhase !== 'judge' &&
      value.indeterminatePhase !== 'target')
  ) {
    throw new Error(`${source} is invalid`);
  }
  return value as unknown as LiveEvalVerdict;
}

async function rejudgeBatch(repoRoot: string, options: CliOptions): Promise<number> {
  const batchRoot = path.resolve(repoRoot, options.rejudgeDir ?? '');
  const verdictFiles = await findVerdictFiles(batchRoot);
  if (verdictFiles.length === 0) {
    throw new Error(`No verdict.json files found under ${batchRoot}`);
  }
  const limitJudge = createLimiter(options.judgeConcurrency);
  const previousVerdicts = await Promise.all(
    verdictFiles.map(async (filePath) => {
      return parseStoredVerdict(await readJson(filePath), filePath);
    }),
  );
  await Promise.all(
    verdictFiles.map(async (verdictFile, index) => {
      const previous = previousVerdicts[index];
      if (!previous || previous.verdict !== 'indeterminate' || previous.indeterminatePhase !== 'judge') {
        return;
      }
      const artifactRoot = path.dirname(verdictFile);
      const scenarioPath = path.join(artifactRoot, 'scenario.json');
      const transcriptPath = path.join(artifactRoot, 'transcript.json');
      const artifactsPath = path.join(artifactRoot, 'judge-artifacts.json');
      const scenario = parseScenario(await readJson(scenarioPath), scenarioPath);
      const transcript = parseStoredTranscript(await readJson(transcriptPath), transcriptPath);
      const artifacts = parseStoredArtifacts(await readJson(artifactsPath), artifactsPath);
      const startedAt = Date.now();
      process.stdout.write(`rejudging ${scenario.skill}/${scenario.id} on ${previous.agent}\n`);
      try {
        const judge = await limitJudge(() => {
          return judgeTranscript(
            options.judge,
            {
              repoRoot,
              workspace: path.join(artifactRoot, 'workspace'),
              effort: options.judge === 'codex' ? options.effortCodex : options.effortClaude,
              model: options.judge === 'codex' ? options.modelCodex : options.modelClaude,
              timeoutMs: options.timeoutMs,
            },
            scenario,
            transcript,
            artifacts,
          );
        });
        const { error: _error, indeterminatePhase: _phase, judge: _judge, ...base } = previous;
        const verdict: LiveEvalVerdict = {
          ...base,
          verdict:
            previous.checks.every((check) => {
              return check.passed;
            }) && judge.verdict === 'pass'
              ? 'pass'
              : 'fail',
          judge,
          durationMs: previous.durationMs + Date.now() - startedAt,
        };
        await writeJson(verdictFile, verdict);
        process.stdout.write(`${verdict.verdict} ${scenario.skill}/${scenario.id} on ${previous.agent}\n`);
      } catch (error) {
        const verdict: LiveEvalVerdict = {
          ...previous,
          verdict: 'indeterminate',
          error: error instanceof Error ? error.message : String(error),
          indeterminatePhase: 'judge',
          durationMs: previous.durationMs + Date.now() - startedAt,
        };
        await writeJson(verdictFile, verdict);
        process.stdout.write(`indeterminate ${scenario.skill}/${scenario.id} on ${previous.agent}\n`);
      }
    }),
  );
  const verdicts = await Promise.all(
    verdictFiles.map(async (filePath) => {
      return parseStoredVerdict(await readJson(filePath), filePath);
    }),
  );
  await writeJson(path.join(batchRoot, 'summary.json'), verdicts);
  process.stdout.write(`results: ${batchRoot}\n`);
  return verdicts.every((verdict) => {
    return verdict.verdict === 'pass';
  })
    ? 0
    : 1;
}

async function runScenario(
  repoRoot: string,
  scenario: Scenario,
  agent: AgentName,
  options: CliOptions,
  batchRoot: string,
  limitJudge: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<LiveEvalVerdict> {
  const startedAt = Date.now();
  const runRoot = await mkdtemp(path.join(os.tmpdir(), `codeartz-${scenario.skill}-${agent}-`));
  const workspace = path.join(runRoot, 'workspace');
  const artifactRoot = path.join(batchRoot, scenario.skill, scenario.id, agent);
  const transcript: AgentTurnResult[] = [];
  const checks: CheckResult[] = [];
  let indeterminatePhase: 'judge' | 'target' = 'target';
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
    await session.close();
    session = undefined;
    const judgeArtifacts = await readJudgeFiles(scenario.judgeFiles ?? [], workspace);
    await writeJson(path.join(artifactRoot, 'scenario.json'), scenario);
    await writeJson(path.join(artifactRoot, 'transcript.json'), transcript);
    await writeJson(path.join(artifactRoot, 'checks.json'), checks);
    await writeJson(path.join(artifactRoot, 'judge-artifacts.json'), judgeArtifacts);
    await cp(workspace, path.join(artifactRoot, 'workspace'), { recursive: true });
    indeterminatePhase = 'judge';
    const judge = await limitJudge(() => {
      return judgeTranscript(
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
        judgeArtifacts,
      );
    });
    const verdict: LiveEvalVerdict = {
      agent,
      effort: agent === 'codex' ? options.effortCodex : options.effortClaude,
      model: agent === 'codex' ? options.modelCodex : options.modelClaude,
      scenarioId: scenario.id,
      skill: scenario.skill,
      verdict:
        checks.every((check) => {
          return check.passed;
        }) && judge.verdict === 'pass'
          ? 'pass'
          : 'fail',
      checks,
      judge,
      durationMs: Date.now() - startedAt,
    };
    await writeJson(path.join(artifactRoot, 'verdict.json'), verdict);
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
      indeterminatePhase,
      durationMs: Date.now() - startedAt,
    };
    await writeJson(path.join(artifactRoot, 'scenario.json'), scenario);
    await writeJson(path.join(artifactRoot, 'transcript.json'), transcript);
    await writeJson(path.join(artifactRoot, 'verdict.json'), verdict);
    await cp(workspace, path.join(artifactRoot, 'workspace'), { recursive: true, force: true });
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
  if (options.rejudgeDir) {
    return rejudgeBatch(repoRoot, options);
  }
  let scenarios = await loadScenarios(repoRoot, options.skills, options.tier);
  if (options.scenarioIds) {
    scenarios = scenarios.filter((scenario) => {
      return options.scenarioIds?.has(scenario.id);
    });
  }
  if (scenarios.length === 0) {
    throw new Error('No live-eval scenarios matched the filters');
  }

  const runs = scenarios.flatMap((scenario) => {
    return options.agents.map((agent) => {
      return {
        agent,
        scenario,
      };
    });
  });
  const matrix = runs.map(({ agent, scenario }) => {
    return {
      agent,
      scenario: `${scenario.skill}/${scenario.id}`,
    };
  });
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          judge: options.judge,
          judgeConcurrency: options.judgeConcurrency,
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
    judge: options.judge,
    judgeConcurrency: options.judgeConcurrency,
    models: {
      claude: { effort: options.effortClaude, model: options.modelClaude },
      codex: { effort: options.effortCodex, model: options.modelCodex },
    },
    tier: options.tier,
  });
  const limitJudge = createLimiter(options.judgeConcurrency);
  const verdicts = await Promise.all(
    runs.map(async ({ agent, scenario }): Promise<LiveEvalVerdict> => {
      process.stdout.write(`running ${scenario.skill}/${scenario.id} on ${agent}\n`);
      const verdict = await runScenario(repoRoot, scenario, agent, options, batchRoot, limitJudge);
      process.stdout.write(`${verdict.verdict} ${scenario.skill}/${scenario.id} on ${agent}\n`);
      return verdict;
    }),
  );
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
