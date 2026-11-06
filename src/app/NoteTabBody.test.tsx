// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteTabBody } from './NoteTabBody'

describe('NoteTabBody', () => {
  it('Markdown 원문이 있는 탭은 캔버스 대신 읽기 전용 문서로 렌더한다', () => {
    const renderCanvas = vi.fn(() => <div>canvas</div>)

    render(
      <NoteTabBody
        id="Notes/README.md"
        title="README"
        markdownSources={{ 'Notes/README.md': '# Read only' }}
        renderCanvas={renderCanvas}
      />,
    )

    expect(screen.getByRole('article', { name: 'README' }).innerHTML).toContain('Read only')
    expect(renderCanvas).not.toHaveBeenCalled()
  })

  it('Markdown 원문이 없는 일반 노트는 기존 캔버스를 렌더한다', () => {
    const renderCanvas = vi.fn(() => <div>canvas</div>)

    render(
      <NoteTabBody
        id="Notes/design.canvas"
        title="Design"
        markdownSources={{}}
        renderCanvas={renderCanvas}
      />,
    )

    expect(screen.getByText('canvas')).toBeDefined()
    expect(renderCanvas).toHaveBeenCalledOnce()
  })
})
