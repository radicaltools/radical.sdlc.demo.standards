#!/usr/bin/env node
// Part of the gate: a commit authored by an agent may change only that agent's
// scope (agents.mjs). The agents hold no credentials and the workflows
// commit for them, so the author says which agent wrote the commit.
//
//   node .standards/pipeline/tools/agent-scope.mjs <base ref>
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { agentOfAuthor, outOfScope } from './agents.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** One line per path outside its agent's scope; `commits` = [{ sha, author, paths }]. */
export function violations(commits) {
  return commits.flatMap(({ sha, author, paths }) => {
    const agent = agentOfAuthor(author)
    return agent ? outOfScope(agent, paths).map((p) => `${sha.slice(0, 8)} by ${agent} changes ${p}`) : []
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2]
  if (!base) { console.error('Which base?'); process.exit(2) }
  const commits = git('log', '--no-merges', '--format=%H%x09%an', `${base}..HEAD`).split('\n').filter(Boolean).map((line) => {
    const [sha, author] = line.split('\t')
    return { sha, author, paths: git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean) }
  })
  const found = violations(commits)
  for (const v of found) console.error(`::error::${v}`)
  console.log(found.length ? `${found.length} path(s) outside an agent's scope.` : `${commits.length} commit(s) read: every agent stayed in its scope.`)
  process.exit(found.length ? 1 : 0)
}
