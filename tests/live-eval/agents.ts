import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { AgentName, AgentSession, AgentTurnResult, JudgeResult, Scenario } from './types.ts';

interface SessionOptions {
  agent: AgentName;
  effort?: string;
  jsonSchema?: string;
  repoRoot: string;
  workspace: string;
  skillName?: string;
  plugin?: boolean;
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

function compactText(value: string, maxLength = 500): string {
  const compacted = value.replaceAll(/\s+/g, ' ').trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength)}…`;
}

function claudeToolResults(events: unknown[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const event of events) {
    if (
      !isRecord(event) ||
      event.type !== 'user' ||
      !isRecord(event.message) ||
      !Array.isArray(event.message.content)
    ) {
      continue;
    }
    for (const content of event.message.content) {
      if (!isRecord(content) || content.type !== 'tool_result' || typeof content.tool_use_id !== 'string') {
        continue;
      }
      results.set(content.tool_use_id, content.is_error === true ? 'failed' : 'completed');
    }
  }
  return results;
}

function claudeToolDetail(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') {
    return compactText(input.command);
  }
  for (const key of ['file_path', 'path'] as const) {
    if (typeof input[key] === 'string') {
      return compactText(input[key]);
    }
  }
  return '';
}

export function compactToolTrace(events: unknown[]): string[] {
  const trace: string[] = [];
  const claudeResults = claudeToolResults(events);
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    if (event.type === 'item.completed' && isRecord(event.item)) {
      if (event.item.type === 'command_execution' && typeof event.item.command === 'string') {
        const exitCode = typeof event.item.exit_code === 'number' ? `exit ${event.item.exit_code}` : 'completed';
        trace.push(`command [${exitCode}]: ${compactText(event.item.command)}`);
      } else if (event.item.type === 'file_change' && Array.isArray(event.item.changes)) {
        for (const change of event.item.changes) {
          if (isRecord(change) && typeof change.path === 'string') {
            const kind = typeof change.kind === 'string' ? change.kind : 'changed';
            trace.push(`file_change [${kind}]: ${compactText(change.path)}`);
          }
        }
      }
      continue;
    }
    if (event.type !== 'assistant' || !isRecord(event.message) || !Array.isArray(event.message.content)) {
      continue;
    }
    for (const content of event.message.content) {
      if (!isRecord(content) || content.type !== 'tool_use' || typeof content.name !== 'string') {
        continue;
      }
      const input = isRecord(content.input) ? content.input : {};
      const detail = claudeToolDetail(content.name, input);
      const status = typeof content.id === 'string' ? (claudeResults.get(content.id) ?? 'unknown') : 'unknown';
      trace.push(`${content.name} [${status}]${detail ? `: ${detail}` : ''}`);
    }
  }
  return trace.length <= 50 ? trace : [...trace.slice(0, 24), '… omitted tool actions …', ...trace.slice(-25)];
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
  if (options.plugin) {
    const marketplace = path.join(sessionRoot, 'marketplace');
    const plugin = path.join(marketplace, 'plugins', 'codeartz-skills');
    await mkdir(path.join(marketplace, '.agents', 'plugins'), { recursive: true });
    await mkdir(plugin, { recursive: true });
    for (const entry of ['.codex-plugin', 'assets', 'hooks']) {
      await cp(path.join(options.repoRoot, entry), path.join(plugin, entry), { recursive: true });
    }
    if (options.skillName) {
      await cp(
        path.join(options.repoRoot, 'skills', options.skillName),
        path.join(plugin, 'skills', options.skillName),
        { recursive: true },
      );
    }
    await writeFile(
      path.join(marketplace, '.agents', 'plugins', 'marketplace.json'),
      `${JSON.stringify({
        name: 'live-eval',
        interface: { displayName: 'Live Eval' },
        plugins: [
          {
            name: 'codeartz-skills',
            description: 'Current workspace plugin for live evaluation.',
            source: { source: 'local', path: './plugins/codeartz-skills' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      })}\n`,
      'utf8',
    );
    const environment = { ...childEnvironment(home), CODEX_HOME: codexHome };
    await runProcess(
      'codex',
      ['plugin', 'marketplace', 'add', marketplace, '--json'],
      options.workspace,
      environment,
      options.timeoutMs,
    );
    await runProcess(
      'codex',
      ['plugin', 'add', 'codeartz-skills@live-eval', '--json'],
      options.workspace,
      environment,
      options.timeoutMs,
    );
  } else if (options.skillName) {
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
        ...(!options.plugin ? ['--ignore-user-config'] : []),
        ...(options.plugin ? ['--dangerously-bypass-hook-trust'] : []),
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
        ...(options.jsonSchema ? ['--json-schema', options.jsonSchema] : []),
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

export function judgeJsonSchema(criteriaCount: number) {
  return {
    type: 'object',
    properties: {
      passed: {
        type: 'array',
        minItems: criteriaCount,
        maxItems: criteriaCount,
        items: { type: 'boolean' },
      },
      evidence: {
        type: 'array',
        minItems: criteriaCount,
        maxItems: criteriaCount,
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['passed', 'evidence'],
    additionalProperties: false,
  } as const;
}

export function parseJudgeResult(value: unknown, scenario: Scenario): JudgeResult {
  if (!isRecord(value)) {
    throw new Error('Judge result must be an object');
  }
  const unsupportedField = Object.keys(value).find((field) => {
    return field !== 'passed' && field !== 'evidence';
  });
  if (unsupportedField) {
    throw new Error(`Judge result has unsupported field: ${unsupportedField}`);
  }
  if (!Array.isArray(value.passed) || !Array.isArray(value.evidence)) {
    throw new Error('Judge result is missing passed or evidence');
  }
  const passed = value.passed;
  const evidence = value.evidence;
  const expectedCount = scenario.criteria.length;
  if (passed.length !== expectedCount || evidence.length !== expectedCount) {
    throw new Error(`Judge result must contain exactly ${expectedCount} results`);
  }
  if (
    passed.some((result) => {
      return typeof result !== 'boolean';
    })
  ) {
    throw new Error('Judge passed values must be booleans');
  }
  if (
    evidence.some((result) => {
      return typeof result !== 'string' || result.trim() === '';
    })
  ) {
    throw new Error('Judge evidence values must be non-empty strings');
  }
  const criteria = scenario.criteria.map((criterion, index) => {
    return {
      criterion,
      passed: passed[index] as boolean,
      evidence: evidence[index] as string,
    };
  });
  const failed = criteria.flatMap((criterion, index) => {
    return criterion.passed ? [] : [index];
  });
  return {
    verdict: failed.length === 0 ? 'pass' : 'fail',
    summary: failed.length === 0 ? `All ${criteria.length} criteria passed` : `Failed criteria: ${failed.join(', ')}`,
    criteria,
  };
}

export async function retryJudge<T>(attempt: () => Promise<T>): Promise<T> {
  const errors: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Judge failed after 2 independent attempts: ${errors.join(' | ')}`);
}

export async function judgeTranscript(
  agent: AgentName,
  options: Omit<SessionOptions, 'agent' | 'jsonSchema' | 'plugin' | 'readOnly' | 'skillName'>,
  scenario: Scenario,
  transcript: AgentTurnResult[],
  artifacts: Record<string, string> = {},
): Promise<JudgeResult> {
  const jsonSchema = JSON.stringify(judgeJsonSchema(scenario.criteria.length));
  const conversation = transcript
    .map((turn, index) => {
      const toolTrace = compactToolTrace(turn.rawEvents);
      return [
        `Turn ${index + 1}`,
        `User: ${scenario.turns[index]?.prompt ?? '(missing prompt)'}`,
        `Agent: ${turn.response}`,
        ...(toolTrace.length > 0 ? [`Observed tool actions:\n${toolTrace.join('\n')}`] : []),
      ].join('\n');
    })
    .join('\n\n');
  const artifactText = Object.entries(artifacts)
    .map(([filePath, content]) => {
      return [`Artifact: ${filePath}`, content].join('\n');
    })
    .join('\n\n');
  const prompt = [
    'Evaluate the transcript and supplied artifacts against every criterion. Use only evidence present in them.',
    `Submit a concise judgment matching this JSON Schema:\n${jsonSchema}`,
    'The overall verdict is pass only when every criterion passes.',
    `Criteria:\n${scenario.criteria
      .map((criterion, index) => {
        return `${index}. ${criterion}`;
      })
      .join('\n')}`,
    `Transcript:\n${conversation}`,
    ...(artifactText ? [`Artifacts after the final turn:\n${artifactText}`] : []),
  ].join('\n\n');
  return retryJudge(async () => {
    const session = await createAgentSession({
      ...options,
      agent,
      readOnly: true,
      ...(agent === 'claude' ? { jsonSchema } : {}),
    });
    try {
      const result = await session.runTurn(prompt);
      return parseJudgeResult(extractJsonObject(result.response), scenario);
    } finally {
      await session.close();
    }
  });
}
