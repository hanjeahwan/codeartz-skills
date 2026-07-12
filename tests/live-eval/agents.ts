import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { AgentName, AgentSession, AgentTurnResult, JudgeResult, Scenario } from './types.ts';

interface SessionOptions {
  agent: AgentName;
  effort?: string;
  repoRoot: string;
  workspace: string;
  skillName?: string;
  model?: string;
  timeoutMs: number;
  readOnly?: boolean;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

const CHILD_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'OPENAI_API_KEY',
  'PATH',
  'SSL_CERT_FILE',
  'TERM',
  'USER',
] as const;

function childEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    TMPDIR: path.join(home, 'tmp'),
  };
  for (const key of CHILD_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }
  return environment;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd,
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`${command} exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
  }
  return { stdout, stderr, durationMs: Date.now() - startedAt };
}

function parseJsonLines(output: string): unknown[] {
  return output
    .split('\n')
    .map((line) => {
      return line.trim();
    })
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: 'unparsed', text: line };
      }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findString(records: unknown[], keys: string[]): string | undefined {
  for (const value of records) {
    if (!isRecord(value)) {
      continue;
    }
    for (const key of keys) {
      if (typeof value[key] === 'string') {
        return value[key];
      }
    }
  }
  return undefined;
}

async function copyCredentialIfPresent(source: string, destination: string): Promise<void> {
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function removeAfterChildSettles(target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await rm(target, { recursive: true, force: true });
    if (attempt < 4) {
      await delay(150);
    }
  }
}

async function createCodexSession(options: SessionOptions): Promise<AgentSession> {
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'codeartz-live-eval-codex-'));
  const home = path.join(sessionRoot, 'home');
  const codexHome = path.join(home, '.codex');
  await mkdir(path.join(home, 'tmp'), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  const sourceCodexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  await copyCredentialIfPresent(path.join(sourceCodexHome, 'auth.json'), path.join(codexHome, 'auth.json'));
  if (options.skillName) {
    await cp(
      path.join(options.repoRoot, 'skills', options.skillName),
      path.join(codexHome, 'skills', options.skillName),
      { recursive: true },
    );
  }
  const environment = { ...childEnvironment(home), CODEX_HOME: codexHome };
  let threadId: string | undefined;
  let turnNumber = 0;

  return {
    async runTurn(prompt) {
      turnNumber += 1;
      const outputPath = path.join(sessionRoot, `turn-${turnNumber}.md`);
      const modelArgs = options.model ? ['--model', options.model] : [];
      const effortArgs = options.effort ? ['-c', `model_reasoning_effort="${options.effort}"`] : [];
      const shared = [
        '--json',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '-c',
        'approval_policy="never"',
        '-c',
        `sandbox_mode="${options.readOnly ? 'read-only' : 'workspace-write'}"`,
        '--output-last-message',
        outputPath,
        ...modelArgs,
        ...effortArgs,
      ];
      const args = threadId
        ? ['exec', 'resume', ...shared, threadId, prompt]
        : ['exec', ...shared, '--cd', options.workspace, prompt];
      const result = await runProcess('codex', args, options.workspace, environment, options.timeoutMs);
      const rawEvents = parseJsonLines(result.stdout);
      threadId ??= findString(rawEvents, ['thread_id', 'threadId', 'session_id', 'sessionId']);
      if (!threadId) {
        throw new Error('Codex output did not include a thread id');
      }
      const response = await readFile(outputPath, 'utf8');
      const completed = [...rawEvents].reverse().find((event) => {
        return isRecord(event) && (event.type === 'turn.completed' || event.type === 'turn_completed');
      });
      return {
        response,
        rawEvents,
        stderr: result.stderr,
        durationMs: result.durationMs,
        ...(isRecord(completed) && completed.usage !== undefined ? { usage: completed.usage } : {}),
      };
    },
    async close() {
      await rm(sessionRoot, { recursive: true, force: true });
    },
  };
}

async function createClaudeSession(options: SessionOptions): Promise<AgentSession> {
  const sessionRoot = path.join(os.tmpdir(), `codeartz-live-eval-claude-${randomUUID()}`);
  const isolatedHome = path.join(sessionRoot, 'home');
  const isolatedClaudeHome = path.join(isolatedHome, '.claude');
  const usesEnvironmentCredential = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const home = usesEnvironmentCredential ? isolatedHome : os.homedir();
  await mkdir(path.join(isolatedHome, 'tmp'), { recursive: true });
  await mkdir(isolatedClaudeHome, { recursive: true });
  const environment = {
    ...childEnvironment(home),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    TMPDIR: path.join(isolatedHome, 'tmp'),
    ...(usesEnvironmentCredential ? { CLAUDE_CONFIG_DIR: isolatedClaudeHome } : {}),
  };
  const sessionId = randomUUID();
  const canonicalWorkspace = await realpath(options.workspace);
  const hostProjectState = path.join(os.homedir(), '.claude', 'projects', canonicalWorkspace.replaceAll(path.sep, '-'));
  let turnNumber = 0;

  return {
    async runTurn(prompt) {
      turnNumber += 1;
      const common = [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-chrome',
        '--setting-sources',
        'project,local',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        options.readOnly ? 'dontAsk' : 'acceptEdits',
        '--allowedTools',
        options.readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Write,Edit,Bash(node:*)',
        ...(options.skillName ? ['--plugin-dir', options.repoRoot] : []),
        ...(options.model ? ['--model', options.model] : []),
        ...(options.effort ? ['--effort', options.effort] : []),
      ];
      const args =
        turnNumber === 1 ? [...common, '--session-id', sessionId, prompt] : [...common, '--resume', sessionId, prompt];
      const result = await runProcess('claude', args, options.workspace, environment, options.timeoutMs);
      const rawEvents = parseJsonLines(result.stdout);
      const finalEvent = [...rawEvents].reverse().find((event) => {
        return isRecord(event) && event.type === 'result';
      });
      if (!isRecord(finalEvent) || typeof finalEvent.result !== 'string') {
        throw new Error('Claude output did not include a result event');
      }
      return {
        response: finalEvent.result,
        rawEvents,
        stderr: result.stderr,
        durationMs: result.durationMs,
        ...(finalEvent.usage !== undefined ? { usage: finalEvent.usage } : {}),
        ...(typeof finalEvent.total_cost_usd === 'number' ? { costUsd: finalEvent.total_cost_usd } : {}),
      };
    },
    async close() {
      await rm(sessionRoot, { recursive: true, force: true });
      if (!usesEnvironmentCredential) {
        await removeAfterChildSettles(hostProjectState);
      }
    },
  };
}

export async function createAgentSession(options: SessionOptions): Promise<AgentSession> {
  return options.agent === 'codex' ? createCodexSession(options) : createClaudeSession(options);
}

function extractJsonObject(response: string): unknown {
  const unfenced = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Judge did not return JSON');
    }
    return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  }
}

function parseJudgeResult(value: unknown, scenario: Scenario): JudgeResult {
  if (!isRecord(value) || (value.verdict !== 'pass' && value.verdict !== 'fail')) {
    throw new Error('Judge result has an invalid verdict');
  }
  if (typeof value.summary !== 'string' || !Array.isArray(value.criteria)) {
    throw new Error('Judge result is missing summary or criteria');
  }
  const criteria = value.criteria.map((criterion, index) => {
    if (
      !isRecord(criterion) ||
      typeof criterion.criterion !== 'string' ||
      typeof criterion.passed !== 'boolean' ||
      typeof criterion.evidence !== 'string'
    ) {
      throw new Error(`Judge criterion ${index} is invalid`);
    }
    if (criterion.criterion !== scenario.criteria[index]) {
      throw new Error(`Judge criterion ${index} does not match the scenario`);
    }
    return {
      criterion: criterion.criterion,
      passed: criterion.passed,
      evidence: criterion.evidence,
    };
  });
  if (criteria.length !== scenario.criteria.length) {
    throw new Error('Judge did not evaluate every scenario criterion');
  }
  return { verdict: value.verdict, summary: value.summary, criteria };
}

export async function judgeTranscript(
  agent: AgentName,
  options: Omit<SessionOptions, 'agent' | 'readOnly' | 'skillName'>,
  scenario: Scenario,
  transcript: AgentTurnResult[],
): Promise<JudgeResult> {
  const session = await createAgentSession({ ...options, agent, readOnly: true });
  const conversation = transcript
    .map((turn, index) => {
      return [
        `Turn ${index + 1}`,
        `User: ${scenario.turns[index]?.prompt ?? '(missing prompt)'}`,
        `Agent: ${turn.response}`,
      ].join('\n');
    })
    .join('\n\n');
  const prompt = [
    'Evaluate the transcript against every criterion. Use only evidence present in the transcript.',
    'Return JSON only with this shape:',
    '{"verdict":"pass|fail","summary":"...","criteria":[{"criterion":"exact criterion","passed":true,"evidence":"..."}]}',
    'The overall verdict is pass only when every criterion passes.',
    `Criteria:\n${scenario.criteria
      .map((criterion) => {
        return `- ${criterion}`;
      })
      .join('\n')}`,
    `Transcript:\n${conversation}`,
  ].join('\n\n');
  try {
    const result = await session.runTurn(prompt);
    return parseJudgeResult(extractJsonObject(result.response), scenario);
  } finally {
    await session.close();
  }
}
