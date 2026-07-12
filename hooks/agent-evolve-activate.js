#!/usr/bin/env node
// @ts-check

import { main } from './agent-evolve-activate-runtime.js';

main().catch(() => {
  process.exitCode = 0;
});
