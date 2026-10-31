import type { ComponentType } from 'react'

export function lazyRoute<M extends Record<K, ComponentType>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
) {
  return async () => ({ Component: (await load())[name] })
}
