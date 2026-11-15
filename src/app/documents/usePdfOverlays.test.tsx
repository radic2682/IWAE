// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { canUndo, clearUndo } from '../undoStack'
import { usePdfOverlays } from './usePdfOverlays'
import type { PdfOverlay } from '../../core/pdfOverlays'

const box = { id: 'o1', kind: 'text', page: 0 } as unknown as PdfOverlay

it('remapPages 는 undoable: false 이면 되돌리기에 남기지 않는다', () => {
  clearUndo()
  const { result } = renderHook(() => usePdfOverlays(null))
  act(() => result.current.add('doc', box))
  clearUndo()
  act(() => result.current.remapPages('doc', new Map([[0, 2]]), { undoable: false }))
  expect(canUndo()).toBe(false)
  act(() => result.current.remapPages('doc', new Map([[2, 1]])))
  expect(canUndo()).toBe(true)
  clearUndo()
})
