export function detectRuntime(env = process.env) {
  if (env.PLUGIN_DATA) {
    return 'codex';
  }
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_CONFIG_DIR) {
    return 'claude';
  }
  return 'unknown';
}

export function buildHookOutput({ eventName, additionalContext = '', systemMessage = '', env = process.env }) {
  const runtime = detectRuntime(env);
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
