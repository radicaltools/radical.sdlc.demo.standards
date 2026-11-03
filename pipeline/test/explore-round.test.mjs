import { describe, expect, it } from 'vitest'
import { areaLine, serveCommands } from '../tools/explore-round.mjs'

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
  it('does not call an area with no script checked', () => {
    const { checked, line } = areaLine({ area: 'Orders service', scripts: 0, kept: [], dropped: 0, refused: 4 })
    expect(checked).toBe(false)
    expect(line).toBe('- **Orders service**: NOT CHECKED. The agent left no script, and 4 of its calls were refused.')
  })
  it('says what held up in an area it checked, and what did not', () => {
    expect(areaLine({ area: 'A', scripts: 2, kept: ['Bug'], dropped: 1, refused: 0 })).toEqual({ checked: true, line: '- **A**: Bug (1 did not hold up).' })
    expect(areaLine({ area: 'A', scripts: 1, kept: [], dropped: 0, refused: 0 }).line).toBe('- **A**: nothing that held up when run again.')
  })
})
