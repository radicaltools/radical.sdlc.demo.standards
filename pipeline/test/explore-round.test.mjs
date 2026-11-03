import { describe, expect, it } from 'vitest'
import { serveCommands } from '../tools/explore-round.mjs'

describe('the exploratory round', () => {
  it('serves what crucible.json says, on the ports of the run', () => {
    const serve = [
      { cwd: '.', command: ['node', 'serve.mjs', 'stock', '{port}', '{hubPort}', '{otherPort}'], port: 'app' },
      { cwd: '.', command: ['node', 'serve.mjs', 'dispatch', '{port}', '{hubPort}', '{otherPort}'], port: 'hub' },
    ]
    expect(serveCommands(serve, { app: 4501, hub: 4502, other: 4503 })).toEqual([
      { cwd: '.', command: ['node', 'serve.mjs', 'stock', '4501', '4502', '4503'] },
      { cwd: '.', command: ['node', 'serve.mjs', 'dispatch', '4502', '4502', '4503'] },
    ])
  })
})
