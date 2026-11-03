#!/usr/bin/env node
// Runs one agent, the same way on a laptop and on a runner:
//
//   node .standards/pipeline/tools/run-agent.mjs <agent> [--report <file>] [<arguments of the skill>…]
//
// The agent is a skill of .claude/skills, run headless with its allow-list from
// tools/agents.mjs. AGENT_MODEL overrides the model. What the run cost goes on
// the log and, on a runner, on the step summary.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AGENTS, agentEnvironment } from './agents.mjs'

export const DEFAULT_MODEL = 'claude-haiku-5-5'

export function claudeArguments(name, skillArguments, model = process.env.AGENT_MODEL || DEFAULT_MODEL) {
  const agent = AGENTS[name]
  return [
    '-p', `/${name} ${skillArguments.join(' ')}`.trim(),
    '--model', model,
    '--max-turns', String(agent.maxTurns),
    '--mcp-config', '.mcp.json', '--strict-mcp-config',
    '--allowedTools', ...agent.tools,
    ...(agent.denied ? ['--disallowedTools', ...agent.denied] : []),
    '--output-format', 'json',
  ]
}

/** What claude -p --output-format json said: the report, and one line of cost.
 *  A run that hit its limit of turns has no result, and counts as failed. */
export function readResult(stdout, name) {
  let run
  try {
    run = JSON.parse(stdout)
  } catch {
    return { failed: true, report: stdout, cost: `${name}: no result` }
  }
  const usage = run.usage ?? {}
  const tokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
  const models = Object.keys(run.modelUsage ?? {}).join(', ') || 'unknown model'
  const cost = `${name}: ${models}, ${run.num_turns ?? '?'} turns, ${tokens} input and ${usage.output_tokens ?? 0} output tokens, $${(run.total_cost_usd ?? 0).toFixed(3)}`
  return { failed: Boolean(run.is_error) || typeof run.result !== 'string', report: run.result ?? `The agent stopped: ${run.subtype ?? 'no result'}.`, cost }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, ...rest] = process.argv.slice(2)
  if (!AGENTS[name]) {
    console.error(`Which agent? ${Object.keys(AGENTS).join(', ')}`)
    process.exit(2)
  }
  const at = rest.indexOf('--report')
  const report = at >= 0 ? rest.splice(at, 2)[1] : '.agent/report.md'
  const run = spawnSync('claude', claudeArguments(name, rest), { env: agentEnvironment(process.env), encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit'] })
  mkdirSync(dirname(report), { recursive: true })
  const result = readResult(run.stdout ?? '', name)
  writeFileSync(report, result.report)
  console.log(result.report)
  console.log(result.cost)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.cost}\n`)
  if (run.error) console.error(run.error.message)
  process.exit(run.status || (result.failed ? 1 : 0))
}
