// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PdfBoxMemos } from './PdfBoxMemos'
import type { MemoContent } from './MemoEditor'
import type { PersistentPdfHighlight } from './persistentHighlight'

const base: PersistentPdfHighlight = {
  id: 'draft1', color: 'green', box: { x: 400, y: 100, w: 170 },
  anchor: { docId: 'abc123abc123', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 72, y: 110, w: 200, h: 12 }], charRange: [0, 5], quote: 'quote', prefix: '', suffix: '' },
}
const existing: PersistentPdfHighlight = { ...base, id: 'h-old', note: 'old note' }

// PdfPane.tsx 의 draftBox / saveBoxMemo / onCancelDraft / onDelete 를 그대로 옮긴 틀
function Harness({ created, removed, updated, withOther }: { created: (h: PersistentPdfHighlight) => void; removed: (id: string) => void; updated: (id: string, p: unknown) => void; withOther: boolean }) {
  const [draftBox, setDraftBox] = useState<PersistentPdfHighlight | null>(base)
  const [saved, setSaved] = useState<PersistentPdfHighlight[]>(withOther ? [existing] : [])
  const [editingBoxId, setEditingBoxId] = useState<string | null>(withOther ? 'h-old' : 'draft1')
  const saveBoxMemo = (id: string, content: MemoContent) => {
    if (draftBox !== null && id === draftBox.id) {
      const draft = draftBox
      setDraftBox(null)
      if (content.text.trim() === '') return
      created({ ...draft, note: content.text })
      return
    }
    updated(id, { note: content.text })
  }
  const boxMemos = [...saved, ...(draftBox === null || withOther ? [] : [draftBox])]
  if (boxMemos.length === 0) return null
  return (
    <PdfBoxMemos
      memos={boxMemos}
      draftId={withOther ? null : draftBox?.id ?? null}
      editingId={editingBoxId}
      pageSizes={[[612, 792]]}
      layoutOf={() => ({ top: 0, left: 0, width: 612 })}
      width={612}
      height={792}
      onEdit={setEditingBoxId}
      onSave={saveBoxMemo}
      onCancelDraft={() => { setDraftBox(null); setEditingBoxId(null) }}
      onChange={vi.fn()}
      onDelete={(id) => { removed(id); setSaved((list) => list.filter((h) => h.id !== id)) }}
    />
  )
}

describe('box memo trash while typing', () => {
  it('trashing a draft box that has typed text does not create it', async () => {
    const created = vi.fn(); const removed = vi.fn(); const updated = vi.fn()
    const { container } = render(<Harness created={created} removed={removed} updated={updated} withOther={false} />)
    const editor = container.querySelector('.pdf-memo-editor') as HTMLElement
    editor.textContent = 'typed then discarded'
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '박스 메모 지우기' }))
    expect(created).not.toHaveBeenCalled()
  })
  it('trashing an existing box while typing removes it without a later update', async () => {
    const created = vi.fn(); const removed = vi.fn(); const updated = vi.fn()
    const { container } = render(<Harness created={created} removed={removed} updated={updated} withOther />)
    const editor = container.querySelector('.pdf-memo-editor') as HTMLElement
    editor.textContent = 'edited'
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '박스 메모 지우기' }))
    expect(removed).toHaveBeenCalledWith('h-old')
    expect(updated).not.toHaveBeenCalled()
  })
})
