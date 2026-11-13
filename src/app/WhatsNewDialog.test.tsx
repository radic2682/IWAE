// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseNote } from '../core/releaseNotes'
import { LAST_SEEN_VERSION_KEY, WhatsNewHost } from './WhatsNewDialog'
import { resetStartupDialogs, useStartupDialog } from './startupDialogs'
import { captureInstallSnapshot, readToursSeen, resetTourState } from './tourState'

const notes: readonly ReleaseNote[] = [
  { version: '0.1.19', date: '2026-11-10', body: '## New\n\n- **Nineteen** thing' },
  { version: '0.1.18', date: null, body: '- eighteen thing' },
  { version: '0.1.17', date: null, body: '- seventeen thing' },
]

const stored = () => window.localStorage.getItem(LAST_SEEN_VERSION_KEY)

beforeEach(() => { window.localStorage.clear() })
afterEach(() => {
  cleanup()
  resetStartupDialogs()
  resetTourState()
})

describe('WhatsNewHost', () => {
  it('업데이트한 뒤 처음 시작하면 「새 버전」을 보이고, 확인하면 지금 버전을 기록한다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    expect(screen.getByText('새 버전 v0.1.19')).not.toBeNull()
    expect(screen.getByText('Nineteen')).not.toBeNull()
    // 이전 버전 노트는 없다
    expect(screen.queryByText('eighteen thing')).toBeNull()
    expect(stored()).toBe('0.1.18')
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.19')
  })

  it('처음 설치면 보이지 않고 버전만 기록한다', () => {
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.19')
  })

  it('같은 버전으로 다시 시작하면 보이지 않는다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.19')
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('메인 창이 아니면(enabled=false) 보이지도 기록하지도 않는다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    render(<WhatsNewHost enabled={false} version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.18')
  })

  it('건너뛴 버전은 새 버전 먼저 버전 제목과 함께 쌓아 보인다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.16')
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((element) => element.textContent ?? '')
    expect(headings[0]).toContain('v0.1.19')
    expect(headings.slice(1)).toEqual(['v0.1.18', 'v0.1.17'])
    expect(screen.getByText('eighteen thing')).not.toBeNull()
    expect(screen.getByText('seventeen thing')).not.toBeNull()
  })

  it('지금 버전의 노트가 없으면 보이지 않고 기록만 한다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    render(<WhatsNewHost enabled version="0.1.20" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.20')
  })

  it('「지난 기록 보기」는 지금 버전으로 설정의 기록을 열고 지금 버전을 기록한다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    const onShowHistory = vi.fn()
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={onShowHistory} />)
    fireEvent.click(screen.getByRole('button', { name: '지난 기록 보기' }))
    expect(onShowHistory).toHaveBeenCalledWith('0.1.19')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.19')
  })

  it('Esc 로 닫아도 기록한다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(stored()).toBe('0.1.19')
  })

  it('다른 시작 대화상자와 겹치지 않는다: 새 버전 안내가 먼저, 닫은 뒤에 다음 것', () => {
    function Other({ wanted }: { readonly wanted: boolean }) {
      return useStartupDialog('prefix-keys', wanted) ? <div role="dialog" aria-label="접두키 고르기" /> : null
    }
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    render(<><Other wanted /><WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} /></>)
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: '접두키 고르기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: '접두키 고르기' })).not.toBeNull()
  })
})

describe('새 기능 둘러보기가 있는 업데이트', () => {
  const tourNotes: readonly ReleaseNote[] = [{ version: '0.2.0', date: null, body: '- twenty thing' }, ...notes]
  const upgrade = () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.19')
    captureInstallSnapshot()
  }

  it('확인 단추가 「새 기능 둘러보기」, 보조 단추가 「나중에」가 된다', () => {
    upgrade()
    render(<WhatsNewHost enabled version="0.2.0" notes={tourNotes} onShowHistory={vi.fn()} />)
    expect(screen.getByRole('button', { name: '새 기능 둘러보기' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '나중에' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '확인' })).toBeNull()
    expect(screen.getByRole('button', { name: '지난 기록 보기' })).not.toBeNull()
  })

  it('「나중에」는 버전을 기록하고 둘러보기를 본 것으로 적는다', () => {
    upgrade()
    render(<WhatsNewHost enabled version="0.2.0" notes={tourNotes} onShowHistory={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    expect(stored()).toBe('0.2.0')
    expect(readToursSeen()).toContain('v0.2.0')
  })

  it('둘러보기가 없는 업데이트는 그대로 「확인」 하나다', () => {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, '0.1.18')
    captureInstallSnapshot()
    render(<WhatsNewHost enabled version="0.1.19" notes={notes} onShowHistory={vi.fn()} />)
    expect(screen.getByRole('button', { name: '확인' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '나중에' })).toBeNull()
  })
})
