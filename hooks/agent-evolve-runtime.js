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
    'Agent Evolve 只维护当前项目中会改变未来 Agent 行动的决策规则。',
    '任务分离：关闭 Agent Evolve 后，当前任务本来仍须交付的条件、后果和作用域只算任务交付；目标文件不同不能证明独立。相同依据还能约束未来同类任务、且超出当前交付范围时，只把额外语义作为候选。',
    '自动入口：额外信息能形成包含适用条件、决策后果、可靠依据和未来差异的决策记录时，加载已安装的 agent-evolve Skill。项目合同直接排除或优先可行方案就是依据，不要求先失败；发送最终回复前逐项检查全部独立记录。',
    '选型关卡：本轮依据可复用的项目合同在多个可行方案中作出选择时，必须检查该条件与选择是否会指导未来同类任务；会指导时建立决策记录并加载 Skill，不得因当前实现已经完成而跳过。',
    '入口排除：空泛口号、普通否定、局部事实、一次性动作和无项目证据的 runner 或 sandbox 限制不加载 Skill，也不输出回执。',
    '显式入口：用户点名 Agent Evolve、要求项目沉淀或评估可能成为规则的反馈时必须加载 Skill；作用域、重复、冲突和正式结果只能由工作流判断。',
    '模式：safe 预授权通过安全门的任何来源候选自动写入，来源只影响依据，不新增确认门；review 只提案，批准后再写；用户当前禁止写入时不得覆盖。任务证据与有效规则冲突时，修改实现或测试前加载 Skill 并停止选边。',
  ].join('\n');
}

/**
 * @returns {string} Context that disables automatic behavior after a session switch.
 */
export function buildOffContext() {
  return [
    'AGENT EVOLVE OFF — automatic feedback recognition and persistence are disabled for this session.',
    'Manual $agent-evolve invocation remains available.',
    'Do not persist project rules unless the user manually invokes $agent-evolve.',
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
