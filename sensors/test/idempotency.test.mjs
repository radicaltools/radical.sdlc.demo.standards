import { describe, expect, it } from 'vitest'
import { problemsOf } from '../idempotency.mjs'

/** A write that books once per key. With `checkFirst`, it reads what it knows before an
 *  await and writes after it, so two calls in flight both book. */
function probe({ checkFirst }) {
  return {
    name: 'POST /write',
    async prepare() {
      let booked = 0
      let answer
      const inject = async () => {
        if (checkFirst) {
          if (answer === undefined) { await null; answer = undefined; const mine = ++booked; answer = mine; return { statusCode: 201, payload: `T-${mine}` } }
          return { statusCode: 201, payload: `T-${answer}` }
        }
        answer ??= ++booked
        await null
        return { statusCode: 201, payload: `T-${answer}` }
      }
      return { app: { inject, close: async () => {} }, request: {}, state: async () => ({ booked }) }
    },
  }
}

describe('idempotency sensor', () => {
  it('passes a write that books once, one after the other and at the same time', async () => {
    expect(await problemsOf([probe({ checkFirst: false })])).toEqual([])
  })
  it('names a write that books twice when sent at the same time', async () => {
    const problems = await problemsOf([probe({ checkFirst: true })])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('sent at the same time, the answers differ')
    expect(problems[1]).toContain('the state is not what one write leaves')
  })
  it('names a write that books again when repeated', async () => {
    const again = { name: 'POST /write', async prepare() {
      let booked = 0
      return { app: { inject: async () => ({ statusCode: 201, payload: `T-${++booked}` }), close: async () => {} }, request: {}, state: async () => ({ booked }) }
    } }
    expect((await problemsOf([again])).join()).toContain('the second answer differs')
  })
})
