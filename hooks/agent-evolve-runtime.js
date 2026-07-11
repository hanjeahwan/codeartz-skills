// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {import('./agent-evolve-state.js').Mode} Mode
 */

/**
 * @typedef {{
 *   cwd?: string;
 *   hook_event_name?: string;
 *   prompt?: string;
 *   session_id?: string;
 *   source?: string;
 * }} HookInput
 */

/**
 * @typedef {{
 *   eventName: 'SessionStart' | 'UserPromptSubmit';
 *   additionalContext?: string;
 *   systemMessage?: string;
 *   continueValue?: boolean;
 * }} HookOutputOptions
 */

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillPath = path.join(pluginRoot, 'skills', 'agent-evolve', 'SKILL.md');

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>} Whether the value is a non-array record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {string} Stable error message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {number} [timeoutMs] - Maximum wait for stdin.
 * @returns {Promise<HookInput | null>} Parsed hook input or null on timeout/invalid JSON.
 */
export function readStdinWithTimeout(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let input = '';
    let done = false;

    /** @returns {void} */
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
 * @param {string} markdown - Skill file with YAML frontmatter.
 * @returns {string} Trimmed skill body without frontmatter.
 */
export function stripFrontmatter(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Agent Evolve skill frontmatter is missing.');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('Agent Evolve skill frontmatter is incomplete.');
  }
  const body = normalized.slice(end + 5).trim();
  if (!body) {
    throw new Error('Agent Evolve skill body is empty.');
  }
  return body;
}

/**
 * @param {string} filePath - Authority file path.
 * @param {'skill' | 'workflow' | 'validation'} label - Authority source label.
 * @returns {string} Trimmed normalized file body.
 */
function readInstructionSource(filePath, label) {
  let body;
  try {
    body = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read Agent Evolve ${label} at ${filePath}: ${errorMessage(error)}`);
  }
  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new Error(`Agent Evolve ${label} is empty at ${filePath}.`);
  }
  return normalized;
}

/**
 * @param {string} [skillPath] - Skill path override for tests.
 * @returns {string} Self-contained ruleset assembled from all authority files.
 */
export function loadInstructionBundle(skillPath = defaultSkillPath) {
  const skillDirectory = path.dirname(skillPath);
  const workflowPath = path.join(skillDirectory, 'references', 'workflow.md');
  const validationPath = path.join(skillDirectory, 'references', 'validation.md');
  const skillBody = stripFrontmatter(readInstructionSource(skillPath, 'skill'));
  const workflow = readInstructionSource(workflowPath, 'workflow');
  const validation = readInstructionSource(validationPath, 'validation');
  return [skillBody, workflow, validation].join('\n\n');
}

/**
 * @param {Mode} mode - Active safe or review mode.
 * @param {string} bundle - Self-contained Agent Evolve ruleset.
 * @returns {string} Context injected into a main session.
 */
export function buildActivationContext(mode, bundle) {
  if (mode !== 'safe' && mode !== 'review') {
    throw new Error(`Cannot build Agent Evolve activation context for mode: ${mode}`);
  }
  return `AGENT EVOLVE ACTIVE — mode: ${mode}\n\n${bundle.trim()}`;
}

/**
 * @returns {string} Context that disables automatic behavior after a session switch.
 */
export function buildOffContext() {
  return [
    'AGENT EVOLVE OFF — automatic feedback recognition and persistence are disabled for this session.',
    'Manual $agent-evolve invocation remains available.',
  ].join('\n');
}

/**
 * @param {HookOutputOptions} options - Hook output fields.
 * @returns {string} Serialized supported hook output, or empty string for silence.
 */
export function buildHookOutput({ eventName, additionalContext = '', systemMessage = '', continueValue }) {
  /** @type {Record<string, unknown>} */
  const output = {};
  if (typeof continueValue === 'boolean') {
    output.continue = continueValue;
  }
  if (systemMessage) {
    output.systemMessage = systemMessage;
  }
  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: eventName,
      additionalContext,
    };
  }
  return Object.keys(output).length > 0 ? JSON.stringify(output) : '';
}

/**
 * @param {'SessionStart' | 'UserPromptSubmit'} eventName - Hook event that failed.
 * @param {string} action - Human-readable action.
 * @param {unknown} error - Actual failure.
 * @returns {string} Visible, non-blocking failure output.
 */
export function buildFailureOutput(eventName, action, error) {
  const evidence = errorMessage(error);
  return buildHookOutput({
    eventName,
    continueValue: true,
    systemMessage: `Agent Evolve failed: ${action}. Evidence: ${evidence}`,
    additionalContext: [
      'AGENT EVOLVE FAILURE',
      `Why: ${action} failed; automatic feedback persistence was not changed for this event.`,
      `Evidence: ${evidence}`,
      'Continue the current user task without relying on automatic Agent Evolve behavior.',
    ].join('\n'),
  });
}

/**
 * @param {string} text - Serialized hook output.
 * @returns {void} No return value.
 */
export function writeStdoutSafely(text) {
  if (!text) {
    return;
  }
  try {
    process.stdout.write(text);
  } catch {
    // A closed hook stdout must not block the user session.
  }
}
