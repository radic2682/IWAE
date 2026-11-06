// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.resetModules()
})

describe('ai bridge', () => {
  it('does nothing outside the desktop app', async () => {
    const { aiSetVault, ragIndex, ragStatus, ragSearch } = await import('./ai')
    await expect(aiSetVault('C:/Vault')).resolves.toBeUndefined()
    await expect(ragIndex()).resolves.toBeUndefined()
    await expect(ragStatus()).resolves.toBeNull()
    await expect(ragSearch('x')).resolves.toEqual([])
  })

  it('calls the Rust commands on the desktop', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue([])
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const { aiSetVault, ragIndex, ragSearch, aiEmbeddingConfigure } = await import('./ai')
    await aiSetVault('C:/Vault')
    await aiSetVault(null)
    await ragIndex()
    await ragSearch('버스', 5, 'pdf')
    await aiEmbeddingConfigure({ enabled: true, endpoint: 'http://127.0.0.1:11434', model: 'bge-m3' })
    expect(invoke).toHaveBeenCalledWith('ai_set_vault', { root: 'C:/Vault' })
    expect(invoke).toHaveBeenCalledWith('ai_set_vault', { root: null })
    expect(invoke).toHaveBeenCalledWith('rag_index')
    expect(invoke).toHaveBeenCalledWith('rag_search', { query: '버스', limit: 5, kind: 'pdf' })
    expect(invoke).toHaveBeenCalledWith('ai_embedding_configure', { embedding: { enabled: true, endpoint: 'http://127.0.0.1:11434', model: 'bge-m3' } })
  })

  it('listens to index progress and AI locations through Tauri events', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const unlisten = vi.fn()
    const listen = vi.fn().mockResolvedValue(unlisten)
    vi.doMock('@tauri-apps/api/event', () => ({ listen }))
    const { listenAiLocation, listenRagProgress } = await import('./ai')
    const onLocation = vi.fn()
    const stop = await listenAiLocation(onLocation)
    await listenRagProgress(vi.fn())
    expect(listen).toHaveBeenCalledWith('ai-location', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('rag-progress', expect.any(Function))
    const handler = listen.mock.calls[0]![1] as (event: { payload: unknown }) => void
    handler({ payload: { id: '1', docId: 'd', page: 2, receivedAt: 'x' } })
    expect(onLocation).toHaveBeenCalledWith({ id: '1', docId: 'd', page: 2, receivedAt: 'x' })
    stop()
    expect(unlisten).toHaveBeenCalled()
  })
})
