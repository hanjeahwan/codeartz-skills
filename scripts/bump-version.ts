#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { inc, lte, valid, type ReleaseType } from 'semver';

interface Manifest {
  version: string;
}

interface ParsedArgs {
  dryRun: boolean;
  preid?: string;
  target?: string;
}

interface TextUpdate {
  filePath: string;
  nextText: string;
}

const manifestPaths = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'];
const supportedIncrements = new Set<ReleaseType>([
  'major',
  'minor',
  'patch',
  'premajor',
  'preminor',
  'prepatch',
  'prerelease',
]);

const { dryRun, preid, target } = parseArgs(process.argv.slice(2));

if (!target) {
  fail('Usage: npm run bump -- <major|minor|patch|version> [--dry-run] [--preid beta]');
}

const manifests = manifestPaths.map((filePath) => {
  const text = readFileSync(filePath, 'utf8');
  const json = JSON.parse(text) as Manifest;

  if (!valid(json.version)) {
    fail(`${filePath} has invalid semver version: ${json.version}`);
  }

  return { filePath, json, text };
});

const currentVersions = new Set(
  manifests.map(({ json }) => {
    return json.version;
  }),
);

if (currentVersions.size !== 1) {
  fail(
    `Manifest versions differ: ${manifests
      .map(({ filePath, json }) => {
        return `${filePath}=${json.version}`;
      })
      .join(', ')}`,
  );
}

const currentVersion = manifests[0].json.version;
const nextVersion = resolveNextVersion(currentVersion, target, preid);

if (lte(nextVersion, currentVersion)) {
  fail(`Next version must be greater than ${currentVersion}; got ${nextVersion}.`);
}

const updates: TextUpdate[] = manifests.map(({ filePath, text }) => {
  return {
    filePath,
    nextText: replaceOrFail(
      text,
      new RegExp(`("version"\\s*:\\s*")${escapeRegExp(currentVersion)}(")`),
      `$1${nextVersion}$2`,
      `${filePath} version field`,
    ),
  };
});

for (const { filePath, nextText } of updates) {
  if (!dryRun) {
    writeFileSync(filePath, nextText);
  }
}

const mode = dryRun ? 'Would bump' : 'Bumped';
console.log(`${mode} ${currentVersion} -> ${nextVersion}`);
for (const { filePath } of updates) {
  console.log(`- ${filePath}`);
}

function resolveNextVersion(currentVersion: string, target: string, preid?: string): string {
  const exactVersion = valid(target);

  if (exactVersion) {
    return exactVersion;
  }

  if (isReleaseType(target)) {
    const nextVersion = preid ? inc(currentVersion, target, preid) : inc(currentVersion, target);

    if (!nextVersion) {
      fail(`Could not bump ${currentVersion} with ${target}.`);
    }

    return nextVersion;
  }

  fail(`Unsupported bump target: ${target}`);
}

function isReleaseType(target: string): target is ReleaseType {
  return supportedIncrements.has(target as ReleaseType);
}

function parseArgs(args: string[]): ParsedArgs {
  let dryRun = false;
  let preid: string | undefined;
  let target: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--preid') {
      preid = args[index + 1];

      if (!preid) {
        fail('Missing value after --preid.');
      }

      index += 1;
      continue;
    }

    if (target) {
      fail(`Unexpected argument: ${arg}`);
    }

    target = arg;
  }

  return { dryRun, preid, target };
}

function replaceOrFail(text: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(text)) {
    fail(`Could not find ${label}.`);
  }

  return text.replace(pattern, replacement);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
