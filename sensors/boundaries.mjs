#!/usr/bin/env node
// Sensor boundaries, for the fitness function Services stay on their own (ADR
// Services talk over HTTP): every import in the element's paths stays inside
// them, or names a workspace of packages/, which hold only shared types. Run by
// radical sense run, once per element, in the repository it measures.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fail, measuredElement, sensorContext } from './context.mjs'

const ROOT = process.cwd()
const element = measuredElement(sensorContext())
const own = element.paths.map((p) => resolve(ROOT, p))
const inside = (file) => own.some((dir) => file === dir || file.startsWith(dir + '/'))

const workspaces = (folder) => {
  const top = join(ROOT, folder)
  if (!existsSync(top)) return []
  return readdirSync(top).map((name) => join(top, name, 'package.json')).filter(existsSync).map((file) => JSON.parse(readFileSync(file, 'utf8')).name)
}
const services = new Set(workspaces('services'))
const leavesPackage = (spec) => [...services].some((name) => spec === name || spec.startsWith(name + '/'))

const files = (dir) => readdirSync(dir).flatMap((name) => {
  if (name === 'node_modules') return []
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : /\.[cm]?[jt]sx?$/.test(name) ? [path] : []
})

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const leaks = own.flatMap(files).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT)]
    .map((m) => m[1] ?? m[2])
    .filter((spec) => spec.startsWith('.') ? !inside(resolve(dirname(file), spec)) : leavesPackage(spec))
    .map((spec) => `${relative(ROOT, file)} imports ${spec}`))

if (leaks.length) fail(`${element.label} reaches outside ${element.paths.join(', ')}: ${leaks.join('; ')}.`)
console.log(`${element.label}: every import stays inside ${element.paths.join(', ')}.`)
