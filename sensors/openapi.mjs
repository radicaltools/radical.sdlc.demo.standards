#!/usr/bin/env node
// Sensor openapi, for the fitness function API matches its description (ADR APIs
// described in OpenAPI): the routes of the element's service and its openapi.yaml name
// the same operations, both ways. Runs with tsx, in the repository it measures. The
// service's src/server.ts exports buildServer; nothing listens and nothing is called.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { fail, measuredElement, sensorContext } from './context.mjs'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

/** `METHOD /path`, with {id} for each parameter, for each route of Fastify's
 *  printRoutes({ commonPrefix: false }) text. Each line is a piece of a path, deeper
 *  by four columns per level, with its methods in brackets. */
export function routesOf(tree) {
  const found = []
  const stack = []
  for (const line of tree.split('\n')) {
    const at = line.search(/[^│├└─ ]/)
    if (at < 0) continue
    const match = line.slice(at).match(/^(.*?)(?:\s*\(([A-Z, ]+)\))?\s*$/)
    const depth = Math.floor(at / 4)
    stack.length = depth
    stack[depth] = match[1].trim()
    for (const method of match[2]?.split(',').map((m) => m.trim()) ?? []) {
      if (method === 'HEAD' || method === 'OPTIONS') continue
      found.push(`${method} ${stack.join('').replace(/:(\w+)/g, '{$1}').replace(/\/+/g, '/')}`)
    }
  }
  return found
}

/** `METHOD /path` for each operation of a description. */
export function operationsOf(description) {
  return Object.entries(description.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const element = measuredElement(sensorContext())
  const folder = resolve(process.cwd(), element.paths[0])
  const file = join(folder, 'openapi.yaml')
  if (!existsSync(file)) fail(`${element.label} has no ${join(element.paths[0], 'openapi.yaml')}.`)
  const described = new Set(operationsOf(parse(readFileSync(file, 'utf8'))))
  const { buildServer } = await import(pathToFileURL(join(folder, 'src/server.ts')).href)
  const app = buildServer()
  await app.ready()
  const routes = new Set(routesOf(app.printRoutes({ commonPrefix: false })).filter((r) => !r.endsWith(' /health')))
  await app.close()
  const undescribed = [...routes].filter((r) => !described.has(r))
  const missing = [...described].filter((r) => !routes.has(r))
  if (!routes.size) fail(`${element.label}: no routes read from its server.`)
  if (undescribed.length || missing.length) {
    fail(`${element.label}: ${[...undescribed.map((r) => `${r} is not described`), ...missing.map((r) => `${r} is described and not served`)].join('; ')}.`)
  }
  console.log(`${element.label}: ${routes.size} routes, all described, and nothing else.`)
}
