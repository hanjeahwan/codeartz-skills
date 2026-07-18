import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

interface PluginManifest {
  hooks?: string;
}

interface HookCommand {
  type?: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

interface HookConfig {
  hooks: Record<string, HookGroup[]>;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

test('Codex 与 Claude plugin manifest 使用共用 hook 配置', () => {
  const codex = readJson<PluginManifest>('.codex-plugin/plugin.json');
  const claude = readJson<PluginManifest>('.claude-plugin/plugin.json');

  assert.equal(codex.hooks, './hooks/claude-codex-hooks.json');
  assert.equal(claude.hooks, './hooks/claude-codex-hooks.json');
});

test('共用 hook 配置包含 SessionStart、UserPromptSubmit 与 PermissionRequest', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');

  assert.deepEqual(Object.keys(config.hooks).sort(), ['PermissionRequest', 'SessionStart', 'UserPromptSubmit']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.PermissionRequest.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(config.hooks.UserPromptSubmit[0].matcher, undefined);
  assert.equal(config.hooks.PermissionRequest[0].matcher, 'Read|Bash');
});

test('manifest 在 Unix 与 Windows 运行 activation、mode 与 reference access 脚本', () => {
  const config = readJson<HookConfig>('hooks/claude-codex-hooks.json');
  const sessionHook = config.hooks.SessionStart[0].hooks[0];
  const promptHook = config.hooks.UserPromptSubmit[0].hooks[0];
  const accessHook = config.hooks.PermissionRequest[0].hooks[0];

  assert.equal(sessionHook.type, 'command');
  assert.match(sessionHook.command ?? '', /agent-evolve-activate\.js/);
  assert.doesNotMatch(sessionHook.command ?? '', /^exec\s/);
  assert.match(sessionHook.commandWindows ?? '', /agent-evolve-activate\.js/);
  assert.equal(sessionHook.timeout, 5);
  assert.equal(sessionHook.statusMessage, '正在加载 Agent Evolve 模式...');

  assert.equal(promptHook.type, 'command');
  assert.match(promptHook.command ?? '', /agent-evolve-mode\.js/);
  assert.doesNotMatch(promptHook.command ?? '', /^exec\s/);
  assert.match(promptHook.commandWindows ?? '', /agent-evolve-mode\.js/);
  assert.equal(promptHook.timeout, 5);
  assert.equal(promptHook.statusMessage, '正在更新 Agent Evolve 模式...');

  assert.equal(accessHook.type, 'command');
  assert.match(accessHook.command ?? '', /agent-evolve-reference-access\.js/);
  assert.match(accessHook.commandWindows ?? '', /agent-evolve-reference-access\.js/);
  assert.equal(accessHook.timeout, 5);
  assert.equal(accessHook.statusMessage, '正在检查 Agent Evolve 阶段手册访问权限...');
});

test('新 runtime 提供薄入口与五个带类型 JSDoc 的逻辑文件', () => {
  const files = [
    'hooks/agent-evolve-state.js',
    'hooks/agent-evolve-runtime.js',
    'hooks/agent-evolve-activate-runtime.js',
    'hooks/agent-evolve-mode-runtime.js',
    'hooks/agent-evolve-reference-access-runtime.js',
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^\/\/ @ts-check\n/);
    assert.match(source, /@typedef/);
    assert.match(source, /@param/);
    assert.match(source, /@returns/);
  }
});

test('三个可执行 hook 在顶层无条件调用 runtime main', () => {
  for (const filePath of [
    'hooks/agent-evolve-activate.js',
    'hooks/agent-evolve-mode.js',
    'hooks/agent-evolve-reference-access.js',
  ]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env node\n/, filePath);
    assert.match(source, /import \{ main \} from '.\/agent-evolve-.+-runtime\.js';/, filePath);
    assert.match(source, /main\(\)\.catch/, filePath);
    assert.doesNotMatch(source, /import\.meta|process\.argv|realpathSync/, filePath);
  }
});

