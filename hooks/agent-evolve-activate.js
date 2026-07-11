// @ts-check

import { fileURLToPath } from 'node:url';

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  loadInstructionBundle,
  readStdinWithTimeout,
  writeStdoutSafely,
} from './agent-evolve-runtime.js';
import { getOrCreateSessionMode } from './agent-evolve-state.js';

/**
 * @typedef {import('./agent-evolve-runtime.js').HookInput} HookInput
 */

/**
 * @param {HookInput} input - SessionStart hook payload.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {string} [skillPath] - Skill path override for tests.
 * @returns {string} Serialized hook output or empty string.
 */
export function handleSessionStart(input, env = process.env, skillPath) {
  if (input.hook_event_name !== 'SessionStart') {
    return '';
  }

  try {
    const sessionId = String(input.session_id || '');
    const mode = getOrCreateSessionMode(sessionId, env);
    if (mode === 'off') {
      return '';
    }
    const instructionBundle = loadInstructionBundle(skillPath);
    return buildHookOutput({
      eventName: 'SessionStart',
      additionalContext: buildActivationContext(mode, instructionBundle),
    });
  } catch (error) {
    return buildFailureOutput('SessionStart', 'session activation', error);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Promise<void>} Resolves after stdin is processed.
 */
export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input) {
    return;
  }
  writeStdoutSafely(handleSessionStart(input, env));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
