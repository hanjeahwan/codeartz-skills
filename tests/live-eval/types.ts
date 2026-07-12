export type AgentName = 'claude' | 'codex';

export type ScenarioTier = 'full' | 'smoke';

export type ScenarioCheck =
  | { type: 'fileContains'; path: string; value: string }
  | { type: 'fileExcludes'; path: string; value: string }
  | { type: 'fileMatches'; path: string; pattern: string; flags?: string }
  | { type: 'markdownHeadingsEqual'; path: string; level: number; headings: string[] }
  | { type: 'markdownFencesBalanced'; path: string }
  | { type: 'fileExists'; path: string }
  | { type: 'fileNotExists'; path: string }
  | { type: 'fileUnchanged'; path: string }
  | { type: 'questionCountAtMost'; max: number }
  | { type: 'responseExcludes'; value: string }
  | { type: 'responseIncludes'; value: string }
  | { type: 'responseMatches'; pattern: string; flags?: string }
  | { type: 'trajectoryIncludes'; value: string };

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
  durationMs: number;
}
