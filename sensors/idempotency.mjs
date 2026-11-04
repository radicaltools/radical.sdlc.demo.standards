#!/usr/bin/env node
// Sensor idempotency, for the fitness function Repeated write changes nothing (ADR
// Retried writes change nothing): each write that test/idempotency.probe.ts of the
// element's service names is sent twice, one after the other, and then twice at the
// same time on a fresh start. The two answers have to be equal, and what the probe
// reads as its state has to be what one write leaves. Runs with tsx.
//
// A probe is { name, prepare(): { app, request, state() } }, with `request` for
// Fastify's inject, `state` async and answering with anything JSON can hold.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fail, measuredElement, sensorContext } from './context.mjs'

/** What each probe's writes break, as sentences. */
export async function problemsOf(probes) {
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

    const together = await prepare()
    const [one, other] = await Promise.all([together.app.inject(together.request), together.app.inject(together.request)])
    const left = JSON.stringify(await together.state())
    if (one.statusCode !== other.statusCode || one.payload !== other.payload) problems.push(`${name}: sent at the same time, the answers differ (${one.statusCode} ${one.payload}, and ${other.statusCode} ${other.payload})`)
    if (left !== before) problems.push(`${name}: sent at the same time, the state is not what one write leaves (${before}, but ${left})`)
    await together.app.close()
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const element = measuredElement(sensorContext())
  const file = join(resolve(process.cwd(), element.paths[0]), 'test/idempotency.probe.ts')
  if (!existsSync(file)) fail(`${element.label} has no ${join(element.paths[0], 'test/idempotency.probe.ts')}.`)
  const { probes } = await import(pathToFileURL(file).href)
  if (!probes?.length) fail(`${element.label}: its probe file names no write.`)
  const problems = await problemsOf(probes)
  if (problems.length) fail(`${element.label}: ${problems.join('; ')}.`)
  console.log(`${element.label}: ${probes.map((p) => p.name).join(', ')} changed nothing the second time, after the first or beside it.`)
}
