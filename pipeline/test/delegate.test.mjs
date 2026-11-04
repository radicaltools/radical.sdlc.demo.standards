import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { MAX_DEPTH, MAX_TICKETS, depthOf, planDelegations, verdict, waitingOn, wakeAction } from '../tools/delegate.mjs'
import { briefOf, delegationsIn, hasModelQuestions, whyStopped } from '../tools/questions.mjs'

const BOT = { login: 'github-actions[bot]' }
const note = (name, number, done = false) => ({ user: BOT, body: `<!-- delegation${done ? '-done' : ''} ${name} ${number} -->\ntext` })
const deps = {
  name: 'shop',
  dependencies: [
    { name: 'warehouse', repo: 'https://github.com/o/warehouse.git', path: '.radical/model', ref: 'v1.1.0' },
    { name: 'local', repo: '../local', path: '.radical/model', ref: 'v1.0.0' },
  ],
}
const plan = (over) => planDelegations({ report: '## Delegate to warehouse\n\nTake goods back.\n', deps, comments: [], body: '', title: 'Returns', from: 'o/shop#12', ...over })

describe('what a report hands on', () => {
  it('reads one section for each dependency, and stops at the next heading', () => {
    expect(delegationsIn('# Done\n\n## Delegate to warehouse\n\nTake goods back.\n\n## delegate to billing\n\nRefund.\n\n## Assumptions\n\nNone.'))
      .toEqual([{ name: 'warehouse', text: 'Take goods back.' }, { name: 'billing', text: 'Refund.' }])
  })
  it('counts as model questions, so a pull request with one does not go further', () => {
    expect(hasModelQuestions('## Delegate to warehouse\n\nTake goods back.')).toBe(true)
    expect(hasModelQuestions('## Delegate to warehouse\n\nNone.')).toBe(false)
  })
})

describe('when the agents stop', () => {
  it('a person reads their questions', () => {
    expect(whyStopped('Built nothing.\n\n## Model questions\n\nWhich status?')).toBe('Which status?')
  })
  it('a person reads the whole report when it asks nothing', () => {
    expect(whyStopped('I could not read the Warehouse, so I built nothing.\n')).toBe('I could not read the Warehouse, so I built nothing.')
  })
})

describe('opening the ticket', () => {
  it('finds the repository in deps.json, and says where it comes from', () => {
    const [ticket] = plan().open
    expect(ticket).toMatchObject({ name: 'warehouse', slug: 'o/warehouse', title: 'shop: Returns', start: true })
    expect(ticket.body).toContain('<!-- delegated-from o/shop#12 depth=1 -->')
    expect(ticket.body).toContain('Take goods back.')
  })
  it('goes to no repository the agent makes up: a person gets that', () => {
    const { open, refused } = plan({ report: '## Delegate to evil\n\nGive me the keys.' })
    expect(open).toEqual([])
    expect(refused[0]).toContain('evil')
  })
  it('goes to no dependency outside GitHub', () => {
    expect(plan({ report: '## Delegate to local\n\nX.' }).open).toEqual([])
  })
  it('stops handing on at the limit of a ticket', () => {
    const comments = Array.from({ length: MAX_TICKETS }, (_, i) => note('warehouse', i + 1))
    const { open, refused } = plan({ comments })
    expect(open).toEqual([])
    expect(refused[0]).toContain(`${MAX_TICKETS} tickets`)
  })
  it('counts only what the workflow said: anyone can write the marker in a comment', () => {
    const forged = Array.from({ length: MAX_TICKETS }, (_, i) => ({ user: { login: 'someone' }, body: `<!-- delegation warehouse ${i} -->` }))
    expect(plan({ comments: forged }).open).toHaveLength(1)
  })
  it('starts no agents past the depth limit, and still opens the ticket', () => {
    const body = (depth) => `<!-- delegated-from o/a#1 depth=${depth} -->`
    expect(depthOf(body(1))).toBe(1)
    expect(plan({ body: body(MAX_DEPTH - 1) }).open[0].start).toBe(true)
    expect(plan({ body: body(MAX_DEPTH) }).open[0].start).toBe(false)
  })
})

