#!/usr/bin/env node
// The loop that brings the code to the model. In a repository with .radical/reconciled.json
// the model on main is the state wanted, and that file names the model commit the code has
// reached. The gap is `radical diff` between the two: it is read again on every run, so a lost
// event loses nothing. No AI runs here.
//
//   node .standards/pipeline/tools/reconcile.mjs next                    what to do now, on GITHUB_OUTPUT
//   node .standards/pipeline/tools/reconcile.mjs outcome <report> <step> what became of the agent's run
//   node .standards/pipeline/tools/reconcile.mjs mark <commit>           the code has reached this commit
//   node .standards/pipeline/tools/reconcile.mjs stuck <commit> <report> a person reads why it did not
//   node .standards/pipeline/tools/reconcile.mjs converged               fails while there is a gap
//
// Each version of the model gets one try: one pull request, or one ticket for a person. A new
// commit of the model gives it another.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { hasModelQuestions, section } from './questions.mjs'

const MODEL = '.radical/model'
export const RECONCILED = '.radical/reconciled.json'
const PREFIX = 'agent/reconcile-'
const MAX_BODY = 60000

export const branchOf = (commit) => `${PREFIX}${commit.slice(0, 12)}`
export const markerOf = (commit) => `<!-- reconcile ${commit} -->`

/** How many elements and relations the report of `radical diff --format json` lists. */
export function gapOf({ elements, relations }) {
  return [elements, relations].reduce((sum, g) => sum + g.added.length + g.changed.length + g.removed.length, 0)
}

/** What to do now. `pulls` are the pull requests of this loop, `tickets` those it opened for a person. */
export function nextStep({ gap, desired, pulls, tickets }) {
  if (gap === 0) return { step: 'converged', reason: 'the code has reached the model' }
  const open = pulls.find((p) => p.state === 'OPEN')
  if (open) return { step: 'in-progress', reason: `#${open.number} is open` }
  const tried = pulls.find((p) => p.headRefName === branchOf(desired))
  if (tried) return { step: 'stuck', reason: `#${tried.number} tried this version of the model` }
  const asked = tickets.find((t) => t.body?.includes(markerOf(desired)))
  if (asked) return { step: 'stuck', reason: `#${asked.number} asks a person about this version of the model` }
  return { step: 'work', reason: `${gap} change(s) of the model are not in the code` }
}

/** What became of the agent's run: a pull request, or a person reads why not. Handing work on and
 *  a question both stop it, and a run that failed proposes nothing. */
export function outcomeOf({ report, changed, failed }) {
  if (failed || hasModelQuestions(report)) return 'ask'
  return changed || section(report, 'No code needed') ? 'pull' : 'ask'
}

function readReconciled() {
  if (!existsSync(RECONCILED)) return null
  const { model } = JSON.parse(readFileSync(RECONCILED, 'utf8'))
  if (!/^[0-9a-f]{40}$/.test(model ?? '')) throw new Error(`${RECONCILED} names no commit: ${model}`)
  return model
}

const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim()
const gapSince = (commit) => gapOf(JSON.parse(run('npx', 'radical', 'diff', MODEL, '--since', commit, '--format', 'json')))

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, first, second] = process.argv.slice(2)
  const repo = process.env.GITHUB_REPOSITORY
  const say = (lines) => appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', lines.map((l) => `${l}\n`).join(''))
  const reconciled = ['next', 'converged'].includes(command) ? readReconciled() : null
  if (command === 'next') {
    if (!reconciled) {
      console.log(`No ${RECONCILED}: this repository does not reconcile.`)
      say(['step=unmanaged'])
    } else {
      const desired = run('git', 'log', '-1', '--format=%H', '--', MODEL)
      const pulls = JSON.parse(run('gh', 'pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,state,headRefName')).filter((p) => p.headRefName.startsWith(PREFIX))
      const tickets = JSON.parse(run('gh', 'issue', 'list', '--repo', repo, '--state', 'all', '--label', 'agent:stuck', '--limit', '200', '--json', 'number,body'))
      const { step, reason } = nextStep({ gap: gapSince(reconciled), desired, pulls, tickets })
      console.log(`${step}: ${reason}.`)
      say([`step=${step}`, `base=${reconciled}`, `desired=${desired}`, `branch=${branchOf(desired)}`])
    }
  } else if (command === 'outcome') {
    const report = existsSync(first) ? readFileSync(first, 'utf8') : ''
    const act = outcomeOf({ report, changed: run('git', 'status', '--porcelain') !== '', failed: second !== 'success' })
    console.log(`The agent's run ends in: ${act}.`)
    say([`act=${act}`])
  } else if (command === 'mark') {
    writeFileSync(RECONCILED, `${JSON.stringify({ model: first }, null, 2)}\n`)
  } else if (command === 'stuck') {
    const report = existsSync(second) ? readFileSync(second, 'utf8') : 'The agent left no report.'
    const body = `${markerOf(first)}\nThe code cannot reach the model at ${first.slice(0, 7)}, and nothing was committed. The agent said:\n\n${report.slice(0, MAX_BODY)}\n\nA new version of the model starts it again.`
    console.log(run('gh', 'issue', 'create', '--repo', repo, '--title', `The code cannot reach the model at ${first.slice(0, 7)}`, '--label', 'agent:stuck', '--body', body))
  } else if (command === 'converged') {
    const gap = reconciled ? gapSince(reconciled) : 0
    if (gap) {
      console.error(`::error::${gap} change(s) of the model are not in the code, so this commit is no version yet.`)
      process.exit(1)
    }
    console.log('The code has reached the model.')
  } else {
    console.error('next, outcome, mark, stuck or converged?')
    process.exit(2)
  }
}
