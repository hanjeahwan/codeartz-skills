#!/usr/bin/env node
// @ts-check

import { main } from './agent-evolve-mode-runtime.js';

main().catch(() => {
  process.exitCode = 0;
});
