import assert from 'node:assert/strict'
import test from 'node:test'
import { createBlockRegistry } from './Registry.ts'
import type { BlockRenderer } from './Registry.ts'

const stubRenderer: BlockRenderer = () => null

test('createBlockRegistry resolves a renderer registered for a kind', () => {
  const registry = createBlockRegistry()
  registry.register('rich_text', stubRenderer)
  assert.equal(registry.resolve('rich_text'), stubRenderer)
})

test('createBlockRegistry resolves to undefined for unregistered kinds', () => {
  const registry = createBlockRegistry()
  assert.equal(registry.resolve('rich_text'), undefined)
})

test('createBlockRegistry isolates state between instances', () => {
  const a = createBlockRegistry()
  const b = createBlockRegistry()
  a.register('rich_text', stubRenderer)
  assert.equal(a.resolve('rich_text'), stubRenderer)
  assert.equal(b.resolve('rich_text'), undefined)
})

test('register overwrites a prior renderer for the same kind', () => {
  const registry = createBlockRegistry()
  const first: BlockRenderer = () => null
  const second: BlockRenderer = () => null
  registry.register('rich_text', first)
  registry.register('rich_text', second)
  assert.equal(registry.resolve('rich_text'), second)
})

test('kinds() returns every kind that has been registered', () => {
  const registry = createBlockRegistry()
  registry.register('rich_text', stubRenderer)
  registry.register('section', stubRenderer)
  assert.deepEqual(registry.kinds().slice().sort(), ['rich_text', 'section'])
})
