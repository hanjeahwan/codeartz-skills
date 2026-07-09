import { buildHookOutput, writeStdoutSafely } from './agent-feedback-runtime.js';
import { createEvent, readStdinWithTimeout, writeEvent } from './agent-feedback-state.js';

const EXPLICIT_SOURCE_RE =
  /\b(AGENTS\.md|CLAUDE\.md|README\.md|rules?|guide|handbook|manual|policy|conventions?|instructions?)\b/i;
const CHINESE_SOURCE_RE = /(规则源|规则|手册|规范|指令|约定|文档)/;
const FUTURE_BEHAVIOR_RE = /(以后|下次|以后不要|不要再|应该先|必须先|刚才的问题|刚才错|这次的问题)/;
const MEMORY_TO_RULE_RE = /(记住|沉淀|长期规则|写进|更新|放进|加到|合并到)/;
const ENGLISH_FEEDBACK_RE =
  /\b(remember this|next time|from now on|do not do this again|write this into|add this to|update the rule|update the docs|durable rule|long-term rule)\b/i;

export function classifyPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return null;
  }

  if (
    (EXPLICIT_SOURCE_RE.test(text) || CHINESE_SOURCE_RE.test(text)) &&
    /(写进|更新|放进|加到|合并|write|add|update)/i.test(text)
  ) {
    return { signal: 'durable-feedback', reason: 'explicit-rule-source' };
  }

  if (MEMORY_TO_RULE_RE.test(text) && (CHINESE_SOURCE_RE.test(text) || ENGLISH_FEEDBACK_RE.test(text))) {
    return { signal: 'durable-feedback', reason: 'memory-to-rule' };
  }

  if (FUTURE_BEHAVIOR_RE.test(text) || ENGLISH_FEEDBACK_RE.test(text)) {
    return { signal: 'durable-feedback', reason: 'future-behavior' };
  }

  return null;
}

function buildCaptureContext(event, reason) {
  return [
    'Pending durable feedback event detected.',
    `Signal: ${event.signal}`,
    `Reason: ${reason}`,
    `Excerpt: ${event.excerpt}`,
    `Event path: ${event.eventPath}`,
    'Use the agent-feedback-loop skill before finishing this turn.',
    'After handling the event, mark the event status with `node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>`.',
  ].join('\n');
}

export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input || input.hook_event_name !== 'UserPromptSubmit') {
    return;
  }

  const prompt = String(input.prompt || '');
  const classification = classifyPrompt(prompt);
  if (!classification) {
    return;
  }

  const event = writeEvent(createEvent(input, classification.signal, prompt, env));
  const output = buildHookOutput({
    eventName: 'UserPromptSubmit',
    additionalContext: buildCaptureContext(event, classification.reason),
    systemMessage: 'AGENT-FEEDBACK:PENDING',
    env,
  });

  writeStdoutSafely(output);
}

if (process.argv[1] && process.argv[1].endsWith('agent-feedback-capture.js')) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
