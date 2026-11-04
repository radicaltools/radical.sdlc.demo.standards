#!/usr/bin/env node
// Work that belongs to another repository. An agent ends its report with a section
// "## Delegate to <name>", where <name> is a dependency in .radical/model/deps.json. The
// agents hold no credentials and name no repository: this script, with no AI, finds the
// repository in deps.json and opens the ticket there. The first ticket waits, with the label
// agent:waiting, until the other is closed by a change and a version with that change is
// pinned here. The other repository knows nothing of who asked: this one looks.
//
//   node delegate.mjs providers <dir>         what the dependencies have now, for the agents to read
//   node delegate.mjs has <report>            exit status 0 when the report delegates
//   node delegate.mjs open <issue> <report>   with GH_TOKEN (here), DELEGATE_TOKEN (there)
//   node delegate.mjs wake                    with GH_TOKEN (here), AGENT_TOKEN (starts the agents)
//
// A ticket opened here starts the agents there only because a ticket with a trusted author
// got this far, and only down to MAX_DEPTH. Whatever cannot be opened goes to a person.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MARKER, delegationsIn, isNote } from './questions.mjs'
import { slugOf } from './update-pins.mjs'

export const MAX_DEPTH = 2
export const MAX_TICKETS = 3
const DEPS = '.radical/model/deps.json'
const NAME = /^[\w.-]+$/
const CLOSER = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) {
  state stateReason timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) { nodes { ... on ClosedEvent { closer {
    ... on PullRequest { mergeCommit { oid } } ... on Commit { oid } } } } } } } }`

/** How many times work was handed on before the ticket with this text. */
export const depthOf = (body) => Number((body ?? '').match(/<!-- delegated-from \S+ depth=(\d+) -->/)?.[1] ?? 0)

const marksOf = (comments) => comments.filter(isNote)
  .map((c) => c.body.match(/^<!-- delegation(-done)? ([\w.-]+) (\d+) -->/)).filter(Boolean)

/** What a report hands on, in tickets to open and in reasons for a person. `comments` and
 *  `body` are those of the ticket the agents work on, `from` is that ticket (owner/name#12). */
export function planDelegations({ report, deps, comments, body, title, from }) {
  const depth = depthOf(body) + 1
  let left = MAX_TICKETS - marksOf(comments).filter((m) => !m[1]).length
  const open = []
  const refused = []
  for (const { name, text } of delegationsIn(report)) {
    const dep = deps.dependencies?.find((d) => d.name === name)
    const slug = dep && slugOf(dep.repo)
    if (!slug) refused.push(`**${name}** is no repository this one depends on on GitHub. The agents asked of it:\n\n${text}`)
    else if (left <= 0) refused.push(`This ticket has already handed on ${MAX_TICKETS} tickets. The agents asked of ${name}:\n\n${text}`)
    else {
      left -= 1
      open.push({
        name, slug, start: depth <= MAX_DEPTH, title: `${deps.name ?? 'Another repository'}: ${title}`,
        body: `<!-- delegated-from ${from} depth=${depth} -->\n${from} needs this from this repository, and waits until a version with it is pinned there.\n\n${text}\n`,
      })
    }
  }
  return { open, refused }
}

/** The tickets of other repositories this ticket still waits for. */
export function waitingOn(comments) {
  const marks = marksOf(comments)
  const done = new Set(marks.filter((m) => m[1]).map((m) => `${m[2]} ${m[3]}`))
  return marks.filter((m) => !m[1] && !done.has(`${m[2]} ${m[3]}`)).map((m) => ({ name: m[2], number: Number(m[3]) }))
}

/** One other ticket: `wait`, `done`, or `person` when it was closed with no change.
 *  `inPin` says whether the version pinned here has the commit that closed it. */
export function verdict({ state, stateReason, commit, inPin }) {
  if (state !== 'CLOSED') return 'wait'
  if (stateReason !== 'COMPLETED' || !commit) return 'person'
  return inPin ? 'done' : 'wait'
}

/** What to do with a waiting ticket, from the verdicts on the tickets it waits for. */
export function wakeAction(verdicts) {
  if (verdicts.includes('person')) return 'person'
  return verdicts.every((v) => v === 'done') ? 'go' : 'wait'
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2)
  const repo = process.env.GITHUB_REPOSITORY
  const deps = () => JSON.parse(readFileSync(DEPS, 'utf8'))
  const gh = (token, ...rest) => execFileSync('gh', rest, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const here = (...rest) => gh(process.env.GH_TOKEN, ...rest)
  const commentsOf = (issue) => here('api', '--paginate', `repos/${repo}/issues/${issue}/comments`, '--jq', '.[]').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const failure = (error) => (error.stderr?.toString() || error.message).trim().split('\n')[0]
  const ask = (issue, text) => {
    here('issue', 'comment', issue, '--repo', repo, '--body', `${MARKER}\n${text}\n\nAnswer in a comment here: the first comment starts the agents again.`)
    here('issue', 'edit', issue, '--repo', repo, '--add-label', 'agent:question', '--remove-label', 'agent:waiting')
  }
  if (command === 'providers') {
    for (const dep of deps().dependencies ?? []) {
      const slug = slugOf(dep.repo)
      if (!slug || !NAME.test(dep.name)) continue
      const dir = join(args[0], dep.name)
      try {
        execFileSync('git', ['clone', '--quiet', '--depth', '1', `https://github.com/${slug}.git`, dir], { stdio: 'inherit' })
        rmSync(join(dir, '.git'), { recursive: true, force: true })
      } catch (error) {
        console.error(`${dep.name}: ${error.message}`)
      }
    }
  } else if (command === 'has') {
    let report = ''
    try { report = readFileSync(args[0], 'utf8') } catch {}
    process.exit(delegationsIn(report).length ? 0 : 1)
  } else if (command === 'open') {
    const [issue, file] = args
    const { open, refused } = planDelegations({
      report: readFileSync(file, 'utf8'), deps: deps(), comments: commentsOf(issue),
      body: process.env.ISSUE_BODY, title: process.env.ISSUE_TITLE, from: `${repo}#${issue}`,
    })
    let opened = 0
    for (const ticket of open) {
      let url
      try {
        url = gh(process.env.DELEGATE_TOKEN, 'issue', 'create', '--repo', ticket.slug, '--title', ticket.title, '--body', ticket.body).trim()
      } catch (error) {
        refused.push(`The ticket in **${ticket.name}** could not be opened (${failure(error)}). It would have said:\n\n${ticket.body}`)
        continue
      }
      let started = ticket.start
      if (started) {
        try { gh(process.env.DELEGATE_TOKEN, 'issue', 'edit', url, '--add-label', 'agent:implement') } catch { started = false }
      }
      here('issue', 'comment', issue, '--repo', repo, '--body',
        `<!-- delegation ${ticket.name} ${url.match(/(\d+)$/)[1]} -->\nThis needs ${ticket.name}: ${url}\n\n${started ? 'Its agents have started.' : 'A person there has to start its agents.'} Nothing has been committed here. The agents go on when that ticket is closed by a change and a version with it is pinned here.`)
      opened += 1
    }
    here('issue', 'edit', issue, '--repo', repo, '--remove-label', 'agent:implement', ...(opened ? ['--add-label', 'agent:waiting'] : []))
    if (refused.length) ask(issue, `The agents could not hand everything on, so this needs a person.\n\n${refused.join('\n\n')}`)
  } else if (command === 'wake') {
    const dependencies = deps().dependencies ?? []
    const readThere = process.env.DELEGATE_TOKEN || process.env.GH_TOKEN
    const look = ({ name, number }) => {
      const dep = dependencies.find((d) => d.name === name)
      const slug = dep && slugOf(dep.repo)
      if (!slug) return { name, number, verdict: 'person', label: `${name}#${number}` }
      const [owner, repoName] = slug.split('/')
      const issue = JSON.parse(gh(readThere, 'api', 'graphql', '-f', `query=${CLOSER}`, '-F', `owner=${owner}`, '-F', `name=${repoName}`, '-F', `number=${number}`, '--jq', '.data.repository.issue'))
      const closer = issue.timelineItems.nodes.at(-1)?.closer
      const commit = closer?.mergeCommit?.oid ?? closer?.oid
      const status = commit ? gh(readThere, 'api', `repos/${slug}/compare/${dep.ref}...${commit}`, '--jq', '.status').trim() : ''
      return { name, number, pin: dep.ref, label: `${slug}#${number}`, verdict: verdict({ state: issue.state, stateReason: issue.stateReason, commit, inPin: status === 'behind' || status === 'identical' }) }
    }
    const tickets = JSON.parse(here('issue', 'list', '--repo', repo, '--label', 'agent:waiting', '--state', 'open', '--json', 'number', '--limit', '100'))
    for (const { number } of tickets) {
      const issue = String(number)
      const looked = waitingOn(commentsOf(issue)).map(look)
      const action = wakeAction(looked.map((l) => l.verdict))
      console.log(`#${issue}: ${action}`)
      if (action === 'wait') continue
      for (const l of looked) {
        const said = l.verdict === 'done' ? `${l.label} is closed, and ${l.pin}, the version pinned here, has it.` : `${l.label} is not waited for any more.`
        here('issue', 'comment', issue, '--repo', repo, '--body', `<!-- delegation-done ${l.name} ${l.number} -->\n${said}`)
      }
      if (action === 'person') {
        ask(issue, `${looked.filter((l) => l.verdict === 'person').map((l) => l.label).join(', ')} was closed with no change, so what this ticket waited for will not come by itself.`)
      } else {
        here('issue', 'edit', issue, '--repo', repo, '--remove-label', 'agent:waiting')
        // GitHub starts no workflow for what its own token does, so this takes the agents' token.
        gh(process.env.AGENT_TOKEN, 'issue', 'edit', issue, '--repo', repo, '--add-label', 'agent:implement')
      }
    }
  } else {
    console.error('providers, has, open or wake?')
    process.exit(2)
  }
}
