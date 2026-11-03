#!/usr/bin/env node
// Sensor fuzz, for the fitness function Rules hold in random sequences (ADR Rules hold
// under any sequence): the repository's fuzz files on their fixed seeds, by radical fuzz.
import { spawnSync } from 'node:child_process'

const run = spawnSync('npx', ['radical', 'fuzz'], { stdio: 'inherit' })
process.exit(run.status ?? 1)
