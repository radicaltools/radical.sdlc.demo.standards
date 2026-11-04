import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { outOfScope } from '../tools/agents.mjs'
import { planDelegations } from '../tools/delegate.mjs'
import { RECONCILED, branchOf, gapOf, markerOf, nextStep, outcomeOf, ticketBody, ticketsAnswered } from '../tools/reconcile.mjs'

const DESIRED = 'a'.repeat(40)
const none = { added: [], changed: [], removed: [] }
const step = (over) => nextStep({ gap: 2, desired: DESIRED, pulls: [], tickets: [], ...over }).step

describe('the gap', () => {
  it('counts the elements and the relations', () => {
    expect(gapOf({ elements: none, relations: none })).toBe(0)
    expect(gapOf({ elements: { ...none, added: [1], changed: [2] }, relations: { ...none, removed: [3] } })).toBe(3)
  })
})

describe('what to do now', () => {
  it('does nothing without a gap, whatever is open', () => {
    expect(step({ gap: 0, pulls: [{ number: 1, state: 'OPEN', headRefName: branchOf(DESIRED) }] })).toBe('converged')
  })
  it('works on a gap', () => {
    expect(step()).toBe('work')
  })
  it('waits while a pull request is open, even of an older version', () => {
    expect(step({ pulls: [{ number: 1, state: 'OPEN', headRefName: branchOf('b'.repeat(40)) }] })).toBe('in-progress')
  })
  it('tries a version of the model once: a closed pull request counts', () => {
    expect(step({ pulls: [{ number: 1, state: 'CLOSED', headRefName: branchOf(DESIRED) }] })).toBe('stuck')
  })
  it('tries a version of the model once: a ticket to a person counts', () => {
    expect(step({ tickets: [{ number: 1, body: `${markerOf(DESIRED)}\ntext` }] })).toBe('stuck')
  })
  it('tries again on a new version of the model', () => {
    const old = 'b'.repeat(40)
    expect(step({ pulls: [{ number: 1, state: 'CLOSED', headRefName: branchOf(old) }], tickets: [{ number: 2, body: markerOf(old) }] })).toBe('work')
  })
})

describe('the tickets the code answers', () => {
  it('those the model changed for, and those the loop opened, once each', () => {
    expect(ticketsAnswered(['Model: Returns (#29)', 'Model: Order (#32)', 'Model: Fix F-0001', 'Model: Returns again (#29)', ''], [{ number: 31 }, { number: 32 }])).toEqual(['29', '32', '31'])
  })
  it('a number inside a title is not one', () => {
    expect(ticketsAnswered(['Model: Like #4 and (#5) said'], [])).toEqual([])
  })
})

describe('the ticket that says why', () => {
  it('carries the version it tried', () => {
    expect(ticketBody(DESIRED, 'Why.', false)).toContain(markerOf(DESIRED))
    expect(ticketBody(DESIRED, 'Why.', true)).toContain(markerOf(DESIRED))
  })
  it('tells a person to answer in a new ticket, so the report stays out of the model', () => {
    expect(ticketBody(DESIRED, 'Why.', false)).toContain('open a new ticket holding only the answer')
  })
  it('asks nothing of a person when the work is handed on', () => {
    const body = ticketBody(DESIRED, 'Why.', true)
    expect(body).toContain('closes by itself')
    expect(body).not.toContain('open a new ticket')
  })
})

describe('what is handed on, again', () => {
  const report = '## Delegate to warehouse\n\nA tracking status.\n\n## Delegate to billing\n\nA refund.\n'
  const deps = { name: 'shop', dependencies: [
    { name: 'warehouse', repo: 'https://github.com/o/warehouse.git' }, { name: 'billing', repo: 'https://github.com/o/billing.git' },
  ] }
  it('names the ticket after what it asks, when no ticket here says it', () => {
    const { open } = planDelegations({ report: '## Delegate to warehouse\n\n**A tracking status** for a dispatch.\n\nMore.\n', deps, comments: [], body: '', title: '', from: 'o/shop#1' })
    expect(open[0].title).toBe('shop: A tracking status for a dispatch.')
  })
  it('no second ticket for what is on its way', () => {
    const { open } = planDelegations({ report, deps, comments: [], body: '', title: 'T', from: 'o/shop#1', asked: ['warehouse'] })
    expect(open.map((t) => t.name)).toEqual(['billing'])
  })
})

