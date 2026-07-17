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
    '先过排除门：空泛目标、当前事实、一次性操作边界、局部细节、无决策差异的失败、无佐证观察、明确禁止泛化，或当前任务只执行现有规则且用户与证据未提出候选时，直接完成普通任务；禁止加载 Skill、补写提案或输出回执。',
    '仅当候选已具备可观察条件、明确决策后果、可靠依据和未来决策差异时自动触发；“以后”“必须”等词不能补齐缺失语义。',
    '发送最终回复前必须回答：本轮是否作出了由用户权限或任务证据已经确定、未来会重现的 A→B 选择；是则立即加载 Skill，不要求先发生故障或用户提及规则；Agent 自行建议或待确认合同不算。',
    '任务证据与有效项目规则冲突时，在修改实现或测试前加载 Skill 并停止选边。',
    '任务证据候选未经用户确认只能提案；主观 Agent 观察需独立证据；未批准的高风险变更也只能提案。',
    '触发后：按名称加载已安装的 `agent-evolve` Skill，并按当前模式执行其路由。',
    '用户明确要求项目沉淀或手动调用 `$agent-evolve` 时仍可加载；其他普通请求禁止加载。',
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
