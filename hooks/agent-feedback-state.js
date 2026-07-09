// @ts-check

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'pending' | 'processing' | 'updated' | 'proposed' | 'no-durable-update' | 'blocked'} FeedbackStatus
 */

/**
 * @typedef {{
 *   cwd?: string;
 *   hook_event_name?: string;
 *   last_assistant_message?: string;
 *   prompt?: string;
 *   prompt_id?: string;
 *   session_id?: string;
 *   stop_hook_active?: boolean;
 * }} HookInput
 */

/**
 * @typedef {{
 *   id: string;
 *   cwd: string;
 *   eventPath: string;
 *   excerpt: string;
 *   promptId: string;
 *   sessionId: string;
 *   signal: string;
 *   status: FeedbackStatus;
 *   attempts: number;
 *   createdAt: string;
 *   updatedAt: string;
 * }} FeedbackEvent
 */

/** @type {Set<string>} */
const VALID_STATUSES = new Set(['pending', 'processing', 'updated', 'proposed', 'no-durable-update', 'blocked']);

/**
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {string} Directory used to store feedback state.
 */
function stateRoot(env = process.env) {
  if (env.AGENT_FEEDBACK_STATE_DIR) {
    return env.AGENT_FEEDBACK_STATE_DIR;
  }
  if (env.PLUGIN_DATA) {
    return path.join(env.PLUGIN_DATA, 'agent-feedback-loop');
  }
  if (env.CLAUDE_PLUGIN_DATA) {
    return path.join(env.CLAUDE_PLUGIN_DATA, 'agent-feedback-loop');
  }
  if (env.CLAUDE_CONFIG_DIR) {
    return path.join(env.CLAUDE_CONFIG_DIR, 'agent-feedback-loop');
  }
  return path.join(os.homedir(), '.claude', 'agent-feedback-loop');
}

/**
 * @param {unknown} value - Value to hash.
 * @returns {string} Stable short hash.
 */
function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/**
 * @param {unknown} value - Value to convert into a path-safe segment.
 * @returns {string} Safe path segment.
 */
function safeSegment(value) {
  return (
    String(value || 'unknown')
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .slice(0, 80) || 'unknown'
  );
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {string} Directory that contains event JSON files.
 */
function eventsDir(env = process.env) {
  return path.join(stateRoot(env), 'events');
}

/**
 * @returns {string} Current timestamp as an ISO string.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>} Whether the value is a plain record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is FeedbackStatus} Whether the value is a supported event status.
 */
function isFeedbackStatus(value) {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

/**
 * @param {unknown} value - Parsed event JSON.
 * @returns {FeedbackEvent | null} Feedback event when the parsed value has a valid status.
 */
function toFeedbackEvent(value) {
  if (!isRecord(value) || !isFeedbackStatus(value.status)) {
    return null;
  }

  return {
    id: String(value.id || ''),
    cwd: String(value.cwd || ''),
    eventPath: String(value.eventPath || ''),
    excerpt: String(value.excerpt || ''),
    promptId: String(value.promptId || ''),
    sessionId: String(value.sessionId || ''),
    signal: String(value.signal || ''),
    status: value.status,
    attempts: Number(value.attempts || 0),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
  };
}

/**
 * @param {unknown} text - Text to sanitize.
 * @param {number} [maxLength] - Maximum output length.
 * @returns {string} Sanitized excerpt.
 */
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

/**
 * @param {HookInput} input - Hook input payload.
 * @param {string} signal - Classified feedback signal.
 * @param {string} prompt - Original prompt text.
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {FeedbackEvent} New pending feedback event.
 */
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

/**
 * @param {FeedbackEvent} event - Event to persist.
 * @returns {FeedbackEvent} Persisted event.
 */
export function writeEvent(event) {
  fs.mkdirSync(path.dirname(event.eventPath), { recursive: true });
  fs.writeFileSync(event.eventPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return event;
}

/**
 * @param {string} eventPath - Event JSON path.
 * @returns {FeedbackEvent | null} Parsed event, or null when unavailable.
 */
export function readEvent(eventPath) {
  try {
    return toFeedbackEvent(JSON.parse(fs.readFileSync(eventPath, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    return null;
  }
}

/**
 * @param {string} text - Raw JSON text.
 * @returns {HookInput | null} Parsed hook input record, or null for invalid input.
 */
export function readJsonFromString(text) {
  try {
    const parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    if (!isRecord(parsed)) {
      return null;
    }

    /** @type {HookInput} */
    const input = parsed;
    return input;
  } catch {
    return null;
  }
}

/**
 * @param {number} [timeoutMs] - Maximum wait time for stdin.
 * @returns {Promise<HookInput | null>} Parsed stdin input, or null on timeout or invalid input.
 */
export function readStdinWithTimeout(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let input = '';
    let done = false;

    function finish() {
      if (done) {
        return;
      }
      done = true;
      resolve(readJsonFromString(input));
    }

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, timeoutMs).unref();
  });
}

/**
 * @param {number} [timeoutMs] - Maximum wait time for stdin.
 * @returns {Promise<HookInput | null>} Parsed stdin input, or null on timeout or invalid input.
 */
export function readJsonFromStdin(timeoutMs = 1000) {
  return readStdinWithTimeout(timeoutMs);
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {FeedbackEvent[]} Stored feedback events.
 */
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
      .filter((event) => {
        return event !== null;
      });
  } catch {
    return [];
  }
}

/**
 * @param {HookInput} input - Hook input used to match cwd and session.
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {FeedbackEvent | null} Newest pending event for the input scope.
 */
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

/**
 * @param {string} eventPath - Event JSON path.
 * @param {unknown} status - Status to write after validation.
 * @returns {FeedbackEvent} Updated event.
 */
export function markEventStatus(eventPath, status) {
  if (!isFeedbackStatus(status)) {
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

/**
 * @param {string} eventPath - Event JSON path.
 * @returns {FeedbackEvent} Event with incremented attempt count.
 */
export function incrementAttempts(eventPath) {
  const event = readEvent(eventPath);
  if (!event) {
    throw new Error(`Feedback event not found: ${eventPath}`);
  }

  event.attempts = Number(event.attempts || 0) + 1;
  event.updatedAt = nowIso();
  return writeEvent(event);
}

/**
 * @returns {void} No return value.
 */
function printUsage() {
  process.stderr.write(
    'Usage: node hooks/agent-feedback-state.js mark <eventPath> <pending|processing|updated|proposed|no-durable-update|blocked>\n',
  );
}

/**
 * @param {string[]} argv - CLI arguments.
 * @returns {number} Process exit code.
 */
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
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
