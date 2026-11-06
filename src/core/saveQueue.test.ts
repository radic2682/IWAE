import { describe, expect, it, vi } from 'vitest'
import { SaveQueue } from './saveQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SaveQueue', () => {
  it('coalesces pending operations and persists only the newest one after the active write', async () => {
    const queue = new SaveQueue()
    const first = deferred()
    const writes: string[] = []
    void queue.enqueue('a', async () => {
      writes.push('first')
      await first.promise
    })
    void queue.enqueue('a', async () => { writes.push('middle') })
    void queue.enqueue('a', async () => { writes.push('latest') })

    expect(writes).toEqual(['first'])
    first.resolve()
    await queue.flush('a')

    expect(writes).toEqual(['first', 'latest'])
    expect(queue.hasPending('a')).toBe(false)
  })

  it('runs different files independently', async () => {
    const queue = new SaveQueue()
    const blocked = deferred()
    const other = vi.fn()
    void queue.enqueue('a', () => blocked.promise)
    void queue.enqueue('b', async () => { other() })

    await queue.flush('b')

    expect(other).toHaveBeenCalledOnce()
    expect(queue.hasPending('a')).toBe(true)
    blocked.resolve()
    await queue.flush()
  })

  it('flush rejects with the final pending write error', async () => {
    const queue = new SaveQueue()
    void queue.enqueue('a', async () => { throw new Error('disk full') })

    await expect(queue.flush('a')).rejects.toThrow('disk full')
  })
})
