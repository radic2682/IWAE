// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type CanvasDocumentV2 } from '../../core/canvasDocument'
import { flushCanvasSaves, StorageConflictError, useCanvasAutosave, type CanvasStorage } from './useCanvasAutosave'

function doc(label: string): CanvasDocumentV2 {
  return { version: 2, nodes: [{ id: 'title', position: { x: 0, y: 0 }, data: { block: { kind: 'title', width: 320, height: 96, style: createDefaultTextBlockStyle('h1'), text: label } } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } as CanvasDocumentV2
}

describe('failed unmount canvas saves', () => {
  it('a canvas deleted after a failed unmount save is not written back by the next flush', async () => {
    const disk = new Map<string, string>([['Notes/board.iwcanvas', JSON.stringify(doc('original'))]])
    let failing = true
    const storage: CanvasStorage = {
      load: vi.fn(async (id) => { const text = disk.get(id); return text === undefined ? null : JSON.parse(text) }),
      save: vi.fn(async (id, d) => { if (failing) throw new Error('EBUSY: locked'); disk.set(id, JSON.stringify(d)) }),
    }
    const view = renderHook(() => useCanvasAutosave({ noteId: 'Notes/board.iwcanvas', fallbackDocument: doc('fb'), storage, delay: 500 }))
    await waitFor(() => expect(view.result.current.status).toBe('saved'))
    act(() => view.result.current.setDocument(doc('edit')))
    view.unmount()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    // 사용자가 왼쪽 바에서 이 캔버스 노트를 지웠다(휴지통). 잠김도 풀렸다
    disk.delete('Notes/board.iwcanvas')
    failing = false
    await flushCanvasSaves()
    expect(disk.has('Notes/board.iwcanvas')).toBe(false)
  })

  it('a conflict on unmount keeps both versions: the disk copy stays and mine goes to a conflict copy', async () => {
    const disk = new Map<string, string>([['Notes/c.iwcanvas', JSON.stringify(doc('original'))]])
    let conflict = true
    const storage: CanvasStorage = {
      load: vi.fn(async (id) => { const text = disk.get(id); return text === undefined ? null : JSON.parse(text) }),
      save: vi.fn(async (id, d) => { if (conflict) throw new StorageConflictError('changed outside'); disk.set(id, JSON.stringify(d)) }),
    }
    const first = renderHook(() => useCanvasAutosave({ noteId: 'Notes/c.iwcanvas', fallbackDocument: doc('fb'), storage, delay: 20 }))
    await waitFor(() => expect(first.result.current.status).toBe('saved'))
    act(() => first.result.current.setDocument(doc('mine')))
    first.unmount()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    // 다른 창(또는 동기화)이 바꾼 내용이 디스크에 있다. 이 창이 그 내용을 다시 읽고 나면 충돌이 아니다
    disk.set('Notes/c.iwcanvas', JSON.stringify(doc('theirs')))
    conflict = false
    const second = renderHook(() => useCanvasAutosave({ noteId: 'Notes/c.iwcanvas', fallbackDocument: doc('fb'), storage, delay: 20 }))
    await waitFor(() => expect(second.result.current.status).toBe('saved'))
    expect(disk.get('Notes/c.iwcanvas')).toContain('theirs')
    await waitFor(() => expect([...disk.entries()].some(([id, text]) => id !== 'Notes/c.iwcanvas' && text.includes('mine'))).toBe(true))
  })
})

describe('flushCanvasSaves for a single other canvas', () => {
  it('does not commit the memo editor being typed in', async () => {
    const { registerEditorFlusher } = await import('../editorFlush')
    const flush = vi.fn()
    const off = registerEditorFlusher(flush)
    await flushCanvasSaves('Notes/other.iwcanvas', { editors: false })
    expect(flush).not.toHaveBeenCalled()
    await flushCanvasSaves()
    expect(flush).toHaveBeenCalledTimes(1)
    off()
  })
})
