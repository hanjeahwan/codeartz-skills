// @ts-check

import { buildHookOutput, writeStdoutSafely } from './agent-feedback-runtime.js';
import { findPendingEvent, incrementAttempts, markEventStatus, readStdinWithTimeout } from './agent-feedback-state.js';

/**
 * @typedef {import('./agent-feedback-state.js').FeedbackEvent} FeedbackEvent
 * @typedef {import('./agent-feedback-state.js').HookInput} HookInput
 * @typedef {{ status?: unknown; attempts?: unknown }} AttemptStatusEvent
 */

const MAX_STOP_ATTEMPTS = 3;

/**
 * @param {HookInput} input - Stop hook payload.
 * @param {AttemptStatusEvent | null | undefined} event - Pending event attempt state.
 * @param {number} [maxAttempts] - Maximum reminder attempts before blocking.
 * @returns {boolean} Whether the hook should request another agent turn.
 */
export function shouldContinueForEvent(input, event, maxAttempts = MAX_STOP_ATTEMPTS) {
  if (!event || event.status !== 'pending') {
    return false;
  }
  if (input.stop_hook_active) {
    return false;
  }
  return Number(event.attempts || 0) < maxAttempts;
}

/**
 * @param {FeedbackEvent} event - Pending event to surface to the agent.
 * @returns {string} Additional context injected into the Stop hook response.
 */
function buildStopContext(event) {
  return [
    'Unprocessed durable feedback event is still pending.',
    `Excerpt: ${event.excerpt}`,
    `Event path: ${event.eventPath}`,
    'Use the agent-feedback-loop skill now.',
    'Resolve the event as Updated, Proposed, or No durable update made.',
    'After handling the event, mark the event status with `node hooks/agent-feedback-state.js mark <eventPath> <updated|proposed|no-durable-update|blocked>`.',
  ].join('\n');
}

/**
 * @param {NodeJS.ProcessEnv} [env] - Environment variables from the hook host.
 * @returns {Promise<void>} Resolves after Stop hook input is processed.
 */
export async function main(env = process.env) {
  const input = await readStdinWithTimeout(1000);
  if (!input || input.hook_event_name !== 'Stop') {
    return;
  }

  const event = findPendingEvent(input, env);
  if (!event) {
    return;
  }

  if (!shouldContinueForEvent(input, event)) {
    if (!input.stop_hook_active && Number(event.attempts || 0) >= MAX_STOP_ATTEMPTS) {
      markEventStatus(event.eventPath, 'blocked');
    }
    return;
  }

  const updatedEvent = incrementAttempts(event.eventPath);
  const output = buildHookOutput({
    eventName: 'Stop',
    additionalContext: buildStopContext(updatedEvent),
    systemMessage: 'AGENT-FEEDBACK:PENDING',
    env,
  });

  writeStdoutSafely(output);
}

if (process.argv[1] && process.argv[1].endsWith('agent-feedback-stop.js')) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
