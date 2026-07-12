// @ts-check

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  buildOffContext,
  readStdinWithTimeout,
  writeStdoutSafely,
} from './agent-evolve-runtime.js';
import { readDefaultMode, readSessionMode, writeDefaultMode, writeSessionMode } from './agent-evolve-state.js';

/**
 * @typedef {import('./agent-evolve-state.js').Mode} Mode
 * @typedef {import('./agent-evolve-runtime.js').HookInput} HookInput
 * @typedef {{ scope: 'session' | 'default'; mode: Mode }} ModeCommand
 */

/** @type {readonly ['$agent-evolve', '/agent-evolve', '@agent-evolve']} */
const PREFIXES = ['$agent-evolve', '/agent-evolve', '@agent-evolve'];
/** @type {readonly Mode[]} */
const MODES = ['safe', 'review', 'off'];
/** @type {Map<string, ModeCommand>} */
const COMMANDS = new Map();

for (const prefix of PREFIXES) {
  for (const mode of MODES) {
    COMMANDS.set(`${prefix} ${mode}`, { scope: 'session', mode });
    COMMANDS.set(`${prefix} default ${mode}`, { scope: 'default', mode });
  }
}

/**
 * @param {unknown} prompt - Raw user prompt.
 * @returns {ModeCommand | null} Exact approved command or null.
 */
export function parseModeCommand(prompt) {
  return COMMANDS.get(String(prompt || '').trim()) || null;
}

/**
 * @param {Mode} currentMode - Effective current session mode.
 * @param {Mode} defaultMode - Persistent default mode.
 * @returns {string} Visible status line.
 */
function modeStatus(currentMode, defaultMode) {
  return `Agent Evolve mode: ${currentMode}; default: ${defaultMode}`;
}

/**
 * @param {Mode} mode - New current session mode.
 * @param {Mode} defaultMode - Persistent default mode.
 * @returns {string} Context applied after a current-session switch.
 */
function sessionSwitchContext(mode, defaultMode) {
  const activeContext = mode === 'off' ? buildOffContext() : buildActivationContext(mode);
  return [
    activeContext,
    '',
    'AGENT EVOLVE MODE STATUS',
    `Current session mode: ${mode}`,
    `Persistent default mode: ${defaultMode}`,
  ].join('\n');
}

/**
 * @param {Mode} currentMode - Unchanged current session mode.
 * @param {Mode} defaultMode - New persistent default mode.
 * @returns {string} Context applied after a default switch.
 */
function defaultSwitchContext(currentMode, defaultMode) {
  return [
    'AGENT EVOLVE DEFAULT UPDATED',
    `Current session mode remains: ${currentMode}`,
    `Persistent default mode: ${defaultMode}`,
    'The new default applies only to future sessions.',
  ].join('\n');
}

/**
 * @param {HookInput} input - UserPromptSubmit hook payload.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {string} Serialized hook output or empty string.
 */
export function handleUserPromptSubmit(input, env = process.env) {
  const command = parseModeCommand(input.prompt);
  if (!command) {
    return '';
  }

  try {
    const sessionId = String(input.session_id || '');
    if (command.scope === 'session') {
      const defaultMode = readDefaultMode(env);
      const additionalContext = sessionSwitchContext(command.mode, defaultMode);
      writeSessionMode(sessionId, command.mode, env);
      return buildHookOutput({
        eventName: 'UserPromptSubmit',
        additionalContext,
        systemMessage: modeStatus(command.mode, defaultMode),
      });
    }

    const currentMode = readSessionMode(sessionId, env);
    if (currentMode === null) {
      throw new Error('Current Agent Evolve session state is missing; run SessionStart before changing the default');
    }
    writeDefaultMode(command.mode, env);
    return buildHookOutput({
      eventName: 'UserPromptSubmit',
      additionalContext: defaultSwitchContext(currentMode, command.mode),
      systemMessage: modeStatus(currentMode, command.mode),
    });
  } catch (error) {
    return buildFailureOutput('UserPromptSubmit', 'mode switch', error);
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
  writeStdoutSafely(handleUserPromptSubmit(input, env));
}
