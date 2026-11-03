import { describe, expect, it } from 'vitest'
import { operationsOf, routesOf } from '../openapi.mjs'

describe('openapi sensor', () => {
  it('reads the routes of a Fastify tree', () => {
    const tree = `└── /
    ├── health (GET, HEAD)
    ├── reservations (POST)
    │   └── /
    │       └── :id (GET, HEAD)
    │           └── /
    │               ├── release (POST)
    │               └── dispatch (POST)
    └── stock/
        ├── receipts (POST)
        └── :sku (GET, HEAD)
`
    expect(routesOf(tree).sort()).toEqual([
      'GET /health',
      'GET /reservations/{id}',
      'GET /stock/{sku}',
      'POST /reservations',
      'POST /reservations/{id}/dispatch',
      'POST /reservations/{id}/release',
      'POST /stock/receipts',
    ])
  })
  it('reads the operations of a description', () => {
    expect(operationsOf({ paths: { '/a': { get: {}, post: {}, summary: 'x' }, '/b/{id}': { delete: {} } } })).toEqual(['GET /a', 'POST /a', 'DELETE /b/{id}'])
  })
})
