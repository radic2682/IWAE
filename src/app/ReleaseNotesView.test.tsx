// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseNote } from '../core/releaseNotes'

const opened = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('../bridge/external', () => ({
  openExternalUrl: (url: string) => { opened.urls.push(url); return Promise.resolve() },
}))

import { ReleaseHistory } from './ReleaseNotesView'

const notes: readonly ReleaseNote[] = [
  { version: '0.1.19', date: '2026-11-10', body: 'Body **nineteen** [link](https://example.com/x)' },
  { version: '0.1.18', date: null, body: 'Body eighteen' },
]

afterEach(cleanup)

describe('ReleaseHistory', () => {
  it('모든 버전을 새 버전 먼저 보이고, 지금 버전을 표시하고, 날짜는 있을 때만 보인다', () => {
    render(<ReleaseHistory currentVersion="0.1.19" notes={notes} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('v0.1.19')
    expect(rows[0]?.textContent).toContain('지금 버전')
    expect(rows[0]?.querySelector('time')).not.toBeNull()
    expect(rows[1]?.textContent).toContain('v0.1.18')
    expect(rows[1]?.textContent).not.toContain('지금 버전')
    expect(rows[1]?.querySelector('time')).toBeNull()
  })

  it('처음엔 접혀 있고, 누르면 그 버전의 노트가 펼쳐진다', () => {
    render(<ReleaseHistory currentVersion="0.1.19" notes={notes} />)
    expect(screen.queryByText('nineteen')).toBeNull()
    const toggle = screen.getByRole('button', { name: /v0\.1\.19/u })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('nineteen')).not.toBeNull()
    fireEvent.click(toggle)
    expect(screen.queryByText('nineteen')).toBeNull()
  })

  it('focusVersion 으로 열면 그 버전만 펼쳐져 있고 그 자리로 스크롤한다', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<ReleaseHistory currentVersion="0.1.19" focusVersion="0.1.19" notes={notes} />)
    expect(screen.getByText('nineteen')).not.toBeNull()
    expect(screen.queryByText('Body eighteen')).toBeNull()
    expect(scroll).toHaveBeenCalled()
  })

  it('노트 안의 링크는 기본 브라우저로 연다', () => {
    render(<ReleaseHistory currentVersion="0.1.19" focusVersion="0.1.19" notes={notes} />)
    fireEvent.click(screen.getByRole('link', { name: 'link' }))
    expect(opened.urls).toEqual(['https://example.com/x'])
  })

  it('묶인 노트가 없으면 안내만 보인다', () => {
    render(<ReleaseHistory currentVersion="0.1.19" notes={[]} />)
    expect(screen.getByText('묶인 업데이트 기록이 없습니다.')).not.toBeNull()
  })
})
