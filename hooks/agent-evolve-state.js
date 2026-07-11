// @ts-check

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {'safe' | 'review' | 'off'} Mode
 */

/**
 * @typedef {{ defaultMode: Mode }} DefaultConfig
 */

/**
 * @typedef {{ mode: Mode; updatedAt: string }} SessionState
 */

/** @type {ReadonlySet<string>} */
const MODES = new Set(['safe', 'review', 'off']);

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>} Whether the value is a non-array record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is Mode} Whether the value is an Agent Evolve mode.
 */
export function isMode(value) {
  return typeof value === 'string' && MODES.has(value);
}

/**
 * @param {Record<string, unknown>} value - Object whose keys must be checked.
 * @param {string[]} expected - Exact allowed keys.
 * @returns {boolean} Whether the object has exactly the expected keys.
 */
function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => {return key === [...expected].sort()[index]});
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is DefaultConfig} Whether the value matches the default config schema.
 */
function isDefaultConfig(value) {
  return isRecord(value) && hasExactKeys(value, ['defaultMode']) && isMode(value.defaultMode);
}

/**
 * @param {unknown} value - Value to test.
 * @returns {value is SessionState} Whether the value matches the session state schema.
 */
function isSessionState(value) {
  if (!isRecord(value) || !hasExactKeys(value, ['mode', 'updatedAt']) || !isMode(value.mode)) {
    return false;
  }
  if (typeof value.updatedAt !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value.updatedAt);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value.updatedAt;
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {string} Stable error message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error - Thrown value.
 * @returns {boolean} Whether the error represents a missing path.
 */
function isMissing(error) {
  return isRecord(error) && error.code === 'ENOENT';
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {NodeJS.Platform} [platform] - Platform override for tests.
 * @param {string} [homeDir] - Home directory override for tests.
 * @returns {string} Persistent default configuration path.
 */
export function defaultConfigPath(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (platform === 'win32') {
    if (!env.APPDATA) {
      throw new Error('APPDATA is required for Agent Evolve default config on Windows.');
    }
    return path.win32.join(env.APPDATA, 'codeartz-skills', 'agent-evolve', 'config.json');
  }
  const configRoot = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(configRoot, 'codeartz-skills', 'agent-evolve', 'config.json');
}

/**
 * @param {string} sessionId - Raw host session id.
 * @returns {string} Full lowercase SHA-256 digest.
 */
export function hashSessionId(sessionId) {
  if (!sessionId) {
    throw new Error('Agent Evolve requires a non-empty session_id.');
  }
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {string} Runtime-specific plugin data root.
 */
function pluginDataRoot(env = process.env) {
  const root = env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA;
  if (!root) {
    throw new Error('Agent Evolve plugin data directory is unavailable.');
  }
  return root;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {string} Session state path containing only the hashed id.
 */
export function sessionStatePath(sessionId, env = process.env) {
  return path.join(pluginDataRoot(env), 'agent-evolve', 'sessions', `${hashSessionId(sessionId)}.json`);
}

/**
 * @param {string} filePath - JSON file to read.
 * @param {string} label - Human-readable schema label.
 * @returns {{ exists: false } | { exists: true; value: unknown }} Parsed value or missing marker.
 */
function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    if (isMissing(error)) {
      return { exists: false };
    }
    throw new Error(`Unable to read ${label} at ${filePath}: ${errorMessage(error)}`);
  }

  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Invalid ${label} at ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * @param {string} filePath - Destination JSON path.
 * @param {DefaultConfig | SessionState} value - Valid state to serialize.
 * @returns {void} No return value.
 */
function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw new Error(`Unable to write Agent Evolve state at ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode} Persistent default mode, or built-in safe when the file is absent.
 */
export function readDefaultMode(env = process.env) {
  const filePath = defaultConfigPath(env);
  const result = readJsonFile(filePath, 'Agent Evolve default config');
  if (!result.exists) {
    return 'safe';
  }
  if (!isDefaultConfig(result.value)) {
    throw new Error(`Invalid Agent Evolve default config at ${filePath}: expected only defaultMode.`);
  }
  return result.value.defaultMode;
}

/**
 * @param {Mode} mode - New persistent default.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode} Persisted mode.
 */
export function writeDefaultMode(mode, env = process.env) {
  if (!isMode(mode)) {
    throw new Error(`Invalid Agent Evolve mode: ${String(mode)}`);
  }
  atomicWriteJson(defaultConfigPath(env), { defaultMode: mode });
  return mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @returns {Mode | null} Stored session mode, or null when no state exists.
 */
export function readSessionMode(sessionId, env = process.env) {
  const filePath = sessionStatePath(sessionId, env);
  const result = readJsonFile(filePath, 'Agent Evolve session state');
  if (!result.exists) {
    return null;
  }
  if (!isSessionState(result.value)) {
    throw new Error(`Invalid Agent Evolve session state at ${filePath}: expected only mode and updatedAt.`);
  }
  return result.value.mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {Mode} mode - New session mode.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {() => Date} [now] - Clock override for tests.
 * @returns {Mode} Persisted mode.
 */
export function writeSessionMode(sessionId, mode, env = process.env, now = () => {return new Date()}) {
  if (!isMode(mode)) {
    throw new Error(`Invalid Agent Evolve mode: ${String(mode)}`);
  }
  const state = { mode, updatedAt: now().toISOString() };
  atomicWriteJson(sessionStatePath(sessionId, env), state);
  return mode;
}

/**
 * @param {string} sessionId - Raw host session id.
 * @param {NodeJS.ProcessEnv} [env] - Host environment.
 * @param {() => Date} [now] - Clock override for tests.
 * @returns {Mode} Existing session mode or newly materialized default.
 */
export function getOrCreateSessionMode(sessionId, env = process.env, now = () => {return new Date()}) {
  const existing = readSessionMode(sessionId, env);
  if (existing) {
    return existing;
  }
  const mode = readDefaultMode(env);
  return writeSessionMode(sessionId, mode, env, now);
}
