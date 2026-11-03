#!/usr/bin/env node
// The version the repository pins of each model it depends on, as lines for a docker
// compose or $GITHUB_ENV: WAREHOUSE_VERSION=v1.0.0.
import { readFileSync } from 'node:fs'

for (const { name, ref } of JSON.parse(readFileSync('.radical/model/deps.json', 'utf8')).dependencies) {
  console.log(`${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_VERSION=${ref}`)
}