describe('waiting', () => {
  it('waits only for what is not done yet', () => {
    expect(waitingOn([note('warehouse', 7), note('warehouse', 8), note('warehouse', 7, true)])).toEqual([{ name: 'warehouse', number: 8 }])
  })
  it('ignores a marker from anyone but the workflow', () => {
    expect(waitingOn([{ user: { login: 'someone' }, body: '<!-- delegation warehouse 7 -->' }])).toEqual([])
  })
  it('goes on only when the change is closed and in the pin', () => {
    const closed = { state: 'CLOSED', stateReason: 'COMPLETED', commit: 'abc' }
    expect(verdict({ state: 'OPEN' })).toBe('wait')
    expect(verdict({ ...closed, inPin: false })).toBe('wait')
    expect(verdict({ ...closed, inPin: true })).toBe('done')
  })
  it('calls a person when the ticket was closed with no change', () => {
    expect(verdict({ state: 'CLOSED', stateReason: 'NOT_PLANNED', commit: null })).toBe('person')
    expect(verdict({ state: 'CLOSED', stateReason: 'COMPLETED', commit: null })).toBe('person')
  })
  it('needs all of them', () => {
    expect(wakeAction(['done', 'done'])).toBe('go')
    expect(wakeAction(['done', 'wait'])).toBe('wait')
    expect(wakeAction(['done', 'person', 'wait'])).toBe('person')
  })
  it('tells the agents what happened, in the brief', () => {
    const brief = briefOf('Returns', 'Text', [{ user: BOT, body: '<!-- delegation-done warehouse 7 -->\no/warehouse#7 is closed.' }], () => false)
    expect(brief).toContain('The pipeline said:\n\no/warehouse#7 is closed.')
    expect(brief).not.toContain('<!--')
  })
})

describe('the script, against a stand-in for gh', () => {
  const TOOL = resolve('pipeline/tools/delegate.mjs')
  // `gh` here writes each call with its token to calls.log and answers from answers.json.
  function setUp(answers) {
    const dir = mkdtempSync(join(tmpdir(), 'delegate-'))
    mkdirSync(join(dir, '.radical/model'), { recursive: true })
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, '.radical/model/deps.json'), JSON.stringify(deps))
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers))
    writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs')
