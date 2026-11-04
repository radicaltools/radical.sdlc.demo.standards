#!/usr/bin/env node
// The agents ask instead of guessing, with no token of their own. The model agent
// ends its report with a section "## Questions". The coding agent, when the model is
// not enough to build anything, with "## Model questions". The workflow puts them on
// the issue as github-actions[bot], which is what makes GitHub notify a person, and
// which starts no workflow. The comment of a person with write access starts them again.
//
//   node tools/questions.mjs brief <issue> <file>    writes the brief, prints the rounds asked
//   node tools/questions.mjs has <heading> <report>  exit status 0 when the report asks
//   node tools/questions.mjs ask <issue> <report> <rounds>
//
//   node tools/questions.mjs trusted <login>         exit status 0 when they may write
//
// A brief holds the ticket and only what people with write access said on it: in a
// public repository anyone can comment. Access is read from the API, not from
// author_association, which depends on the token and on whether a membership of the
// organisation is public. When the API cannot say, the answer is no.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MARKER = '<!-- model-agent-questions -->'
export const MAX_ROUNDS = 2
export const mayWrite = (permission) => permission === 'admin' || permission === 'write'

const fromWorkflow = (comment) => comment.user?.login === 'github-actions[bot]'
const isQuestion = (comment) => fromWorkflow(comment) && comment.body?.startsWith(MARKER)
/** What the workflow says on a ticket about work it handed to another repository (delegate.mjs). */
export const isNote = (comment) => fromWorkflow(comment) && comment.body?.startsWith('<!-- delegation')
export const roundsOf = (comments) => comments.filter(isQuestion).length

/** The ticket, and the conversation on it that can be trusted: `trusted` says it
 *  of a login. */
export function briefOf(title, body, comments, trusted) {
  const said = comments.filter((c) => isQuestion(c) || isNote(c) || (c.user?.login && trusted(c.user.login)))
    .map((c) => {
      if (isQuestion(c)) return `The agents asked:\n\n${c.body.slice(MARKER.length).trim()}`
      if (isNote(c)) return `The pipeline said:\n\n${c.body.replace(/^<!--.*?-->\s*/, '').trim()}`
      return `${c.user?.login} answered:\n\n${c.body.trim()}`
    })
  return [`# ${title}`, '', body ?? '', ...(said.length ? ['', '## Conversation', '', said.join('\n\n')] : []), ''].join('\n')
}

/** What a report says under the heading `name`, '' when it has none or says none. */
export function section(report, name) {
  const lines = (report ?? '').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'i').test(l.trim()))
  if (start < 0) return ''
  const end = lines.slice(start + 1).findIndex((l) => /^#{1,6}\s/.test(l))
  const text = lines.slice(start + 1, end < 0 ? undefined : start + 1 + end).join('\n').trim()
  return /^\W*(none|no questions|n\/a)\b/i.test(text) ? '' : text
}

export const questionsOf = (report) => section(report, 'Questions') || section(report, 'Model questions')
/** What a person reads when the agents stop: their questions, or else all they reported,
 *  because a run that built nothing and asked nothing must not stop in silence. */
export const whyStopped = (report) => questionsOf(report) || (report ?? '').trim()

/** What a report hands to other repositories: one section "## Delegate to <name>" for each. */
export function delegationsIn(report) {
  const names = [...(report ?? '').matchAll(/^#{1,6}\s*Delegate to\s+([\w.-]+)\s*$/gim)].map((m) => m[1])
  return [...new Set(names)].map((name) => ({ name, text: section(report, `Delegate to ${name}`) })).filter((d) => d.text)
}

export const hasModelQuestions = (text) => section(text, 'Model questions') !== '' || delegationsIn(text).length > 0

/** The comment that asks; past the limit it hands the ticket to a person. */
export function askingComment(questions, rounds) {
  if (rounds >= MAX_ROUNDS) return `${MARKER}\nThe agents have asked ${rounds} times and still need an answer, so this ticket needs a person.\n\n${questions}`
  return `${MARKER}\nThe agents need an answer before they go on. Nothing has been committed.\n\n${questions}\n\nAnswer in a comment here, all at once: the first comment starts them again.`
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `issue` is the heading for `has` and the login for `trusted`.
  const [command, issue, ...rest] = process.argv.slice(2)
  const repo = process.env.GITHUB_REPOSITORY
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })
  const permissionOf = (login) => {
    try {
      return gh('api', `repos/${repo}/collaborators/${login}/permission`, '--jq', '.permission').trim()
    } catch {
      return 'none'
    }
  }
  const editLabels = (...args) => { try { gh('issue', 'edit', issue, '--repo', repo, ...args) } catch (error) { console.error(error.message) } }
  if (command === 'brief') {
    const comments = gh('api', '--paginate', `repos/${repo}/issues/${issue}/comments`, '--jq', '.[]').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const known = new Map()
    const trusted = (login) => {
      if (!known.has(login)) known.set(login, mayWrite(permissionOf(login)))
      return known.get(login)
    }
    writeFileSync(rest[0], briefOf(process.env.ISSUE_TITLE, process.env.ISSUE_BODY, comments, trusted))
    editLabels('--remove-label', 'agent:question')
    console.log(roundsOf(comments))
  } else if (command === 'ask') {
    gh('issue', 'comment', issue, '--repo', repo, '--body', askingComment(whyStopped(readFileSync(rest[0], 'utf8')), Number(rest[1])))
    editLabels('--add-label', 'agent:question', '--remove-label', 'agent:implement')
  } else if (command === 'trusted') {
    process.exit(mayWrite(permissionOf(issue)) ? 0 : 1)
  } else if (command === 'has') {
    let report = ''
    try { report = readFileSync(rest[0], 'utf8') } catch {}
    process.exit(section(report, issue) ? 0 : 1)
  } else {
    console.error('brief, has or ask?')
    process.exit(2)
  }
}
