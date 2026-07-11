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
  loadInstructionBundle,
  readJsonFromString,
  stripFrontmatter,
} from '../../hooks/agent-evolve-runtime.js';

function writeInstructionSources(root: string): string {
  const skillPath = path.join(root, 'SKILL.md');
  const references = path.join(root, 'references');
  fs.mkdirSync(references, { recursive: true });
  fs.writeFileSync(
    skillPath,
    '---\nname: agent-evolve\ndescription: test\n---\n\n# Agent Evolve\n\nUse the injected workflow.\n',
    'utf8',
  );
  fs.writeFileSync(path.join(references, 'workflow.md'), '# Agent Evolve Workflow\n\nJudge feedback.\n', 'utf8');
  fs.writeFileSync(path.join(references, 'validation.md'), '# Agent Evolve Validation\n\nReturn evidence.\n', 'utf8');
  return skillPath;
}

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

test('loadInstructionBundle materializes all authority files in order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-bundle-'));
  const bundle = loadInstructionBundle(writeInstructionSources(root));

  assert.equal(
    bundle,
    [
      '# Agent Evolve\n\nUse the injected workflow.',
      '# Agent Evolve Workflow\n\nJudge feedback.',
      '# Agent Evolve Validation\n\nReturn evidence.',
    ].join('\n\n'),
  );
  assert.doesNotMatch(bundle, /^---/m);
});

test('loadInstructionBundle rejects a missing authority file without returning a partial bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-missing-source-'));
  const skillPath = writeInstructionSources(root);
  fs.rmSync(path.join(root, 'references', 'workflow.md'));

  assert.throws(() => {
    return loadInstructionBundle(skillPath);
  }, /Unable to read Agent Evolve workflow/);
});

test('loadInstructionBundle rejects an empty authority file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-empty-source-'));
  const skillPath = writeInstructionSources(root);
  fs.writeFileSync(path.join(root, 'references', 'validation.md'), '  \n', 'utf8');

  assert.throws(() => {
    return loadInstructionBundle(skillPath);
  }, /Agent Evolve validation is empty/);
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
