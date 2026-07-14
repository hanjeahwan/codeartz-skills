import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  extractCandidatePaths,
  extractSafeCommandPaths,
  handleReferenceAccess,
  isInsideAllowedRoot,
} from '../../hooks/agent-evolve-reference-access-runtime.js';

function fixture() {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-evolve-reference-'));
  const references = path.join(pluginRoot, 'skills', 'agent-evolve', 'references');
  fs.mkdirSync(references, { recursive: true });
  const manual = path.join(references, 'workflow.md');
  fs.writeFileSync(manual, '# workflow\n');
  return { manual, pluginRoot, references };
}

test('直接读取阶段手册时返回共用 PermissionRequest 放行协议', () => {
  const { manual, pluginRoot } = fixture();
  const output = JSON.parse(
    handleReferenceAccess({ tool_name: 'Read', tool_input: { file_path: manual } }, { CLAUDE_PLUGIN_ROOT: pluginRoot }),
  );

  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
      },
    },
  });
});

test('只读 shell 命令读取阶段手册时使用同一放行协议', () => {
  const { manual, pluginRoot } = fixture();
  const output = handleReferenceAccess(
    { tool_name: 'Bash', tool_input: { command: `sed -n '1,240p' '${manual}'` } },
    { CLAUDE_PLUGIN_ROOT: pluginRoot },
  );

  assert.notEqual(output, '');
});

test('越界路径、混合路径与带控制符的 shell 命令保持静默', () => {
  const { manual, pluginRoot } = fixture();
  const outside = path.join(pluginRoot, 'outside.md');
  fs.writeFileSync(outside, 'outside\n');

  assert.equal(
    handleReferenceAccess(
      { tool_name: 'Read', tool_input: { file_path: outside } },
      { CLAUDE_PLUGIN_ROOT: pluginRoot },
    ),
    '',
  );
  assert.equal(
    handleReferenceAccess(
      { tool_name: 'Bash', tool_input: { command: `cat '${manual}' '${outside}'` } },
      { CLAUDE_PLUGIN_ROOT: pluginRoot },
    ),
    '',
  );
  assert.deepEqual(extractSafeCommandPaths(`cat '${manual}'; echo unsafe`), []);
});

test('真实路径检查拒绝 references 内指向外部的符号链接', () => {
  const { pluginRoot, references } = fixture();
  const outside = path.join(pluginRoot, 'outside.md');
  const link = path.join(references, 'outside-link.md');
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, link);

  assert.equal(isInsideAllowedRoot(link, fs.realpathSync(references)), false);
});

test('候选提取只读取直接路径字段或保守 shell 命令', () => {
  assert.deepEqual(extractCandidatePaths({ file_path: '/tmp/a.md' }), ['/tmp/a.md']);
  assert.deepEqual(extractCandidatePaths({ path: '/tmp/b.md' }), ['/tmp/b.md']);
  assert.deepEqual(extractCandidatePaths({ command: 'rm /tmp/a.md' }), []);
  assert.deepEqual(extractCandidatePaths({ unrelated: '/tmp/a.md' }), []);
});
