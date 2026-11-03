import { describe, expect, it } from 'vitest'
import { bumpedDeps, bumpedWorkflow, newestVersion, pullRequestText, slugOf, tagsIn } from '../tools/update-pins.mjs'

describe('new versions of what a repository depends on', () => {
  it('finds the newest version above the pin, by number and not by text', () => {
    expect(newestVersion('v1.2.0', ['v1.0.0', 'v1.2.0', 'v1.10.0', 'v1.9.0'])).toBe('v1.10.0')
  })
  it('finds nothing when the pin is the newest', () => {
    expect(newestVersion('v1.10.0', ['v1.0.0', 'v1.9.0', 'v1.10.0'])).toBeNull()
  })
  it('leaves a pin that is no version alone', () => {
    expect(newestVersion('main', ['v1.0.0'])).toBeNull()
    expect(newestVersion('latest', ['v1.0.0'])).toBeNull()
  })
  it('ignores tags that are no versions, pre-releases too', () => {
    expect(newestVersion('v1.0.0', ['nightly', 'v2.0.0-rc.1', 'v1.0.1'])).toBe('v1.0.1')
  })
  it('reads the tags of git ls-remote', () => {
    expect(tagsIn('abc\trefs/tags/v1.0.0\ndef\trefs/tags/v1.0.1\n')).toEqual(['v1.0.0', 'v1.0.1'])
  })
  it('moves only the dependency with the new version', () => {
    const deps = JSON.stringify({ name: 'shop', dependencies: [{ name: 'standards', ref: 'v1.0.0' }, { name: 'warehouse', ref: 'v1.0.0' }] })
    expect(JSON.parse(bumpedDeps(deps, 'warehouse', 'v1.1.0')).dependencies.map((d) => d.ref)).toEqual(['v1.0.0', 'v1.1.0'])
  })
  it('knows a repository on GitHub, however it is written', () => {
    expect(slugOf('https://github.com/org/x.standards.git')).toBe('org/x.standards')
    expect(slugOf('git@github.com:org/x.standards.git')).toBe('org/x.standards')
    expect(slugOf('../../../standards')).toBeNull()
  })
  it('moves the calls of the workflows into that repository only', () => {
    const text = 'uses: org/x.standards/.github/workflows/gate.yml@v1.0.0\nuses: actions/checkout@v4\nuses: org/xxstandards/.github/workflows/gate.yml@v1.0.0\n'
    expect(bumpedWorkflow(text, 'org/x.standards', 'v1.1.0')).toBe('uses: org/x.standards/.github/workflows/gate.yml@v1.1.0\nuses: actions/checkout@v4\nuses: org/xxstandards/.github/workflows/gate.yml@v1.0.0\n')
  })
  it('says what changed in the dependency, and that a green Gate does not read it', () => {
    const text = pullRequestText({ name: 'standards', from: 'v1.0.0', to: 'v1.1.0', changes: 'ADR "X": decision changed\n', pipeline: true })
    expect(text).toContain('v1.0.0 to v1.1.0')
    expect(text).toContain('ADR "X": decision changed')
    expect(text).toContain('the pipeline at that version')
    expect(text).toContain('green Gate')
  })
})
