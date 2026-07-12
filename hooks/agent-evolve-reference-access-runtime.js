// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { readStdinWithTimeout, writeStdoutSafely } from './agent-evolve-runtime.js';

/**
 * @typedef {{
 *   tool_input?: Record<string, unknown>;
 *   tool_name?: string;
 * }} PreToolUseInput
 */

const SAFE_READ_COMMAND = /^\s*(?:cat|head|tail|sed)\b/;
const SHELL_CONTROL = /(?:[;&|<>`]|\$\(|\r|\n)/;

/**
 * @param {string} candidate - Existing path candidate.
 * @returns {string | null} Canonical path, or null when it cannot be resolved.
 */
function realPath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

/**
 * @param {string} candidate - Candidate filesystem path.
 * @param {string} allowedRoot - Canonical allowed directory.
 * @returns {boolean} Whether the candidate resolves inside the allowed directory.
 */
export function isInsideAllowedRoot(candidate, allowedRoot) {
  const canonicalCandidate = realPath(candidate);
  if (!canonicalCandidate) {
    return false;
  }
  return canonicalCandidate === allowedRoot || canonicalCandidate.startsWith(`${allowedRoot}${path.sep}`);
}

/**
 * @param {string} command - Shell command from a tool call.
 * @returns {string[]} Absolute path tokens found in a conservative read-only command.
 */
export function extractSafeCommandPaths(command) {
  if (!SAFE_READ_COMMAND.test(command) || SHELL_CONTROL.test(command)) {
    return [];
  }
  return command.match(/\/(?:[^\s"'\\]+\/?)+/g) ?? [];
}

/**
 * @param {Record<string, unknown>} toolInput - Tool input payload.
 * @returns {string[]} Candidate paths used by direct reads or safe shell reads.
 */
export function extractCandidatePaths(toolInput) {
  const directPath = toolInput.file_path ?? toolInput.path;
  if (typeof directPath === 'string') {
    return [directPath];
  }
  return typeof toolInput.command === 'string' ? extractSafeCommandPaths(toolInput.command) : [];
}

/**
 * @param {PreToolUseInput | null} input - PreToolUse hook payload.
 * @param {NodeJS.ProcessEnv} [env] - Hook environment.
 * @returns {string} Permission output for an allowed reference read, otherwise silence.
 */
export function handleReferenceAccess(input, env = process.env) {
  if (!input || !input.tool_input || !env.CLAUDE_PLUGIN_ROOT) {
    return '';
  }
  const allowedRoot = realPath(path.join(env.CLAUDE_PLUGIN_ROOT, 'skills', 'agent-evolve', 'references'));
  if (!allowedRoot) {
    return '';
  }
  const candidates = extractCandidatePaths(input.tool_input);
  if (
    candidates.length === 0 ||
    !candidates.every((candidate) => {
      return isInsideAllowedRoot(candidate, allowedRoot);
    })
  ) {
    return '';
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Agent Evolve phase manual read',
    },
  });
}

/**
 * @returns {Promise<void>} Hook process completion.
 */
export async function main() {
  const input = await readStdinWithTimeout();
  writeStdoutSafely(handleReferenceAccess(input));
}
