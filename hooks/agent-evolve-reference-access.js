#!/usr/bin/env node

import { main } from './agent-evolve-reference-access-runtime.js';

main().catch(() => {
  process.exitCode = 0;
});
