#!/usr/bin/env node
// Moves an agent's work along, with no AI, up to the point where a person decides.
// Run after the gate and after the testing agent, on the branch they ran on.
//
//   node .standards/pipeline/tools/prepare-for-review.mjs <branch>
//
// A green proposal (agent-tests/*) goes into its branch. An agent/* pull request
// starts as a draft, and is marked ready for review once its gate is green, the
// testing agent is done and no proposal is open. Nothing here merges into main:
// that is a person's decision.
//
// When the coding agent reports model questions, nothing moves: the question is a
// person's. Comments go as github-actions[bot] (COMMENT_TOKEN), because GitHub does
// not notify people of what their own token does.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { hasModelQuestions } from './questions.mjs'

const concluded = (check) => check?.status === 'COMPLETED'

/** What to do with `pr`, the open pull request of `branch`; `proposals` are the
 *  open pull requests into that branch. Always { action, reason }. */
export function decide(branch, pr, proposals) {
  const wait = (reason) => ({ action: 'wait', reason })
  // A job of a reusable workflow shows as "<calling job> / <its name>".
  const latest = (name) => pr.statusCheckRollup.filter((c) => c.name === name || c.name?.endsWith(` / ${name}`)).at(-1)
  const agentBranch = branch.startsWith('agent/') || branch.startsWith('agent-tests/')
  if (agentBranch && [pr.body, ...(pr.comments ?? []).map((c) => c.body)].some(hasModelQuestions)) {
    return (pr.labels ?? []).some((l) => l.name === 'agent:question')
      ? wait('it has model questions, and a person knows')
      : { action: 'question', reason: 'the coding agent has model questions' }
  }
  const gate = latest('Gate')
  if (!concluded(gate) || gate.conclusion !== 'SUCCESS') return wait('the gate is not green')
  if (branch.startsWith('agent-tests/')) {
    return pr.baseRefName === 'main' ? wait('a proposal never goes into main') : { action: 'merge-proposal', reason: 'the gate on the proposal is green' }
  }
  if (!branch.startsWith('agent/')) return wait('it is not an agent branch')
  if (!pr.isDraft) return wait('it is with a person already')
  if (proposals.length) return wait(`proposal #${proposals[0].number} is open`)
  const testing = latest('Propose tests')
  if (!testing && latest('Skip a merged proposal')) return wait('the testing agent is about to start')
  if (testing && !concluded(testing)) return wait('the testing agent is running')
  if (testing && !['SUCCESS', 'SKIPPED'].includes(testing.conclusion)) return wait(`the testing agent ended with ${testing.conclusion}`)
  return { action: 'ready', reason: 'the gate is green and the testing agent is done' }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const branch = process.argv[2]
  const gh = (...args) => execFileSync('gh', [...args, '--repo', process.env.GITHUB_REPOSITORY], { encoding: 'utf8' })
  const list = (...filter) => JSON.parse(gh('pr', 'list', '--state', 'open', ...filter, '--json', 'number,baseRefName,isDraft,statusCheckRollup,body,comments,labels'))
  const [pr] = list('--head', branch)
  if (!pr) {
    console.log(`${branch} has no open pull request.`)
    process.exit(0)
  }
  const { action, reason } = decide(branch, pr, list('--base', branch))
  console.log(`#${pr.number} ${branch}: ${action}, because ${reason}.`)
  if (action === 'merge-proposal') gh('pr', 'merge', String(pr.number), '--merge', '--delete-branch', '--subject', `Merge proposal ${branch}`)
  const say = (body) => execFileSync('gh', ['pr', 'comment', String(pr.number), '--body', body, '--repo', process.env.GITHUB_REPOSITORY], { env: { ...process.env, GH_TOKEN: process.env.COMMENT_TOKEN } })
  if (action === 'ready') {
    gh('pr', 'ready', String(pr.number))
    say('Ready for review: the gate is green and the testing agent is done. Merging is yours.')
  }
  if (action === 'question') {
    gh('pr', 'edit', String(pr.number), '--add-label', 'agent:question')
    say('The coding agent has model questions, in the text above. It stays as it is until a person decides.')
  }
}
