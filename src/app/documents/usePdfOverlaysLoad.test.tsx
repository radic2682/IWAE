// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfOverlay } from '../../core/pdfOverlays'

const bridge = vi.hoisted(() => {
  class VaultFileCorruptError extends Error {}
  return {
    VaultFileCorruptError,
    readPdfOverlays: vi.fn(),
    writePdfOverlays: vi.fn(async () => undefined),
    subscribeVaultFile: vi.fn(() => () => undefined),
    quarantineVaultMetaFile: vi.fn(),
    pdfOverlaysCodec: {},
  }
})
vi.mock('../../bridge/vault', () => bridge)

import { usePdfOverlays } from './usePdfOverlays'

const vault = { root: 'C:/v' }
const existing = { id: 'old', kind: 'text', page: 0 } as unknown as PdfOverlay
const fresh = { id: 'new', kind: 'text', page: 1 } as unknown as PdfOverlay

describe('usePdfOverlays first load', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

  it('does not write before the first read and merges edits made meanwhile when it succeeds', async () => {
    let finish: (file: unknown) => void = () => undefined
    bridge.readPdfOverlays.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(() => usePdfOverlays(vault))
    act(() => result.current.add('doc', fresh))
    expect(bridge.writePdfOverlays).not.toHaveBeenCalled()
    await act(async () => { finish({ version: 1, overlays: { doc: [existing] } }) })
    expect(bridge.writePdfOverlays).toHaveBeenCalledTimes(1)
    const written = (bridge.writePdfOverlays.mock.calls[0] as unknown as [unknown, { overlays: Record<string, { id: string }[]> }])[1]
    expect(written.overlays.doc?.map((overlay) => overlay.id).sort()).toEqual(['new', 'old'])
    expect(result.current.overlays.doc?.map((overlay) => overlay.id).sort()).toEqual(['new', 'old'])
  })

  it('retries a locked file and then loads it', async () => {
    vi.useFakeTimers()
    bridge.readPdfOverlays
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce({ version: 1, overlays: { doc: [existing] } })
    const { result } = renderHook(() => usePdfOverlays(vault))
    act(() => result.current.add('doc', fresh))
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(bridge.readPdfOverlays).toHaveBeenCalledTimes(3)
    expect(result.current.overlays.doc?.map((overlay) => overlay.id).sort()).toEqual(['new', 'old'])
    expect(bridge.writePdfOverlays).toHaveBeenCalledTimes(1)
  })
})
