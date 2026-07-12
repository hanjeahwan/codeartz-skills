// @ts-check

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
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
 * @returns {string} Serialized hook output or empty string.
 */
export function handleSessionStart(input, env = process.env) {
  try {
    const sessionId = String(input.session_id || '');
    const mode = getOrCreateSessionMode(sessionId, env);
    if (mode === 'off') {
      return '';
    }
    return buildHookOutput({
      eventName: 'SessionStart',
      additionalContext: buildActivationContext(mode),
      ...(env.PLUGIN_DATA ? { systemMessage: `AGENT-EVOLVE:${mode.toUpperCase()}` } : {}),
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
