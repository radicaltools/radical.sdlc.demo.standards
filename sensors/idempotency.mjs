#!/usr/bin/env node
// Sensor idempotency, for the fitness function Repeated write changes nothing (ADR
// Retried writes change nothing): each write that test/idempotency.probe.ts of the
// element's service names is sent twice. The second answer has to equal the first,
// and what the probe reads as its state has to stay. Runs with tsx.
//
// A probe is { name, prepare(): { app, request, state() } }, with `request` for
// Fastify's inject, `state` async and answering with anything JSON can hold.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fail, measuredElement, sensorContext } from './context.mjs'

const element = measuredElement(sensorContext())
const file = join(resolve(process.cwd(), element.paths[0]), 'test/idempotency.probe.ts')
if (!existsSync(file)) fail(`${element.label} has no ${join(element.paths[0], 'test/idempotency.probe.ts')}.`)
const { probes } = await import(pathToFileURL(file).href)
if (!probes?.length) fail(`${element.label}: its probe file names no write.`)

const problems = []
for (const { name, prepare } of probes) {
  const { app, request, state } = await prepare()
  const first = await app.inject(request)
  const before = JSON.stringify(await state())
  const second = await app.inject(request)
  const after = JSON.stringify(await state())
  if (first.statusCode >= 400) problems.push(`${name}: the first write answered ${first.statusCode}`)
  if (second.statusCode !== first.statusCode || second.payload !== first.payload) problems.push(`${name}: the second answer differs (${first.statusCode} ${first.payload}, then ${second.statusCode} ${second.payload})`)
  if (before !== after) problems.push(`${name}: the state moved (${before}, then ${after})`)
  await app.close()
}
if (problems.length) fail(`${element.label}: ${problems.join('; ')}.`)
console.log(`${element.label}: ${probes.map((p) => p.name).join(', ')} changed nothing the second time.`)