test('Agent Evolve 按触发、工作流、安全验证三阶段延迟读取', () => {
  const skill = fs.readFileSync('skills/agent-evolve/SKILL.md', 'utf8');
  const workflow = fs.readFileSync('skills/agent-evolve/references/workflow.md', 'utf8');
  const activation = fs.readFileSync('hooks/agent-evolve-runtime.js', 'utf8');

  assert.match(activation, /当前任务本来仍须交付的条件、后果和作用域只算任务交付/);
  assert.match(activation, /目标文件不同不能证明独立/);
  assert.doesNotMatch(activation, /同一目标文件|普通任务不会更新规则源/);
  assert.doesNotMatch(activation, /# Agent Evolve 工作流|# Agent Evolve 安全验证/);
  assert.match(skill, /读取相对 `references\/workflow\.md`/);
  assert.match(skill, /禁止预读 `references\/validation\.md`/);
  assert.match(workflow, /进入安全验证阶段并读取相对 `validation\.md`/);
});

test('Agent Evolve 以交付独立性、统一候选关卡和模式权限处理多来源候选', () => {
  const skill = fs.readFileSync('skills/agent-evolve/SKILL.md', 'utf8');
  const workflow = fs.readFileSync('skills/agent-evolve/references/workflow.md', 'utf8');
  const validation = fs.readFileSync('skills/agent-evolve/references/validation.md', 'utf8');

  assert.match(skill, /任务证据/);
  assert.match(skill, /发送当前任务的最终回复前/);
  assert.match(skill, /当前任务交付/);
  assert.match(skill, /额外的未来 A→B 规则/);
  assert.match(skill, /不要求先发生故障/);
  assert.match(skill, /空泛目标缺少用户或任务证据直接支持/);
  assert.match(skill, /当前项目/);
  assert.match(skill, /硬路由/);
  assert.match(skill, /禁止从本页直接返回正式结果/);
  assert.match(workflow, /交付独立性/);
  assert.match(workflow, /关闭 Agent Evolve/);
  assert.match(workflow, /按适用条件、决策后果和作用域逐项比较/);
  assert.match(workflow, /目标文件、写入路径或是否修改规则源不能证明独立/);
  assert.doesNotMatch(workflow, /同一目标文件|普通任务不会更新项目规则源/);
  assert.match(workflow, /独立指当前交付之外的语义增量/);
  assert.match(workflow, /不要求候选与当前修复使用不同原理/);
  assert.match(workflow, /证据派生候选/);
  assert.match(workflow, /来源只影响证据判断和回执/);
  assert.match(workflow, /不改变 `safe` 模式的写入权限/);
  assert.match(workflow, /决策差异/);
  assert.match(workflow, /可判定/);
  assert.match(workflow, /可执行/);
  assert.match(workflow, /可迁移/);
  assert.match(workflow, /全部包含在当前任务本来仍须交付的语义/);
  assert.match(workflow, /作用域可收敛/);
  assert.match(workflow, /用户反馈候选/);
  assert.match(workflow, /证据派生候选/);
  assert.match(workflow, /没有失败发生不影响候选判断/);
  assert.match(workflow, /项目合同与现有约束/);
  assert.match(workflow, /直接排除或优先一个可行选择/);
  assert.match(workflow, /发现一条候选不能结束本轮检查/);
  assert.match(workflow, /当前 runner、sandbox/);
  assert.match(workflow, /禁止把宿主限制直接写成当前项目规范/);
  assert.match(workflow, /决策记录/);
  assert.match(workflow, /必须避免的失败后果/);
  assert.match(workflow, /失效条件/);
  assert.match(workflow, /语义闭合/);
  assert.match(workflow, /对每条依据做反事实检查/);
  assert.match(workflow, /无损投影/);
  assert.match(workflow, /投影后未来允许与禁止的动作集合必须与记录一致/);
  assert.doesNotMatch(workflow, /Decision Record|future_difference|invalidators/);
  assert.match(workflow, /Agent 观察：必须同时引用独立、可核对的项目证据/);
  assert.match(workflow, /`safe`/);
  assert.match(workflow, /`review`/);
  assert.match(workflow, /`off`/);
  assert.match(workflow, /不得通过修改实现或测试让任一方向成为既成事实/);
  assert.match(validation, /`候选来源`/);
  assert.match(validation, /项目规则/);
  assert.match(validation, /Agent Evolve｜/);
  assert.match(validation, /已沉淀/);
  assert.match(validation, /每条候选只输出一行/);
  assert.match(validation, /默认回执字段是封闭 schema/);
  assert.match(validation, /最窄稳定锚点/);
  assert.match(validation, /存在未解决冲突，或反馈处理失败时/);
  assert.match(validation, /不在回执前后复述同一结论/);
  assert.doesNotMatch(workflow, /候选必须直接来自用户/);
  assert.doesNotMatch(workflow, /证据派生候选在用户确认其精确语义前/);
  assert.doesNotMatch(workflow, /高风险变更/);
});
