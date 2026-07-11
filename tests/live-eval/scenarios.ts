import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentTurnResult, CheckResult, Scenario, ScenarioCheck, ScenarioTier } from './types.ts';

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
    case 'fileContains':
      return {
        type,
        path: requireString(value.path, `${field}.path`),
        value: requireString(value.value, `${field}.value`),
      };
    case 'fileExists':
    case 'fileNotExists':
    case 'fileUnchanged':
      return { type, path: requireString(value.path, `${field}.path`) };
    case 'questionCountAtMost':
      if (!Number.isInteger(value.max) || Number(value.max) < 0) {
        throw new Error(`${field}.max must be a non-negative integer`);
      }
      return { type, max: Number(value.max) };
    case 'responseExcludes':
    case 'responseIncludes':
    case 'trajectoryIncludes':
      return { type, value: requireString(value.value, `${field}.value`) };
    case 'responseMatches':
      return {
        type,
        pattern: requireString(value.pattern, `${field}.pattern`),
        ...(typeof value.flags === 'string' ? { flags: value.flags } : {}),
      };
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

  const files: Record<string, string> = {};
  if (value.files !== undefined) {
    if (!isRecord(value.files)) {
      throw new Error(`${source}.files must be an object`);
    }
    for (const [filePath, content] of Object.entries(value.files)) {
      files[filePath] = requireText(content, `${source}.files.${filePath}`);
    }
  }

  return {
    id: requireString(value.id, `${source}.id`),
    skill: requireString(value.skill, `${source}.skill`),
    tier: tier as ScenarioTier,
    description: requireString(value.description, `${source}.description`),
    ...(Object.keys(files).length > 0 ? { files } : {}),
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
  for (const [relativePath, content] of Object.entries(scenario.files ?? {})) {
    const destination = resolveWorkspacePath(workspace, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
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
      case 'responseIncludes': {
        const passed = response.includes(check.value);
        results.push({ check, passed, evidence: passed ? `found ${check.value}` : `missing ${check.value}` });
        break;
      }
      case 'responseExcludes': {
        const passed = !response.includes(check.value);
        results.push({ check, passed, evidence: passed ? `absent ${check.value}` : `found ${check.value}` });
        break;
      }
      case 'responseMatches': {
        const passed = new RegExp(check.pattern, check.flags).test(response);
        results.push({
          check,
          passed,
          evidence: passed ? `matched /${check.pattern}/` : `did not match /${check.pattern}/`,
        });
        break;
      }
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
      case 'fileContains': {
        const target = resolveWorkspacePath(workspace, check.path);
        const actual = (await fileExists(target)) ? await readFile(target, 'utf8') : '';
        const passed = actual.includes(check.value);
        results.push({
          check,
          passed,
          evidence: `${check.path} ${passed ? 'contains' : 'does not contain'} ${check.value}`,
        });
        break;
      }
    }
  }

  return results;
}
