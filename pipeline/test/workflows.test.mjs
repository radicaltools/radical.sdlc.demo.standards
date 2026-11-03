// The rules of the workflows that nothing else would notice being broken.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { AGENTS } from '../tools/agents.mjs'

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'))
/** The file of a few lines a system's repository calls the workflow from. */
const caller = (name) => parse(readFileSync(`pipeline/callers/${name}.yml`, 'utf8'))
const stepsOf = (job) => job.steps
const agentSteps = (job) => stepsOf(job).filter((s) => /run-agent\.mjs|explore-round\.mjs/.test(s.run ?? ''))

const WITH_AGENTS = [['model-and-code', 'code'], ['testing-agent', 'propose'], ['nightly', 'night']]

describe('agents in the workflows', () => {
  it.each(WITH_AGENTS)('%s: the checkout keeps no credentials', (name, job) => {
    const steps = stepsOf(workflow(name).jobs[job])
    for (const s of steps.filter((s) => s.uses?.startsWith('actions/checkout'))) expect(s.with['persist-credentials']).toBe(false)
  })
  it.each(WITH_AGENTS)('%s: the agent step holds only the Claude credential', (name, job) => {
    const steps = agentSteps(workflow(name).jobs[job])
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect(Object.keys(step.env).filter((k) => /TOKEN|KEY/.test(k)).sort()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])
    expect(JSON.stringify(workflow(name).jobs[job].env ?? {})).not.toMatch(/secrets\./)
  })
  it('no text of an issue or pull request is written into a script', () => {
    for (const [name] of WITH_AGENTS) {
      const runs = Object.values(workflow(name).jobs).flatMap((j) => stepsOf(j).map((s) => s.run ?? ''))
      for (const run of runs) expect(run).not.toMatch(/\$\{\{[^}]*(title|body|head_ref|head\.ref|inputs\.)/)
    }
  })
  it('a fork starts no agent', () => {
    expect(workflow('testing-agent').jobs.propose.if).toContain('head.repo.full_name == github.repository')
    expect(workflow('model-and-code').jobs.code.if).toContain('head.repo.full_name == github.repository')
  })
  it('a proposal starts no testing agent', () => {
    const condition = workflow('testing-agent').jobs.propose.if
    expect(condition).toContain("startsWith(github.head_ref, 'agent-tests/')")
    expect(condition).toContain("startsWith(github.head_ref, 'bot/')")
  })
})

