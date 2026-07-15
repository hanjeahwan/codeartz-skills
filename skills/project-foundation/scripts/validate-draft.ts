#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_HEADINGS = ['检查范围', '建议变更', '待裁决', '最终内容', '验证计划'] as const;
const ALLOWED_ACTIONS = new Set(['创建', '修改', '删除']);

export interface DraftCheck {
  id: string;
  status: 'fail' | 'pass';
  evidence: string;
}

export interface DraftValidationResult {
  status: 'fail' | 'pass';
  draftSha256: string;
  checks: DraftCheck[];
}

function parseSections(markdown: string): { headings: string[]; content: Map<string, string> } {
  const content = new Map<string, string>();
  const headings: string[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];
  let activeFence: string | undefined;

  const saveCurrent = (): void => {
    if (currentHeading !== undefined) {
      content.set(currentHeading, currentLines.join('\n').trim());
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (activeFence === undefined) {
        activeFence = marker;
      } else if (activeFence === marker) {
        activeFence = undefined;
      }
      currentLines.push(line);
      continue;
    }
    const heading = activeFence === undefined ? /^## ([^#].*)$/.exec(line) : null;
    if (heading) {
      saveCurrent();
      currentHeading = heading[1].trim();
      headings.push(currentHeading);
      currentLines = [];
      continue;
    }
    if (currentHeading !== undefined) {
      currentLines.push(line);
    }
  }
  saveCurrent();
  return { headings, content };
}

function fenceAnalysis(markdown: string): { balanced: boolean; count: number } {
  let active: string | undefined;
  let count = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) {
      continue;
    }
    const marker = match[1][0];
    count += 1;
    if (active === undefined) {
      active = marker;
    } else if (active === marker) {
      active = undefined;
    }
  }
  return { balanced: active === undefined, count };
}

function pendingDecisions(content: string): boolean {
  const normalized = content
    .replace(/^<!--.*?-->$/gms, '')
    .replace(/^[-*]\s*/gm, '')
    .trim();
  return !/^(?:不适用|无|没有|无待裁决项)[。.]?$/.test(normalized);
}

