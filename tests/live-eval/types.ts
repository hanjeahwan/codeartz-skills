export type AgentName = 'claude' | 'codex';

export type ScenarioTier = 'full' | 'smoke';

export type ScenarioCheck =
  | { type: 'markdownHeadingsEqual'; path: string; level: number; headings: string[] }
  | { type: 'markdownFencesBalanced'; path: string }
  | { type: 'fileExists'; path: string }
  | { type: 'fileNotExists'; path: string }
  | { type: 'fileUnchanged'; path: string }
  | { type: 'workspaceUnchanged' }
  | { type: 'questionCountAtMost'; max: number }
  | { type: 'trajectoryIncludes'; value: string }
  | { type: 'trajectoryExcludes'; value: string };

export interface ScenarioGitState {
  // ponytail: content-only states cover current scenarios; add deletion entries when a scenario needs them.
  committed?: Record<string, string>;
  staged?: Record<string, string>;
  unstaged?: Record<string, string>;
  untracked?: Record<string, string>;
}

export interface ScenarioTurn {
  prompt: string;
  checks?: ScenarioCheck[];
}

export interface Scenario {
  id: string;
  skill: string;
  plugin?: boolean;
  tier: ScenarioTier;
  description: string;
  files?: Record<string, string>;
  git?: ScenarioGitState;
  judgeFiles?: string[];
  turns: ScenarioTurn[];
  criteria: string[];
  postChecks?: ScenarioCheck[];
}

export interface AgentTurnResult {
  response: string;
  rawEvents: unknown[];
  stderr: string;
  durationMs: number;
  usage?: unknown;
  costUsd?: number;
}

export interface AgentSession {
  runTurn(prompt: string): Promise<AgentTurnResult>;
  close(): Promise<void>;
}

export interface CheckResult {
  check: ScenarioCheck;
  passed: boolean;
  evidence: string;
}

export interface JudgeCriterionResult {
  criterion: string;
  passed: boolean;
  evidence: string;
}

export interface JudgeResult {
  verdict: 'fail' | 'pass';
  summary: string;
  criteria: JudgeCriterionResult[];
}

export interface LiveEvalVerdict {
  agent: AgentName;
  effort: string;
  model: string;
  scenarioId: string;
  skill: string;
  verdict: 'fail' | 'indeterminate' | 'pass';
  checks: CheckResult[];
  judge?: JudgeResult;
  error?: string;
  indeterminatePhase?: 'judge' | 'target';
  durationMs: number;
}
