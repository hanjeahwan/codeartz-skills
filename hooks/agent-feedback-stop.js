import { buildHookOutput, writeStdoutSafely } from './agent-feedback-runtime.js';
import { findPendingEvent, incrementAttempts, markEventStatus, readStdinWithTimeout } from './agent-feedback-state.js';

const MAX_STOP_ATTEMPTS = 3;

export function shouldContinueForEvent(input, event, maxAttempts = MAX_STOP_ATTEMPTS) {
  if (!event || event.status !== 'pending') {
    return false;
  }
  if (input.stop_hook_active) {
    return false;
  }
  return Number(event.attempts || 0) < maxAttempts;
}

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
