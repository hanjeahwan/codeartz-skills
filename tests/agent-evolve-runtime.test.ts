import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildActivationContext,
  buildFailureOutput,
  buildHookOutput,
  buildOffContext,
  loadSkillBody,
  readJsonFromString,
  stripFrontmatter,
} from '../hooks/agent-evolve-runtime.js';

test('readJsonFromString accepts only JSON records', () => {
  assert.deepEqual(readJsonFromString('{"hook_event_name":"SessionStart","session_id":"s1"}'), {
    hook_event_name: 'SessionStart',
    session_id: 's1',
  });
  assert.equal(readJsonFromString('{bad json'), null);
  assert.equal(readJsonFromString('[]'), null);
  assert.equal(readJsonFromString('"text"'), null);
});

test('stripFrontmatter removes exactly the YAML envelope and keeps the skill body', () => {
  const markdown = [
    '---',
    'name: agent-evolve',
    'description: test',
    '---',
    '',
    '# Agent Evolve',
    '',
    '- Rule one.',
    '',
  ].join('\n');

  assert.equal(stripFrontmatter(markdown), '# Agent Evolve\n\n- Rule one.');
  assert.throws(() => {
    return stripFrontmatter('# Missing frontmatter');
  }, /frontmatter is missing/);
  assert.throws(() => {
    return stripFrontmatter('---\nname: broken');
  }, /frontmatter is incomplete/);
});

test('loadSkillBody reads a complete skill and rejects unreadable or partial input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-skill-'));
  const skillPath = path.join(root, 'SKILL.md');
  fs.writeFileSync(
    skillPath,
    '---\nname: agent-evolve\ndescription: test\n---\n\n# Agent Evolve\n\nUse the workflow.\n',
    'utf8',
  );

  assert.equal(loadSkillBody(skillPath), '# Agent Evolve\n\nUse the workflow.');
  assert.throws(() => {
    return loadSkillBody(path.join(root, 'missing.md'));
  }, /Unable to read Agent Evolve skill/);

  fs.writeFileSync(skillPath, '---\nname: agent-evolve', 'utf8');
  assert.throws(() => {
    return loadSkillBody(skillPath);
  }, /frontmatter is incomplete/);
});

test('buildActivationContext uses the approved header and never leaks frontmatter', () => {
  const context = buildActivationContext('review', '# Agent Evolve\n\nRead `references/workflow.md`.');

  assert.equal(context, 'AGENT EVOLVE ACTIVE — mode: review\n\n# Agent Evolve\n\nRead `references/workflow.md`.');
  assert.doesNotMatch(context, /^---/m);
});

test('buildOffContext disables automatic behavior but preserves manual invocation', () => {
  const context = buildOffContext();
  assert.match(context, /AGENT EVOLVE OFF/);
  assert.match(context, /automatic feedback recognition and persistence are disabled/);
  assert.match(context, /Manual \$agent-evolve invocation remains available/);
});

test('buildHookOutput uses a shape supported by Codex and Claude Code', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'SessionStart',
      additionalContext: 'AGENT EVOLVE ACTIVE — mode: safe',
    }),
  );

  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'AGENT EVOLVE ACTIVE — mode: safe',
    },
  });
  assert.equal(buildHookOutput({ eventName: 'UserPromptSubmit' }), '');
});

test('buildHookOutput includes systemMessage only when explicitly requested', () => {
  const output = JSON.parse(
    buildHookOutput({
      eventName: 'UserPromptSubmit',
      additionalContext: 'Current session mode is review.',
      systemMessage: 'Agent Evolve mode: review; default: safe',
    }),
  );

  assert.equal(output.systemMessage, 'Agent Evolve mode: review; default: safe');
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('buildFailureOutput provides visible, non-blocking evidence', () => {
  const output = JSON.parse(
    buildFailureOutput('SessionStart', 'session activation', new Error('config.json is invalid')),
  );

  assert.match(output.systemMessage, /Agent Evolve failed: session activation/);
  assert.match(output.systemMessage, /config\.json is invalid/);
  assert.match(output.hookSpecificOutput.additionalContext, /Why: session activation failed/);
  assert.match(output.hookSpecificOutput.additionalContext, /Evidence: config\.json is invalid/);
  assert.match(output.hookSpecificOutput.additionalContext, /Continue the current user task/);
  assert.equal(output.continue, true);
});
