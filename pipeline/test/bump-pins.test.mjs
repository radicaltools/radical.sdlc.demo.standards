import { describe, expect, it } from 'vitest'
import { bumpedDeps, bumpedWorkflow } from '../tools/bump-pins.mjs'

const deps = JSON.stringify({ name: 'shop', dependencies: [{ name: 'standards', repo: 'r', path: 'p', ref: 'v1.0.0' }, { name: 'warehouse', repo: 'w', path: 'p', ref: 'v1.0.0' }] })

describe('pins of a release', () => {
  it('moves only the dependency released', () => {
    const moved = JSON.parse(bumpedDeps(deps, 'warehouse', 'v1.1.0'))
    expect(moved.dependencies.map((d) => d.ref)).toEqual(['v1.0.0', 'v1.1.0'])
  })
  it('changes nothing for a repository at that version already, or not pinning it', () => {
    expect(bumpedDeps(deps, 'warehouse', 'v1.0.0')).toBeNull()
    expect(bumpedDeps(deps, 'other', 'v2.0.0')).toBeNull()
  })
  it('moves the calls of the workflows into that repository only', () => {
    const text = 'uses: org/x.standards/.github/workflows/gate.yml@v1.0.0\nuses: actions/checkout@v4\nuses: org/xxstandards/.github/workflows/gate.yml@v1.0.0\n'
    expect(bumpedWorkflow(text, 'org/x.standards', 'v1.1.0')).toBe('uses: org/x.standards/.github/workflows/gate.yml@v1.1.0\nuses: actions/checkout@v4\nuses: org/xxstandards/.github/workflows/gate.yml@v1.0.0\n')
  })
})
