#!/usr/bin/env node
// The night's check, turned into findings: each error of radical check becomes
// a finding in the findings folder, unless an open finding already says the
// same.
//
//   node .standards/pipeline/tools/nightly-findings.mjs <check.json> <findings folder> --commit <sha> [--run <url>]
//
// Prints the findings written, one path a line.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const field = (text, name) => text.match(new RegExp(`^${name}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1]

/** The findings to write for `check` (radical check --format json), numbered
 *  after those of `existing` ({ name, text }). */
export function nightlyFindings(check, existing, { commit, run, today }) {
  const known = new Set(existing.filter((f) => ['open', 'question'].includes(field(f.text, 'status'))).map((f) => field(f.text, 'signature')))
  let next = Math.max(0, ...existing.map((f) => Number(f.name.match(/^F-(\d+)/)?.[1] ?? 0))) + 1
  const out = []
  for (const problem of check.findings.filter((f) => f.severity === 'error')) {
    const signature = `sense|${problem.rule}|${problem.nodeId ?? problem.message}`
    if (known.has(signature)) continue
    known.add(signature)
    const id = `F-${String(next++).padStart(4, '0')}`
    out.push({ name: `${id}.md`, text: [
      '---', `id: "${id}"`, `title: ${JSON.stringify(problem.message.split('\n')[0])}`, 'source: "sense"', 'status: "open"',
      `rule: "${problem.rule}"`, `signature: ${JSON.stringify(signature)}`, `commit: "${commit}"`, `found: "${today}"`, '---', '',
      '## What differs', '', problem.message, '', ...(run ? [`Seen in ${run}`, ''] : []),
    ].join('\n') })
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { commit: { type: 'string' }, run: { type: 'string' } } })
  const [checkFile, folder] = positionals
  mkdirSync(folder, { recursive: true })
  const existing = readdirSync(folder).filter((n) => /^F-\d+\.md$/.test(n)).map((name) => ({ name, text: readFileSync(join(folder, name), 'utf8') }))
  const check = JSON.parse(readFileSync(checkFile, 'utf8'))
  for (const f of nightlyFindings(check, existing, { commit: values.commit ?? 'unknown', run: values.run, today: new Date().toISOString().slice(0, 10) })) {
    writeFileSync(join(folder, f.name), f.text)
    console.log(join(folder, f.name))
  }
}
