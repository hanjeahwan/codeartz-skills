import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_STATUSES = new Set(['pending', 'processing', 'updated', 'proposed', 'no-durable-update', 'blocked']);

function stateRoot(env = process.env) {
  if (env.AGENT_FEEDBACK_STATE_DIR) {
    return env.AGENT_FEEDBACK_STATE_DIR;
  }
  if (env.PLUGIN_DATA) {
    return path.join(env.PLUGIN_DATA, 'agent-feedback-loop');
  }
  if (env.CLAUDE_CONFIG_DIR) {
    return path.join(env.CLAUDE_CONFIG_DIR, 'agent-feedback-loop');
  }
  return path.join(os.homedir(), '.claude', 'agent-feedback-loop');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function safeSegment(value) {
  return (
    String(value || 'unknown')
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .slice(0, 80) || 'unknown'
  );
}

function eventsDir(env = process.env) {
  return path.join(stateRoot(env), 'events');
}

function nowIso() {
  return new Date().toISOString();
}

export function sanitizeExcerpt(text, maxLength = 500) {
  let sanitized = String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted-secret]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    .replace(/https?:\/\/[^\s)]+/g, '[redacted-url]')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, Math.max(0, maxLength - 16)).trimEnd()} ...[truncated]`;
  }

  return sanitized;
}

export function createEvent(input, signal, prompt, env = process.env) {
  const sessionId = String(input.session_id || 'unknown-session');
  const promptId = String(input.prompt_id || hash(prompt || nowIso()));
  const cwd = String(input.cwd || process.cwd());
  const id = `${safeSegment(sessionId)}-${safeSegment(promptId)}-${hash(cwd)}`;
  const eventPath = path.join(eventsDir(env), `${id}.json`);

  return {
    id,
    cwd,
    eventPath,
    excerpt: sanitizeExcerpt(prompt),
    promptId,
    sessionId,
    signal,
    status: 'pending',
    attempts: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function writeEvent(event) {
  fs.mkdirSync(path.dirname(event.eventPath), { recursive: true });
  fs.writeFileSync(event.eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return event;
}

export function readEvent(eventPath) {
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function listEvents(env = process.env) {
  const dir = eventsDir(env);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => {
        return name.endsWith('.json');
      })
      .map((name) => {
        return readEvent(path.join(dir, name));
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function findPendingEvent(input, env = process.env) {
  const cwd = String(input.cwd || process.cwd());
  const sessionId = String(input.session_id || 'unknown-session');
  return (
    listEvents(env)
      .filter((event) => {
        return event.status === 'pending';
      })
      .filter((event) => {
        return event.cwd === cwd;
      })
      .filter((event) => {
        return event.sessionId === sessionId;
      })
      .sort((a, b) => {
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      })[0] || null
  );
}

export function markEventStatus(eventPath, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid feedback event status: ${status}`);
  }

  const event = readEvent(eventPath);
  if (!event) {
    throw new Error(`Feedback event not found: ${eventPath}`);
  }

  event.status = status;
  event.updatedAt = nowIso();
  return writeEvent(event);
}

export function incrementAttempts(eventPath) {
  const event = readEvent(eventPath);
  if (!event) {
    throw new Error(`Feedback event not found: ${eventPath}`);
  }

  event.attempts = Number(event.attempts || 0) + 1;
  event.updatedAt = nowIso();
  return writeEvent(event);
}

function printUsage() {
  process.stderr.write(
    'Usage: node hooks/agent-feedback-state.js mark <eventPath> <pending|processing|updated|proposed|no-durable-update|blocked>\n',
  );
}

function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const eventPath = args[1];
  const status = args[2];
  if (command !== 'mark' || !eventPath || !status) {
    printUsage();
    return 2;
  }

  const event = markEventStatus(eventPath, status);
  process.stdout.write(`${JSON.stringify({ eventPath: event.eventPath, status: event.status })}\n`);
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
