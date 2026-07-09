// @ts-check

/**
 * @typedef {'codex' | 'claude' | 'unknown'} Runtime
 */

/**
 * @typedef {{
 *   eventName: string;
 *   additionalContext?: string;
 *   systemMessage?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} HookOutputOptions
 */

/**
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {Runtime} Detected hook runtime.
 */
export function detectRuntime(env = process.env) {
  if (env.PLUGIN_DATA) {
    return 'codex';
  }
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_PLUGIN_DATA || env.CLAUDE_CONFIG_DIR) {
    return 'claude';
  }
  return 'unknown';
}

/**
 * @param {HookOutputOptions} options - Hook output fields.
 * @returns {string} Serialized hook output, or an empty string when no output is needed.
 */
export function buildHookOutput({ eventName, additionalContext = '', systemMessage = '', env = process.env }) {
  const runtime = detectRuntime(env);
  /** @type {Partial<{ systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } }>} */
  const output = {};

  if (runtime === 'codex' && systemMessage) {
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
 * @param {string} text - Text to write to stdout.
 */
export function writeStdoutSafely(text) {
  if (!text) {
    return;
  }
  try {
    process.stdout.write(text);
  } catch {
    // Hook stdout can close during process shutdown; keep hooks best-effort.
  }
}
