// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installUnloadCleanup } from './unloadCleanup'

const ipc = (cmd: string) => `http://ipc.localhost/${encodeURIComponent(cmd)}`
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('installUnloadCleanup', () => {
  const realFetch = window.fetch
  afterEach(() => {
    window.fetch = realFetch
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('releases watchers and listeners that are still open on pagehide', async () => {
    let next = 10
    window.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      return new Response(JSON.stringify(url.includes('listen') || url.includes('watch') ? next++ : null))
    }) as typeof fetch
    const released: string[] = []
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => { released.push(`${cmd}:${JSON.stringify(args)}`) },
    }
    const uninstall = installUnloadCleanup()
    const call = async (cmd: string, body: unknown) => (await window.fetch(ipc(cmd), { method: 'POST', body: JSON.stringify(body) })).json() as Promise<number>
    const w1 = await call('plugin:fs|watch', {})
    const w2 = await call('plugin:fs|watch', {})
    const l1 = await call('plugin:event|listen', { event: 'a' })
    const l2 = await call('plugin:event|listen', { event: 'b' })
    await flush()
    await call('plugin:resources|close', { rid: w1 })
    await call('plugin:event|unlisten', { event: 'a', eventId: l1 })
    window.dispatchEvent(new Event('pagehide'))
    expect([...released].sort()).toEqual([
      `plugin:event|unlisten:${JSON.stringify({ event: 'b', eventId: l2 })}`,
      `plugin:resources|close:${JSON.stringify({ rid: w2 })}`,
    ].sort())
    uninstall()
  })

  it('does nothing outside Tauri', () => {
    expect(() => installUnloadCleanup()()).not.toThrow()
  })
})
