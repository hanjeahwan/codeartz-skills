// @ts-check

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
 *   tool_input?: Record<string, unknown>;
 *   tool_name?: string;
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
 * @param {Mode} mode - Active safe or review mode.
 * @returns {string} Host-independent lazy-loading route injected into a main session.
 */
export function buildActivationContext(mode) {
  if (mode !== 'safe' && mode !== 'review') {
    throw new Error(`Cannot build Agent Evolve activation context for mode: ${mode}`);
  }
  return [
    `AGENT EVOLVE ACTIVE — mode: ${mode}`,
    '自动触发：当前主会话中，用户直接提出了已明确收敛且可改进未来项目决策的反馈。',
    '当前结果仍在修正或验收时不触发；用户明确确认终态后再加载 Skill。',
    '触发后：按名称加载已安装的 `agent-evolve` Skill，并按当前模式执行其路由。',
    '普通请求禁止加载。必须根据完整语义判断，禁止仅依赖关键词。',
    '仍可手动调用 `$agent-evolve`。',
  ].join('\n');
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