describe('what became of the agent', () => {
  it('code goes into a pull request', () => {
    expect(outcomeOf({ report: 'Built it.', changed: true, failed: false })).toBe('pull')
  })
  it('no code needed, with the reason, goes into a pull request a person reads', () => {
    expect(outcomeOf({ report: '## No code needed\n\nOnly a text changed.', changed: false, failed: false })).toBe('pull')
  })
  it('nothing, and no reason, goes to a person', () => {
    expect(outcomeOf({ report: 'Done.', changed: false, failed: false })).toBe('ask')
  })
  it('a question goes to a person, even with code', () => {
    expect(outcomeOf({ report: '## Model questions\n\nWhich limit?', changed: true, failed: false })).toBe('ask')
  })
  it('handing on goes to a person in this trial, even with code', () => {
    expect(outcomeOf({ report: '## Delegate to standards\n\nA rule.', changed: true, failed: false })).toBe('ask')
  })
  it('a failed run proposes nothing, even with code', () => {
    expect(outcomeOf({ report: '', changed: true, failed: true })).toBe('ask')
    expect(outcomeOf({ report: '## No code needed\n\nWhy.', changed: false, failed: true })).toBe('ask')
  })
})

describe('on the command line', () => {
  const tool = resolve('pipeline/tools/reconcile.mjs')
  const inRepo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-'))
    execFileSync('mkdir', ['-p', join(dir, '.radical')])
    execFileSync('git', ['init', '-q'], { cwd: dir })
    return dir
  }
  it('says the code has reached a commit', () => {
    const dir = inRepo()
    execFileSync('node', [tool, 'mark', DESIRED], { cwd: dir })
    expect(JSON.parse(readFileSync(join(dir, RECONCILED), 'utf8'))).toEqual({ model: DESIRED })
  })
  it('reads what the agent left in the working tree, and its report', () => {
    const dir = inRepo()
    const output = join(dir, '.git', 'out')
    const env = { ...process.env, GITHUB_OUTPUT: output }
    execFileSync('node', [tool, 'outcome', 'none.md', 'success'], { cwd: dir, env })
    expect(readFileSync(output, 'utf8')).toBe('act=ask\n')
    writeFileSync(join(dir, 'code.ts'), 'x')
    execFileSync('node', [tool, 'outcome', 'none.md', 'success'], { cwd: dir, env })
    expect(readFileSync(output, 'utf8')).toBe('act=ask\nact=pull\n')
  })
  it('wakes nothing where the code follows the model', () => {
    const dir = inRepo()
    writeFileSync(join(dir, RECONCILED), JSON.stringify({ model: DESIRED }))
    expect(execFileSync('node', [resolve('pipeline/tools/delegate.mjs'), 'wake'], { cwd: dir, encoding: 'utf8' })).toContain('nothing to wake')
  })
  it('a repository without the file does not reconcile', () => {
    const dir = inRepo()
    const output = join(dir, '.git', 'out')
    execFileSync('node', [tool, 'next'], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output } })
    expect(readFileSync(output, 'utf8')).toBe('step=unmanaged\n')
    expect(execFileSync('node', [tool, 'converged'], { cwd: dir, encoding: 'utf8' })).toContain('reached')
  })
  it('refuses a file that names no commit, before it reaches a command', () => {
    const dir = inRepo()
    writeFileSync(join(dir, RECONCILED), JSON.stringify({ model: '--upload-pack=x' }))
    expect(() => execFileSync('node', [tool, 'converged'], { cwd: dir, stdio: 'pipe' })).toThrow(/names no commit/)
  })
})

describe('who may say the code has reached the model', () => {
  it('no agent', () => {
    for (const agent of ['model-agent', 'coding-agent', 'testing-agent', 'explore-agent']) expect(outOfScope(agent, [RECONCILED])).toEqual([RECONCILED])
  })
})
