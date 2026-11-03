#!/usr/bin/env node
// A new version of this repository is out: proposes it to the repositories that pin it, each
// in a pull request of its own, which their Gate reads against the new version. Nothing here
// merges. The repository says who they are in .radical/pipeline.json.
//
//   node pipeline/tools/bump-pins.mjs <tag>        with GH_TOKEN, which can push to them
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEPS = '.radical/model/deps.json'
const WORKFLOWS = '.github/workflows'

/** The deps.json text with the dependency `name` at `tag`, or null when nothing changes. */
export function bumpedDeps(text, name, tag) {
  const deps = JSON.parse(text)
  const dep = deps.dependencies.find((d) => d.name === name)
  if (!dep || dep.ref === tag) return null
  dep.ref = tag
  return JSON.stringify(deps, null, 2) + '\n'
}

/** The workflow's text with every call into the repository `repo` at `tag`. */
export function bumpedWorkflow(text, repo, tag) {
  const uses = new RegExp(`(uses:\\s*${repo.replace(/[.]/g, '\\.')}/\\.github/workflows/[^@\\s]+@)\\S+`, 'g')
  return text.replace(uses, `$1${tag}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2]
  const token = process.env.GH_TOKEN
  if (!tag || !token) {
    console.error('Which tag, and is GH_TOKEN set?')
    process.exit(2)
  }
  const { name, consumers } = JSON.parse(readFileSync('.radical/pipeline.json', 'utf8'))
  const repo = process.env.GITHUB_REPOSITORY
  for (const consumer of consumers) {
    const dir = mkdtempSync(join(tmpdir(), 'pin-'))
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'inherit' })
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', `https://x-access-token:${token}@github.com/${consumer}.git`, dir], { stdio: 'inherit' })
      const deps = bumpedDeps(readFileSync(join(dir, DEPS), 'utf8'), name, tag)
      if (!deps) {
        console.log(`${consumer} needs nothing for ${name} ${tag}.`)
        continue
      }
      writeFileSync(join(dir, DEPS), deps)
      if (existsSync(join(dir, WORKFLOWS))) {
        for (const file of readdirSync(join(dir, WORKFLOWS))) {
          const path = join(dir, WORKFLOWS, file)
          writeFileSync(path, bumpedWorkflow(readFileSync(path, 'utf8'), repo, tag))
        }
      }
      const branch = `bot/${name}-${tag}`
      git('config', 'user.name', 'radical-pin-bot')
      git('config', 'user.email', 'radical-pin-bot@users.noreply.github.com')
      git('checkout', '-q', '-b', branch)
      git('add', '-A')
      git('commit', '-q', '-m', `Pin ${name} at ${tag}`)
      git('push', '-q', '--force', 'origin', branch)
      const body = `${name} released ${tag}. The Gate of this pull request checks this repository against it: its model composed with that version${name === 'standards' ? ', and the pipeline at that version' : ''}.`
      execFileSync('gh', ['pr', 'create', '--repo', consumer, '--base', 'main', '--head', branch, '--title', `Pin ${name} at ${tag}`, '--body', body], { stdio: 'inherit' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
