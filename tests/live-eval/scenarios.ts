import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AgentTurnResult, CheckResult, Scenario, ScenarioCheck, ScenarioGitState, ScenarioTier } from './types.ts';

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function parseCheck(value: unknown, field: string): ScenarioCheck {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  const type = requireString(value.type, `${field}.type`);

  switch (type) {
    case 'markdownHeadingsEqual': {
      if (!Number.isInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 6) {
        throw new Error(`${field}.level must be an integer from 1 to 6`);
      }
      if (!Array.isArray(value.headings)) {
        throw new Error(`${field}.headings must be an array`);
      }
      return {
        type,
        path: requireString(value.path, `${field}.path`),
        level: Number(value.level),
        headings: value.headings.map((heading, index) => {
          return requireString(heading, `${field}.headings[${index}]`);
        }),
      };
    }
    case 'fileExists':
    case 'fileNotExists':
    case 'fileUnchanged':
    case 'markdownFencesBalanced':
      return { type, path: requireString(value.path, `${field}.path`) };
    case 'workspaceUnchanged':
      return { type };
    case 'questionCountAtMost':
      if (!Number.isInteger(value.max) || Number(value.max) < 0) {
        throw new Error(`${field}.max must be a non-negative integer`);
      }
      return { type, max: Number(value.max) };
    case 'trajectoryExcludes':
    case 'trajectoryIncludes':
      return { type, value: requireString(value.value, `${field}.value`) };
    default:
      throw new Error(`${field}.type is unsupported: ${type}`);
  }
}

function parseChecks(value: unknown, field: string): ScenarioCheck[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((check, index) => {
    return parseCheck(check, `${field}[${index}]`);
  });
}

function parseFiles(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  const files: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(value)) {
    files[filePath] = requireText(content, `${field}.${filePath}`);
  }
  return files;
}

function parseGitState(value: unknown, field: string): ScenarioGitState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  const git: ScenarioGitState = {};
  for (const state of ['committed', 'staged', 'unstaged', 'untracked'] as const) {
    if (value[state] !== undefined) {
      git[state] = parseFiles(value[state], `${field}.${state}`);
    }
  }
  if (Object.keys(git).length === 0) {
    throw new Error(`${field} must define committed, staged, unstaged, or untracked files`);
  }
  return git;
}

export function parseScenario(value: unknown, source: string): Scenario {
  if (!isRecord(value)) {
    throw new Error(`${source} must contain an object`);
  }

  const tier = requireString(value.tier, `${source}.tier`);
  if (tier !== 'full' && tier !== 'smoke') {
    throw new Error(`${source}.tier must be full or smoke`);
  }
  if (!Array.isArray(value.turns) || value.turns.length === 0) {
    throw new Error(`${source}.turns must contain at least one turn`);
  }
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) {
    throw new Error(`${source}.criteria must contain at least one criterion`);
  }
  const postChecks = parseChecks(value.postChecks, `${source}.postChecks`);

  const files = value.files === undefined ? {} : parseFiles(value.files, `${source}.files`);
  const git = parseGitState(value.git, `${source}.git`);

  let judgeFiles: string[] | undefined;
  if (value.judgeFiles !== undefined) {
    if (!Array.isArray(value.judgeFiles)) {
      throw new Error(`${source}.judgeFiles must be an array`);
    }
    judgeFiles = value.judgeFiles.map((filePath, index) => {
      return requireString(filePath, `${source}.judgeFiles[${index}]`);
    });
  }

  return {
    id: requireString(value.id, `${source}.id`),
    skill: requireString(value.skill, `${source}.skill`),
    ...(value.plugin === true ? { plugin: true } : {}),
    tier: tier as ScenarioTier,
    description: requireString(value.description, `${source}.description`),
    ...(Object.keys(files).length > 0 ? { files } : {}),
    ...(git ? { git } : {}),
    ...(judgeFiles ? { judgeFiles } : {}),
    turns: value.turns.map((turn, index) => {
      if (!isRecord(turn)) {
        throw new Error(`${source}.turns[${index}] must be an object`);
      }
      const checks = parseChecks(turn.checks, `${source}.turns[${index}].checks`);
      return {
        prompt: requireString(turn.prompt, `${source}.turns[${index}].prompt`),
        ...(checks ? { checks } : {}),
      };
    }),
    criteria: value.criteria.map((criterion, index) => {
      return requireString(criterion, `${source}.criteria[${index}]`);
    }),
    ...(postChecks ? { postChecks } : {}),
  };
}

