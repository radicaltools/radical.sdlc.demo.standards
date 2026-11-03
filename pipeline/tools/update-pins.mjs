#!/usr/bin/env node
// Looks for new versions of what this repository depends on, and proposes each in a pull
// request of its own, which the Gate reads against that version. The repository that made
// the version knows nothing of this: it only has a tag. Nothing here merges.
//
//   node .standards/pipeline/tools/update-pins.mjs      with GH_TOKEN, which can push here
//
// The dependencies are those of .radical/model/deps.json. A pin that is no version (a branch,
// a commit, latest) is the repository's own choice and stays. The dependency's model changes
// between the two tags go into the text of the pull request.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODEL = '.radical/model'
const DEPS = `${MODEL}/deps.json`
const WORKFLOWS = '.github/workflows'
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/

/** A version's three numbers, or null for anything else, a pre-release too. */
const versionOf = (ref) => ref.match(VERSION)?.slice(1).map(Number) ?? null

const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** The newest version among `refs` above the version `pin`, or null: nothing newer, or a
 *  pin that is no version. */
export function newestVersion(pin, refs) {
  const current = versionOf(pin)
  if (!current) return null
  let best = null
  for (const ref of refs) {
    const version = versionOf(ref)
    if (version && newer(version, best ? versionOf(best) : current)) best = ref
  }
  return best
}

/** The tags in the output of git ls-remote --tags --refs. */
export const tagsIn = (listing) => listing.split('\n').map((line) => line.match(/refs\/tags\/(.+)$/)?.[1]).filter(Boolean)

/** The deps.json text with the dependency `name` at `tag`. */
export function bumpedDeps(text, name, tag) {
  const deps = JSON.parse(text)
  deps.dependencies.find((d) => d.name === name).ref = tag
  return JSON.stringify(deps, null, 2) + '\n'
}

/** owner/name of a GitHub address, or null. */
export const slugOf = (repo) => repo.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null

/** The workflow's text with every call into the repository `slug` at `tag`. */
export function bumpedWorkflow(text, slug, tag) {
  const uses = new RegExp(`(uses:\\s*${slug.replace(/[.]/g, '\\.')}/\\.github/workflows/[^@\\s]+@)\\S+`, 'g')
  return text.replace(uses, `$1${tag}`)
}

/** The text of the pull request. */
export function pullRequestText({ name, from, to, changes, pipeline }) {
  return [
    `${name} has a new version: ${from} to ${to}.`,
    '',
    `The Gate of this pull request checks this repository against it: its model composed with that version${pipeline ? ', and the pipeline at that version' : ''}.`,
    '',
    `### What changed in the model of ${name}`,
    '',
    '```',
    changes.trim(),
    '```',
    '',
    'A decision can change with a green Gate, when no fitness function measures the change. Read it above.',
    '',
  ].join('\n')
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const addressOf = (repo) => (/^[a-z+]+:\/\/|^[^/]+@[^/]+:/.test(repo) || isAbsolute(repo) ? repo : resolve(MODEL, repo))

/** What radical diff says of the dependency's model between the two versions. */
function modelChanges(dep, tag) {
  const copy = mkdtempSync(join(tmpdir(), 'pin-'))
  try {
    const address = addressOf(dep.repo)
    git('-c', 'advice.detachedHead=false', 'clone', '-q', '--branch', tag, address.startsWith('/') ? `file://${address}` : address, copy)
    const run = spawnSync('npx', ['radical', 'diff', join(copy, dep.path), '--since', dep.ref], { encoding: 'utf8' })
    return run.status === 0 ? run.stdout : `radical diff could not say: ${run.stderr.trim()}`
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GH_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) {
    console.error('GH_TOKEN and GITHUB_REPOSITORY must be set.')
    process.exit(2)
  }
  const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' }).trim()
  const remote = process.env.PINS_REMOTE ?? `https://x-access-token:${token}@github.com/${repo}.git`
  git('config', 'user.name', 'radical-pin-bot')
  git('config', 'user.email', 'radical-pin-bot@users.noreply.github.com')
  const base = git('rev-parse', 'HEAD')
  for (const dep of JSON.parse(readFileSync(DEPS, 'utf8')).dependencies) {
    const tag = newestVersion(dep.ref, tagsIn(git('ls-remote', '--tags', '--refs', addressOf(dep.repo))))
    if (!tag) {
      console.log(`${dep.name} ${dep.ref}: nothing newer.`)
      continue
    }
    console.log(`${dep.name}: ${dep.ref} to ${tag}.`)
    const slug = slugOf(dep.repo)
    git('checkout', '-q', '-B', `bot/${dep.name}`, base)
    writeFileSync(DEPS, bumpedDeps(readFileSync(DEPS, 'utf8'), dep.name, tag))
    let pipeline = false
    if (slug && existsSync(WORKFLOWS)) {
      for (const file of readdirSync(WORKFLOWS)) {
        const path = join(WORKFLOWS, file)
        const before = readFileSync(path, 'utf8')
        const after = bumpedWorkflow(before, slug, tag)
        if (after !== before) {
          writeFileSync(path, after)
          pipeline = true
        }
      }
    }
    git('add', DEPS, WORKFLOWS)
    git('commit', '-q', '-m', `Pin ${dep.name} at ${tag}`)
    // One rolling branch per dependency: a newer tag moves the open pull request along.
    git('push', '-q', '--force', remote, `HEAD:refs/heads/bot/${dep.name}`)
    const title = `Pin ${dep.name} at ${tag}`
    const textFile = join(tmpdir(), `pin-${dep.name}.md`)
    writeFileSync(textFile, pullRequestText({ name: dep.name, from: dep.ref, to: tag, changes: modelChanges(dep, tag), pipeline }))
    const open = gh('pr', 'list', '--head', `bot/${dep.name}`, '--state', 'open', '--json', 'number', '-q', '.[0].number')
    if (open) gh('pr', 'edit', open, '--title', title, '--body-file', textFile)
    else gh('pr', 'create', '--base', 'main', '--head', `bot/${dep.name}`, '--title', title, '--body-file', textFile)
    git('checkout', '-q', base)
  }
}