describe('model agent and coding agent', () => {
  const steps = () => workflow('model-and-code').jobs.code.steps
  const at = (name) => steps().findIndex((s) => s.name === name)
  it('the model is committed before the code, by a separate agent', () => {
    expect(steps().find((s) => s.name === 'Model agent').run).toContain('run-agent.mjs model-agent')
    expect(steps().find((s) => s.name === 'Coding agent').run).toContain('run-agent.mjs coding-agent')
    expect(at('Model agent')).toBeLessThan(at('Commit the model'))
    expect(at('Commit the model')).toBeLessThan(at('Coding agent'))
  })
  it('the coding agent works from the model, not from the ticket', () => {
    const run = steps().find((s) => s.name === 'Coding agent').run
    expect(run).toContain('rm -f .agent/brief.md')
    expect(run).toContain('mode=implement base=origin/main')
  })
  it('the model agent is told where the brief came from, as a name and not a path', () => {
    expect(steps().find((s) => s.name === 'Model agent').run).toContain('"source=$SOURCE"')
    const task = steps().find((s) => s.name === 'Read the task').run
    expect(task).toContain('echo "source=issue-$ISSUE"')
    expect(task).toContain('echo "source=$FINDING"')
  })
  it('questions stop the run before anything is committed', () => {
    expect(at('Model agent')).toBeLessThan(at('Did it ask'))
    expect(at('Did it ask')).toBeLessThan(at('Ask on the issue'))
    expect(at('Ask on the issue')).toBeLessThan(at('Commit the model'))
    expect(steps().find((s) => s.name === 'Did it ask').run).toContain('git checkout -- .radical/model')
    expect(steps().find((s) => s.name === 'Commit the model').if).toContain("steps.asked.outputs.asked != 'true'")
  })
  it('the agent asks as the workflow, so that a person is notified', () => {
    expect(steps().find((s) => s.name === 'Ask on the issue').env.GH_TOKEN).toBe('${{ github.token }}')
  })
  it('the ticket reaches the agent through the filter of who may answer', () => {
    expect(steps().find((s) => s.name === 'Read the task').run).toContain('tools/questions.mjs brief')
  })
  it('when the coding agent builds nothing, its questions reach the issue', () => {
    expect(at('Commit the code')).toBeLessThan(at('Hand the model questions back'))
    expect(at('Hand the model questions back')).toBeLessThan(at('Push and open the pull request'))
    const step = steps().find((s) => s.name === 'Hand the model questions back')
    expect(step.if).toContain("steps.commit.outputs.changed != 'true'")
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}')
    expect(steps().find((s) => s.name === 'Comment the outcome').env.ASKED).toContain('steps.handed.outputs.handed')
  })
  it('only a ticket by someone with write access starts an agent, whoever gives the label', () => {
    const { author, code } = workflow('model-and-code').jobs
    expect(author.steps.find((s) => s.id === 'check').run).toContain('tools/questions.mjs trusted "$AUTHOR"')
    expect(code.needs).toBe('author')
    expect(code.if).toContain("needs.author.outputs.trusted == 'true'")
  })
  it('the check of the author runs code of main, and no agent', () => {
    const { author } = workflow('model-and-code').jobs
    expect(author.steps.find((s) => s.uses?.startsWith('actions/checkout')).with.ref).toBeUndefined()
    expect(author.steps.map((s) => s.run ?? '').join('\n')).not.toContain('run-agent')
  })
  it('the workflow that prepares for review listens to the checks by their name', () => {
    expect(caller('prepare-for-review').on.workflow_run.workflows).toEqual([caller('ci').name, caller('testing-agent').name])
  })
  it('the checks it reads have the names it reads them by', () => {
    const source = readFileSync('pipeline/tools/prepare-for-review.mjs', 'utf8')
    const { decide: decideJob, propose } = workflow('testing-agent').jobs
    for (const name of [workflow('gate').jobs.gate.name, decideJob.name, propose.name]) expect(source).toContain(`'${name}'`)
  })
  it('the names say which agents run', () => {
    const { jobs } = workflow('model-and-code')
    expect(caller('model-and-code').name).toBe('Model and coding agents')
    expect(jobs.code.name).toContain('Coding agent, fixing the branch')
    expect(jobs.code.name).toContain('Model agent, then coding agent')
  })
  it('an answer on the issue starts the agents, and only an answer', () => {
    const w = workflow('model-and-code')
    expect(caller('model-and-code').on.issue_comment.types).toEqual(['created'])
    const condition = w.jobs.author.if
    expect(condition).toContain('!github.event.issue.pull_request')
    expect(condition).toContain("github.event.comment.user.type != 'Bot'")
    expect(condition).toContain("contains(github.event.issue.labels.*.name, 'agent:question')")
    expect(w.jobs.code.if).toContain("github.event_name == 'issue_comment' && needs.author.outputs.trusted == 'true'")
  })
  it('a comment counts only from someone with write access, while an agent still waits', () => {
    const run = workflow('model-and-code').jobs.author.steps.find((s) => s.id === 'check').run
    expect(run).toContain('questions.mjs trusted "$COMMENTER"')
    expect(run).toContain('index("agent:question")')
    expect(run.indexOf('$COMMENTER')).toBeLessThan(run.indexOf('questions.mjs trusted "$AUTHOR"'))
  })
  it('a fix does not go through the model agent', () => {
    expect(steps().find((s) => s.name === 'Model agent').if).toContain("!= 'fix'")
  })
  it('a pull request needs code, not only a model', () => {
    expect(steps().find((s) => s.name === 'Push and open the pull request').if).toBe("steps.commit.outputs.changed == 'true'")
  })
})

describe('fixing a finding', () => {
  const skill = () => readFileSync('pipeline/skills/coding-agent/SKILL.md', 'utf8')
  it('turns a finding of the fuzz file into a test through radical harden', () => {
    expect(skill()).toContain('npx radical fuzz --replay <id> --no-known')
    expect(skill()).toContain('npx radical harden <id> --scenario')
    expect(skill()).toContain('npx radical harden --gate <id> --base origin/main')
  })
  it('lets the coding agent run those commands', () => {
    expect(AGENTS['coding-agent'].tools).toContain('Bash(npx radical *)')
    expect(AGENTS['coding-agent'].scope.allow).toContain('tests/**')
    expect(AGENTS['coding-agent'].scope.allow).toContain('.radical/crucible/findings/**')
  })
})

describe('the night', () => {
  const runs = () => workflow('nightly').jobs.night.steps.map((s) => s.run ?? '').join('\n')
  it('fuzzes on a random seed, and records what it finds', () => {
    expect(runs()).toContain('radical fuzz night --survey')
  })
  it('explores through radical explore', () => {
    expect(runs()).toContain('tools/explore-round.mjs')
    expect(readFileSync('pipeline/tools/explore-round.mjs', 'utf8')).toContain("'explore', 'prepare'")
  })
})

