import { describe, expect, it } from 'vitest'
import { areasOf } from '../tools/model-areas.mjs'
import { ownServices } from '../tools/own-services.mjs'

const nodes = [
  { id: 'sys', type: 'system', label: 'Warehouse' },
  { id: 'stock', type: 'container', label: 'Stock service', parentId: 'sys' },
  { id: 'ledger', type: 'component', label: 'Stock ledger', parentId: 'stock' },
  { id: 'types', type: 'container', label: 'Contracts', parentId: 'sys' },
  { id: 'r1', type: 'requirement', label: 'Reserve stock' },
  { id: 'r2', type: 'requirement', label: 'Show availability' },
]
const implemented = [{ element: 'sys' }, { element: 'stock' }, { element: 'types' }]

describe('the areas of a round', () => {
  it('names each part with the requirements of what is inside it', () => {
    const satisfies = [{ sourceId: 'ledger', targetId: 'r2' }, { sourceId: 'stock', targetId: 'r1' }]
    expect(areasOf(implemented, nodes, satisfies)).toEqual(['Stock service: Reserve stock, Show availability'])
  })
  it('leaves out a part with no requirements, and the whole system', () => {
    expect(areasOf(implemented, nodes, [{ sourceId: 'sys', targetId: 'r1' }])).toEqual([])
  })
  it('counts nothing for another model\'s elements', () => {
    const others = [...nodes, { id: 'other', type: 'container', label: 'Elsewhere' }]
    expect(areasOf(implemented, others, [{ sourceId: 'other', targetId: 'r1' }])).toEqual([])
  })
  it('keeps the separator of radical explore out of a name', () => {
    const named = [...nodes, { id: 'r3', type: 'requirement', label: 'One; two' }]
    expect(areasOf(implemented, named, [{ sourceId: 'stock', targetId: 'r3' }])).toEqual(['Stock service: One, two'])
  })
})

describe('what a deploy publishes', () => {
  it('is what the repository builds, once per image', () => {
    expect(ownServices({ services: {
      stock: { image: 'w/stock:1', build: { context: '.' } },
      carrier: { image: 'w/dispatch:1', build: { context: '.' } },
      dispatch: { image: 'w/dispatch:1', build: { context: '.' } },
      other: { image: 'x/other:1' },
    } })).toEqual(['stock', 'carrier'])
  })
})