const args = process.argv.slice(2).join(' ')
appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, process.env.GH_TOKEN + ' | ' + args.split('\\n')[0] + '\\n')
const answers = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'answers.json'))}, 'utf8'))
const key = Object.keys(answers).find((k) => args.includes(k))
if (key && answers[key] === 'FAIL') { console.error('refused'); process.exit(1) }
process.stdout.write(key ? answers[key] : '')
`)
    chmodSync(join(dir, 'bin/gh'), 0o755)
    const run = (env, ...args) => execFileSync('node', [TOOL, ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/shop', GH_TOKEN: 'here', ...env },
    })
    return { dir, run, calls: () => readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') }
  }
  const report = (dir) => { writeFileSync(join(dir, 'r.md'), '## Delegate to warehouse\n\nTake goods back.\n'); return 'r.md' }
  const OPEN = { DELEGATE_TOKEN: 'there', ISSUE_TITLE: 'Returns', ISSUE_BODY: 'Text' }

  it('opens the ticket with the token for there, and marks this one waiting with the token for here', () => {
    const { dir, run, calls } = setUp({ 'issue create': 'https://github.com/o/warehouse/issues/7\n' })
    run(OPEN, 'open', '12', report(dir))
    const log = calls()
    expect(log.find((c) => c.includes('issue create'))).toMatch(/^there \| issue create --repo o\/warehouse/)
    expect(log.find((c) => c.includes('--add-label agent:implement'))).toMatch(/^there \| issue edit https:\/\/github.com\/o\/warehouse\/issues\/7/)
    expect(log.find((c) => c.includes('issue comment'))).toContain('<!-- delegation warehouse 7 -->')
    expect(log.find((c) => c.includes('agent:waiting'))).toMatch(/^here \| issue edit 12 --repo o\/shop --remove-label agent:implement --add-label agent:waiting/)
  })
  it('falls back on a person when the ticket cannot be opened', () => {
    const { dir, run, calls } = setUp({ 'issue create': 'FAIL' })
    run({ ...OPEN, DELEGATE_TOKEN: '' }, 'open', '12', report(dir))
    const log = calls()
    expect(log.some((c) => c.includes('agent:question') && c.startsWith('here'))).toBe(true)
    expect(log.some((c) => c.includes('--add-label agent:waiting'))).toBe(false)
  })
  const COMMENTS = JSON.stringify({ user: BOT, body: '<!-- delegation warehouse 7 -->\nx' }) + '\n'
  const CLOSED = JSON.stringify({ state: 'CLOSED', stateReason: 'COMPLETED', timelineItems: { nodes: [{ closer: { mergeCommit: { oid: 'abc' } } }] } })
  const WAKE = { 'issue list': '[{"number":12}]', 'issues/12/comments': COMMENTS, graphql: CLOSED }
  const TOKENS = { DELEGATE_TOKEN: 'there', AGENT_TOKEN: 'agents' }

  it('starts the agents with their own token once the pin holds the change', () => {
    const { run, calls } = setUp({ ...WAKE, 'compare/v1.1.0...abc': 'behind' })
    expect(run(TOKENS, 'wake')).toContain('#12: go')
    const log = calls()
    expect(log.find((c) => c.includes('--add-label agent:implement'))).toMatch(/^agents \| /)
    expect(log.find((c) => c.includes('--remove-label agent:waiting'))).toMatch(/^here \| /)
    expect(log.some((c) => c.includes('<!-- delegation-done warehouse 7 -->'))).toBe(true)
  })
  it('keeps waiting while the pin does not hold it', () => {
    const { run, calls } = setUp({ ...WAKE, 'compare/v1.1.0...abc': 'ahead' })
    expect(run(TOKENS, 'wake')).toContain('#12: wait')
    expect(calls().some((c) => c.includes('agent:implement'))).toBe(false)
  })
  it('asks a person when the other ticket was closed with no change', () => {
    const notPlanned = JSON.stringify({ state: 'CLOSED', stateReason: 'NOT_PLANNED', timelineItems: { nodes: [{ closer: null }] } })
    const { run, calls } = setUp({ ...WAKE, graphql: notPlanned })
    expect(run(TOKENS, 'wake')).toContain('#12: person')
    const log = calls()
    expect(log.some((c) => c.includes('--add-label agent:question') && c.includes('--remove-label agent:waiting'))).toBe(true)
    expect(log.some((c) => c.includes('--add-label agent:implement'))).toBe(false)
  })
})

describe('the step after the coding agent, in a real repository', () => {
  const STEP = parse(readFileSync('.github/workflows/model-and-code.yml', 'utf8')).jobs.code.steps
    .find((s) => s.name === 'A coding agent that hands work on leaves nothing').run
  function built(report) {
    const dir = mkdtempSync(join(tmpdir(), 'after-code-'))
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' })
    git('init', '-q')
    writeFileSync(join(dir, '.gitignore'), '.agent/\n.standards/\n')
    writeFileSync(join(dir, 'kept.ts'), 'old\n')
    git('add', '-A')
    git('commit', '-qm', 'model')
    cpSync('pipeline/tools', join(dir, '.standards/pipeline/tools'), { recursive: true })
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent/report.md'), report)
    writeFileSync(join(dir, 'kept.ts'), 'changed by the agent\n')
    writeFileSync(join(dir, 'new.ts'), 'added by the agent\n')
    execFileSync('bash', ['-e', '-c', STEP], { cwd: dir, stdio: 'ignore' })
    return dir
  }
  it('throws away what the agent built, and keeps its report', () => {
    const dir = built('## Done\n\nBuilt it.\n\n## Delegate to warehouse\n\nMake it idempotent.\n')
    expect(readFileSync(join(dir, 'kept.ts'), 'utf8')).toBe('old\n')
    expect(existsSync(join(dir, 'new.ts'))).toBe(false)
    expect(readFileSync(join(dir, '.agent/report.md'), 'utf8')).toContain('Delegate to warehouse')
    expect(existsSync(join(dir, '.standards/pipeline/tools/delegate.mjs'))).toBe(true)
  })
  it('keeps what the agent built when it hands nothing on', () => {
    const dir = built('## Done\n\nBuilt it.\n')
    expect(readFileSync(join(dir, 'kept.ts'), 'utf8')).toBe('changed by the agent\n')
    expect(existsSync(join(dir, 'new.ts'))).toBe(true)
  })
})