describe('semi-automation', () => {
  it('runs only when it is switched on, on this repository, on agent branches', () => {
    const condition = workflow('prepare-for-review').jobs.prepare.if
    expect(condition).toContain("vars.AGENT_AUTOMATION == 'true'")
    expect(condition).toContain('head_repository.full_name == github.repository')
    expect(condition).toContain("startsWith(github.event.workflow_run.head_branch, 'agent/')")
  })
  it('never checks out the code of a pull request', () => {
    for (const step of workflow('prepare-for-review').jobs.prepare.steps.filter((s) => s.uses?.startsWith('actions/checkout'))) expect(step.with?.ref).toBeUndefined()
  })
  it('has no way to merge into main: a person does that', () => {
    const source = readFileSync('pipeline/tools/prepare-for-review.mjs', 'utf8')
    expect(source.match(/'merge'/g)).toHaveLength(1)
    expect(source).toContain("'--subject', `Merge proposal ${branch}`")
    expect(source).not.toContain('--squash')
    expect(source).not.toContain('--auto')
  })
  it('an agent opens its pull request as a draft when it is switched on', () => {
    const run = workflow('model-and-code').jobs.code.steps.find((s) => s.name === 'Push and open the pull request').run
    expect(run).toContain('draft="--draft"')
  })
  it('the request for a fix is switched too, and has a limit', () => {
    const job = workflow('gate').jobs['auto-fix']
    expect(job.if).toContain("vars.AGENT_AUTOMATION == 'true'")
    expect(job.steps.map((s) => s.run ?? '').join('\n')).toContain('-ge 3')
  })
  it('the gate stays the one required verdict: no AI in the CI workflow', () => {
    const all = Object.values(workflow('gate').jobs).flatMap((j) => j.steps.map((s) => s.run ?? '')).join('\n')
    expect(all).not.toContain('run-agent')
    expect(all).not.toContain('claude ')
  })
})

describe('the gate and the deploy', () => {
  it('the gate runs the checks in order, on every pull request', () => {
    const ci = workflow('gate')
    expect(caller('ci').on.pull_request).toBeNull()
    expect(ci.jobs.gate.name).toBe('Gate')
    const names = stepsOf(ci.jobs.gate).map((s) => s.run ?? '').join('\n')
    const order = ['npm run typecheck', 'npm run test:reports', 'radical sense run', 'agent-scope.mjs', 'radical check'].map((c) => names.indexOf(c))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
  it('the images are published only after the smoke test and its check', () => {
    const runs = stepsOf(workflow('deploy').jobs.deploy).map((s) => s.run ?? '').join('\n')
    expect(runs.indexOf('radical sense run --trigger deploy')).toBeGreaterThan(-1)
    expect(runs.indexOf('radical check')).toBeGreaterThan(runs.indexOf('radical sense run --trigger deploy'))
    expect(runs.indexOf('docker compose push')).toBeGreaterThan(runs.indexOf('radical check'))
  })
})

describe('the files a system calls the pipeline from', () => {
  const CALLERS = ['ci', 'model-and-code', 'testing-agent', 'prepare-for-review', 'deploy', 'nightly', 'release']
  const called = (name) => Object.values(caller(name).jobs)[0]
  it.each(CALLERS)('%s calls a workflow that exists, at a version', (name) => {
    const uses = called(name).uses
    const file = uses.match(/\/\.github\/workflows\/([\w-]+)\.yml@v\d+\.\d+\.\d+$/)?.[1]
    expect(file).toBeTruthy()
    expect(workflow(file).on.workflow_call).toBeDefined()
  })
  it.each(CALLERS)('%s hands on the secrets', (name) => {
    expect(called(name).secrets).toBe('inherit')
  })
  it('a job permission a workflow asks for is one its caller grants', () => {
    for (const [name, file] of [['ci', 'gate'], ['model-and-code', 'model-and-code'], ['testing-agent', 'testing-agent'], ['prepare-for-review', 'prepare-for-review'], ['deploy', 'deploy'], ['nightly', 'nightly']]) {
      const granted = caller(name).permissions
      const asked = [workflow(file).permissions ?? {}, ...Object.values(workflow(file).jobs).map((j) => j.permissions ?? {})]
      for (const set of asked) {
        for (const [scope, level] of Object.entries(set)) {
          if (level === 'write') expect(granted[scope], `${file}: ${scope}`).toBe('write')
          else expect(granted[scope], `${file}: ${scope}`).toBeTruthy()
        }
      }
    }
  })
  it('a reusable workflow fetches the standards before it uses them', () => {
    for (const file of ['gate', 'model-and-code', 'testing-agent', 'prepare-for-review', 'deploy', 'nightly']) {
      for (const job of Object.values(workflow(file).jobs)) {
        const runs = job.steps.map((s) => `${s.uses ?? ''} ${s.run ?? ''}`)
        const first = runs.findIndex((r) => r.includes('.standards/'))
        if (first >= 0) expect(runs.slice(0, first).join('\n'), `${file}`).toContain('node tools/standards.mjs')
      }
    }
  })
})
