#!/usr/bin/env node
// An exploratory round of Radical Crucible, with no AI of its own: radical explore prepares
// the runs, an agent explores each area against the system on its own ports, radical explore
// verify runs every finding's script again without the agent, and radical explore record
// writes what still shows the problem. A script exits with 3 when the problem is there: 1 is
// what node exits with on any crash, and on a script that does not exist.
//
//   node .standards/pipeline/tools/explore-round.mjs
//
// The repository says what to serve and explore in .radical/pipeline.json, and serves each
// part with its own tools/serve-for-explore.mjs.
//
// A summary for the pull request goes to .agent/report.md.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { serve: PARTS, areas: AREAS } = JSON.parse(readFileSync('.radical/pipeline.json', 'utf8'))
const JSON_BLOCK = /```json\s*\n([\s\S]*?)\n```/g
const PROBLEM_SHOWN = 3
const isScriptName = (script) => /^[\w.-]+\.m?js$/.test(script ?? '')

/** The findings of a report's last JSON block. */
export function findingsOf(report) {
  const block = [...report.matchAll(JSON_BLOCK)].at(-1)
  if (!block) return []
  try {
    return JSON.parse(block[1]).findings ?? []
  } catch {
    return []
  }
}

/** The report with only the findings whose script showed the problem when run again. */
export function confirmedReport(report, verified) {
  const block = [...report.matchAll(JSON_BLOCK)].at(-1)
  if (!block) return report
  const data = JSON.parse(block[1])
  const shows = (finding) => isScriptName(finding.script) && verified.some((v) => v.script === finding.script && v.exit === PROBLEM_SHOWN)
  data.seenOnce = [...(data.seenOnce ?? []), ...data.findings.filter((f) => !shows(f)).map((f) => f.title)]
  data.findings = data.findings.filter(shows)
  return report.slice(0, block.index) + '```json\n' + JSON.stringify(data, null, 2) + '\n```' + report.slice(block.index + block[0].length)
}

async function serve(ports) {
  const servers = PARTS.map((service) =>
    spawn('node', ['tools/serve-for-explore.mjs', service, String(ports.app), String(ports.hub), String(ports.other)], { stdio: 'ignore' }))
  for (const port of Object.values(ports)) {
    for (let tries = 0; tries < 60; tries++) {
      if (await fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false)) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  return () => Promise.all(servers.map((s) => new Promise((resolve) => { s.once('exit', resolve); s.kill('SIGTERM') })))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prepared = execFileSync('npx', ['radical', 'explore', 'prepare', '--runs', String(AREAS.length), '--areas', AREAS.join('; ')], { encoding: 'utf8' })
  console.log(prepared)
  const folder = prepared.match(/ in (\S+):/)[1]
  const lines = []
  for (const { run, area, folder: runFolder, ports } of JSON.parse(readFileSync(join(folder, 'round.json'), 'utf8')).runs) {
    const stop = await serve(ports)
    const reportFile = join(runFolder, 'REPORT.md')
    const agent = spawnSync('node', ['.standards/pipeline/tools/run-agent.mjs', 'explore-agent', `prompt=${join(runFolder, 'PROMPT.md')}`, '--report', reportFile], { stdio: 'inherit' })
    await stop()
    if (agent.status !== 0) {
      lines.push(`- **${area}**: the agent did not finish.`)
      continue
    }
    const report = readFileSync(reportFile, 'utf8')
    const scripts = findingsOf(report).map((f) => f.script).filter(isScriptName).filter((script) => existsSync(join(runFolder, script)))
    if (scripts.length) spawnSync('npx', ['radical', 'explore', 'verify', String(run), ...scripts], { stdio: 'inherit' })
    const verified = JSON.parse(readFileSync(join(folder, 'round.json'), 'utf8')).runs.find((r) => r.run === run).verified
    const kept = confirmedReport(report, verified)
    writeFileSync(reportFile, kept)
    if (findingsOf(kept).length) spawnSync('npx', ['radical', 'explore', 'record', reportFile], { stdio: 'inherit' })
    const titles = findingsOf(kept).map((f) => f.title)
    lines.push(`- **${area}**: ${titles.length ? titles.join('; ') : 'nothing that held up when run again'}${findingsOf(report).length > titles.length ? ` (${findingsOf(report).length - titles.length} did not hold up)` : ''}.`)
  }
  mkdirSync('.agent', { recursive: true })
  writeFileSync('.agent/report.md', `## Exploratory round\n\n${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}
