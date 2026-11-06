// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle } from '../core/canvasDocument'
import { useBlockPresets, type BlockPresetStorage } from './useBlockPresets'

describe('useBlockPresets', () => {
  it('Vault 프리셋을 불러오고 새 프리셋을 즉시 저장한다', async () => {
    const storage: BlockPresetStorage = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useBlockPresets(storage, () => 'preset-1'))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.add({
      kind: 'rectangle',
      width: 260,
      height: 120,
      style: { ...createDefaultTextBlockStyle(), background: 'transparent', borderColor: '#ef4444' },
    }))

    expect(result.current.presets).toHaveLength(1)
    await waitFor(() => expect(storage.save).toHaveBeenCalledWith(result.current.presets))
  })
})
