#!/usr/bin/env node
// The areas of an exploratory round, from the model: one for each part the repository builds
// that has requirements, named with the requirements to try to break. Run from a repository,
// it prints them, so a new service gets its agent with nothing to configure.
//
// It reads the model through the MCP server, as the agents do.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The areas, from `implements` of .radical/radical.json, the model's `nodes` and its
 *  `satisfies` relations. A requirement counts for the nearest element the repository maps,
 *  going up from the element that satisfies it. A whole system is no area: its parts are. */
export function areasOf(implemented, nodes, satisfies) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const parts = new Map(implemented.filter((e) => byId.has(e.element) && byId.get(e.element).type !== 'system').map((e) => [e.element, []]))
  for (const { sourceId, targetId } of satisfies) {
    let id = sourceId
    while (id && !parts.has(id)) id = byId.get(id)?.parentId
    if (id && byId.has(targetId)) parts.get(id).push(byId.get(targetId).label)
  }
  return [...parts].filter(([, requirements]) => requirements.length).map(([id, requirements]) =>
    // radical explore splits its areas at a semicolon.
    `${byId.get(id).label}: ${[...new Set(requirements)].sort().join(', ')}`.replaceAll(';', ','))
}

/** Answers `queries` of search_model from the model's MCP server, each as its rows. */
async function searchModel(queries) {
  const server = spawn('node', ['node_modules/@radicaltools/mcp/dist/index.js', '--folder', '.radical/model'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let buffer = ''
  let next = 1
  server.stdout.on('data', (chunk) => {
    buffer += chunk
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (!line.trim()) continue
      const message = JSON.parse(line)
      waiting.get(message.id)?.(message)
    }
  })
  const call = (method, params) => new Promise((resolve) => {
    const id = next++
    waiting.set(id, resolve)
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'model-areas', version: '1' } })
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const rows = []
    for (const query of queries) {
      const { result } = await call('tools/call', { name: 'search_model', arguments: { query } })
      if (result?.isError) throw new Error(`${query}: ${result.content.map((c) => c.text).join(' ')}`)
      rows.push(JSON.parse(result.content.map((c) => c.text).join('')).rows)
    }
    return rows
  } finally {
    server.kill()
  }
}

/** The areas of the repository in the working directory. */
export async function modelAreas() {
  const { implements: implemented = [] } = JSON.parse(readFileSync('.radical/radical.json', 'utf8'))
  const [nodes, satisfies] = await searchModel(['LIST NODES', 'LIST RELATIONS WHERE relationType = "satisfies"'])
  return areasOf(implemented, nodes, satisfies)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const area of await modelAreas()) console.log(area)
}
