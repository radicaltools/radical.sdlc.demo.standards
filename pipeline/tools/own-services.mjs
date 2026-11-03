#!/usr/bin/env node
// Which services of `docker compose config --format json`, on stdin, to publish: those this
// repository builds, one per image. Another repository's images have no build here.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function ownServices(config) {
  const byImage = new Map()
  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (service.build && !byImage.has(service.image)) byImage.set(service.image, name)
  }
  return [...byImage.values()]
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(ownServices(JSON.parse(readFileSync(0, 'utf8'))).join(' '))
}