function extractBaseline(content: string): unknown | undefined {
  for (const match of content.matchAll(/```json\s*([\s\S]*?)```/g)) {
    try {
      const value = JSON.parse(match[1]);
      if (typeof value === 'object' && value !== null && 'version' in value) {
        return value;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function validBaseline(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') === 'knowledgeFiles,sourceCommit,version' &&
    record.version === 1 &&
    (record.sourceCommit === null ||
      (typeof record.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(record.sourceCommit))) &&
    Array.isArray(record.knowledgeFiles) &&
    record.knowledgeFiles.length > 0 &&
    record.knowledgeFiles.every((item) => {
      return typeof item === 'string' && item.trim() !== '';
    }) &&
    new Set(record.knowledgeFiles).size === record.knowledgeFiles.length
  );
}

function repositoryRelativePath(value: string): boolean {
  const normalized = value.trim().replaceAll('\\', '/');
  return (
    normalized !== '' &&
    !path.posix.isAbsolute(normalized) &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}

function thirdLevelBlocks(content: string): string[] {
  const matches = [...content.matchAll(/^### [^\n]+$/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    return content.slice(start, end);
  });
}

export function validateDraft(markdown: string): DraftValidationResult {
  const checks: DraftCheck[] = [];
  const add = (id: string, passed: boolean, evidence: string): void => {
    checks.push({ id, status: passed ? 'pass' : 'fail', evidence });
  };
  const parsed = parseSections(markdown);
  const { content, headings } = parsed;
  add(
    'fixed-headings',
    JSON.stringify(headings) === JSON.stringify(REQUIRED_HEADINGS),
    `实际一级区块：${headings.join(' / ') || '无'}`,
  );

  const fences = fenceAnalysis(markdown);
  add('balanced-fences', fences.balanced, `Markdown 围栏标记：${fences.count}`);

  const suggestions = content.get('建议变更') ?? '';
  const suggestionBlocks = thirdLevelBlocks(suggestions);
  const noSuggestions = /^(?:不适用|无|没有|本轮无合格证据[^\n]*)[。.]?$/.test(suggestions.trim());
  const requiredFields = ['目标', '动作', '精确内容', '依据', '不确定性'];
  const incompleteSuggestions = suggestionBlocks.flatMap((block, index) => {
    const missing = requiredFields.filter((field) => {
      return !new RegExp(`${field}(?:\\*\\*)?\\s*[：:]`).test(block);
    });
    return missing.length === 0 ? [] : [`建议 ${index + 1} 缺少 ${missing.join('、')}`];
  });
  let suggestionEvidence = '建议变更未使用建议区块';
  if (incompleteSuggestions.length > 0) {
    suggestionEvidence = incompleteSuggestions.join('；');
  } else if (suggestionBlocks.length > 0) {
    suggestionEvidence = `建议区块：${suggestionBlocks.length}`;
  } else if (noSuggestions) {
    suggestionEvidence = '明确没有建议变更';
  }
  add(
    'suggestion-fields',
    (suggestionBlocks.length > 0 || noSuggestions) && incompleteSuggestions.length === 0,
    suggestionEvidence,
  );

  const actions = [...suggestions.matchAll(/动作(?:\*\*)?\s*[：:]\s*\**([^\n*]+?)\**\s*$/gm)].map((match) => {
    return match[1].trim().replace(/[。.]+$/, '');
  });
  const invalidActions = actions.filter((action) => {
    return !ALLOWED_ACTIONS.has(action);
  });
  add(
    'allowed-actions',
    invalidActions.length === 0,
    invalidActions.length === 0
      ? `建议动作：${actions.join('、') || '无'}`
      : `不支持的动作：${invalidActions.join('、')}`,
  );

  const decisions = content.get('待裁决') ?? '';
  const finalContent = content.get('最终内容') ?? '';
  const hasPending = pendingDecisions(decisions);
  add('no-pending-decisions', !hasPending, hasPending ? '仍有未解决的待裁决项' : '待裁决项已全部解决');
  const hasApplicableContent = /```|"version"\s*:\s*1|^###\s+/m.test(finalContent);
  add(
    'pending-decision-final-content',
    !hasPending || !hasApplicableContent,
    hasPending ? `存在待裁决；最终内容${hasApplicableContent ? '包含' : '未包含'}可应用正文或 baseline` : '没有待裁决',
  );

  const placeholders = /等待裁决|待生成|TODO|选项\s*[A-Z]|仅组\s*\d|全部应用|暂缓组/.test(finalContent);
  let uniqueEvidence = '最终内容唯一';
  if (hasPending) {
    uniqueEvidence = '存在待裁决，本项不适用';
  } else if (placeholders) {
    uniqueEvidence = '最终内容仍包含占位或分支';
  }
  add('unique-final-content', hasPending || !placeholders, uniqueEvidence);

  const baseline = extractBaseline(finalContent);
  let baselineEvidence = '缺少有效 baseline JSON';
  if (hasPending) {
    baselineEvidence = '存在待裁决，本项不适用';
  } else if (validBaseline(baseline)) {
    baselineEvidence = 'baseline JSON 合同有效';
  }
  add('baseline-contract', hasPending || validBaseline(baseline), baselineEvidence);

  const finalTargets = [...finalContent.matchAll(/^###\s+([^\n]+)$/gm)].map((match) => {
    return match[1].trim();
  });
  const baselineTargets =
    typeof baseline === 'object' && baseline !== null && !Array.isArray(baseline)
      ? (baseline as Record<string, unknown>).knowledgeFiles
      : undefined;
  const paths = [
    ...finalTargets,
    ...(Array.isArray(baselineTargets)
      ? baselineTargets.filter((value): value is string => {
          return typeof value === 'string';
        })
      : []),
  ];
  const unsafePaths = paths.filter((value) => {
    return !repositoryRelativePath(value);
  });
  let pathEvidence = `正式目标均为仓库内相对路径：${[...new Set(paths)].join('、') || '无'}`;
  if (hasPending) {
    pathEvidence = '存在待裁决，本项不适用';
  } else if (unsafePaths.length > 0) {
    pathEvidence = `越界或绝对路径：${[...new Set(unsafePaths)].join('、')}`;
  }
  add('repository-relative-paths', hasPending || unsafePaths.length === 0, pathEvidence);

  return {
    status: checks.every((check) => {
      return check.status === 'pass';
    })
      ? 'pass'
      : 'fail',
    draftSha256: createHash('sha256').update(markdown).digest('hex'),
    checks,
  };
}

export async function validateDraftFile(filePath: string): Promise<DraftValidationResult> {
  return validateDraft(await readFile(filePath, 'utf8'));
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write('用法：validate-draft.ts <draft-path>\n');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await validateDraftFile(path.resolve(filePath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