export async function readJudgeFiles(paths: string[], workspace: string): Promise<Record<string, string>> {
  const artifacts: Record<string, string> = {};
  for (const filePath of paths) {
    const target = resolveWorkspacePath(workspace, filePath);
    artifacts[filePath] = (await fileExists(target)) ? await readFile(target, 'utf8') : '[missing]';
  }
  return artifacts;
}

export async function loadScenarios(
  repoRoot: string,
  selectedSkills?: Set<string>,
  tier: ScenarioTier | 'all' = 'smoke',
): Promise<Scenario[]> {
  const testsRoot = path.join(repoRoot, 'tests');
  const entries = await readdir(testsRoot, { withFileTypes: true });
  const scenarios: Scenario[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'live-eval') {
      continue;
    }
    if (selectedSkills && !selectedSkills.has(entry.name)) {
      continue;
    }
    const scenarioRoot = path.join(testsRoot, entry.name, 'scenarios');
    try {
      const files = await readdir(scenarioRoot);
      for (const file of files
        .filter((name) => {
          return name.endsWith('.scenario.json');
        })
        .sort()) {
        const source = path.join(scenarioRoot, file);
        const scenario = parseScenario(JSON.parse(await readFile(source, 'utf8')), source);
        if (scenario.skill !== entry.name) {
          throw new Error(`${source}.skill must match tests/${entry.name}`);
        }
        if (tier === 'all' || scenario.tier === tier) {
          scenarios.push(scenario);
        }
      }
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  return scenarios;
}

function resolveWorkspacePath(workspace: string, relativePath: string): string {
  const resolved = path.resolve(workspace, relativePath);
  const prefix = `${path.resolve(workspace)}${path.sep}`;
  if (resolved !== path.resolve(workspace) && !resolved.startsWith(prefix)) {
    throw new Error(`Scenario path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

export async function materializeScenario(scenario: Scenario, workspace: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace, { recursive: true });
  const writeFiles = async (files: Record<string, string>): Promise<void> => {
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = resolveWorkspacePath(workspace, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf8');
    }
  };
  await writeFiles(scenario.files ?? {});
  if (!scenario.git) {
    return;
  }

  await execFileAsync('git', ['init', '--quiet'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.name', 'Live Eval'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.email', 'live-eval@example.invalid'], { cwd: workspace });
  await execFileAsync('git', ['add', '--all'], { cwd: workspace });
  await execFileAsync('git', ['commit', '--quiet', '--allow-empty', '-m', 'baseline'], { cwd: workspace });

  await writeFiles(scenario.git.committed ?? {});
  if (Object.keys(scenario.git.committed ?? {}).length > 0) {
    await execFileAsync('git', ['add', '--all'], { cwd: workspace });
    await execFileAsync('git', ['commit', '--quiet', '--allow-empty', '-m', 'change'], { cwd: workspace });
  }
  await writeFiles(scenario.git.staged ?? {});
  const stagedPaths = Object.keys(scenario.git.staged ?? {});
  if (stagedPaths.length > 0) {
    await execFileAsync('git', ['add', '--', ...stagedPaths], { cwd: workspace });
  }
  await writeFiles(scenario.git.unstaged ?? {});
  await writeFiles(scenario.git.untracked ?? {});
}

export function scenarioWorkspaceFiles(scenario: Scenario): Record<string, string> {
  return {
    ...scenario.files,
    ...scenario.git?.committed,
    ...scenario.git?.staged,
    ...scenario.git?.unstaged,
    ...scenario.git?.untracked,
  };
}

async function readWorkspaceFiles(workspace: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' && directory === workspace) {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        files[path.relative(workspace, target)] = await readFile(target, 'utf8');
      }
    }
  };
  await visit(workspace);
  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function evaluateChecks(
  checks: ScenarioCheck[],
  workspace: string,
  turnResults: AgentTurnResult[],
  initialFiles: Record<string, string>,
): Promise<CheckResult[]> {
  const latest = turnResults.at(-1);
  const response = latest?.response ?? '';
  const trajectory = JSON.stringify(
    turnResults.flatMap((turn) => {
      return turn.rawEvents;
    }),
  );
  const results: CheckResult[] = [];

  for (const check of checks) {
    switch (check.type) {
      case 'questionCountAtMost': {
        const count = [...response.matchAll(/[?？]/g)].length;
        const passed = count <= check.max;
        results.push({ check, passed, evidence: `${count} question marks; maximum ${check.max}` });
        break;
      }
      case 'trajectoryIncludes': {
        const passed = trajectory.includes(check.value);
        results.push({
          check,
          passed,
          evidence: passed ? `trajectory contains ${check.value}` : `trajectory missing ${check.value}`,
        });
        break;
      }
      case 'trajectoryExcludes': {
        const passed = !trajectory.includes(check.value);
        results.push({
          check,
          passed,
          evidence: passed ? `trajectory excludes ${check.value}` : `trajectory contains ${check.value}`,
        });
        break;
      }
      case 'fileExists': {
        const passed = await fileExists(resolveWorkspacePath(workspace, check.path));
        results.push({ check, passed, evidence: `${check.path} ${passed ? 'exists' : 'does not exist'}` });
        break;
      }
      case 'fileNotExists': {
        const passed = !(await fileExists(resolveWorkspacePath(workspace, check.path)));
        results.push({ check, passed, evidence: `${check.path} ${passed ? 'does not exist' : 'exists'}` });
        break;
      }
      case 'fileUnchanged': {
        const expected = initialFiles[check.path];
        const target = resolveWorkspacePath(workspace, check.path);
        const actual = (await fileExists(target)) ? await readFile(target, 'utf8') : undefined;
        const passed = expected !== undefined && actual === expected;
        results.push({
          check,
          passed,
          evidence: `${check.path} ${passed ? 'is unchanged' : 'changed or disappeared'}`,
        });
        break;
      }
      case 'workspaceUnchanged': {
        const actual = await readWorkspaceFiles(workspace);
        const sorted = (files: Record<string, string>): Array<[string, string]> => {
          return Object.entries(files).sort(([left], [right]) => {
            return left.localeCompare(right);
          });
        };
        const passed = JSON.stringify(sorted(actual)) === JSON.stringify(sorted(initialFiles));
        results.push({
          check,
          passed,
          evidence: passed ? 'workspace files are unchanged' : 'workspace files changed',
        });
        break;
      }
      case 'markdownHeadingsEqual': {
        const target = resolveWorkspacePath(workspace, check.path);
        const actual = (await fileExists(target)) ? await readFile(target, 'utf8') : '';
        const marker = '#'.repeat(check.level);
        let inFence = false;
        const headings = actual.split(/\r?\n/).flatMap((line) => {
          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return [];
          }
          if (inFence || !line.startsWith(`${marker} `) || line.startsWith(`${marker}#`)) {
            return [];
          }
          return [line.slice(marker.length + 1).trim()];
        });
        const passed = JSON.stringify(headings) === JSON.stringify(check.headings);
        results.push({
          check,
          passed,
          evidence: `${check.path} level ${check.level} headings: ${JSON.stringify(headings)}`,
        });
        break;
      }
      case 'markdownFencesBalanced': {
        const target = resolveWorkspacePath(workspace, check.path);
        const actual = (await fileExists(target)) ? await readFile(target, 'utf8') : '';
        const fenceCount = actual.split(/\r?\n/).filter((line) => {
          return /^\s*(```|~~~)/.test(line);
        }).length;
        const passed = fenceCount % 2 === 0;
        results.push({
          check,
          passed,
          evidence: `${check.path} has ${fenceCount} Markdown fence markers`,
        });
        break;
      }
    }
  }

  return results;
}
