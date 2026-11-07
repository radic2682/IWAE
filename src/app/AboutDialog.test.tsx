// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const opened = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('../bridge/external', () => ({
  openExternalUrl: (url: string) => {
    opened.urls.push(url)
    return Promise.resolve()
  },
}))

import { AboutDialog, IWAE_REPOSITORY_URL } from './AboutDialog'

describe('AboutDialog', () => {
  it('버전과 개발 정보를 보이고, 소스 주소를 바깥 브라우저로 연다', () => {
    render(<AboutDialog version="1.2.3" onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'IWAE 정보' })
    expect(dialog.textContent).toContain('버전 1.2.3')
    expect(dialog.textContent).toContain('radic2682')
    expect(dialog.textContent).toContain('MIT')
    // 조립 애니메이션의 두 조각과 마지막에 덮는 원본 로고
    expect(dialog.querySelectorAll('.about-logo img')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'github.com/radic2682/IWAE' }))
    expect(opened.urls).toEqual([IWAE_REPOSITORY_URL])
  })

  it('Escape·닫기 단추·바깥 누르기로 닫힌다', () => {
    const onClose = vi.fn()
    render(<AboutDialog version="1.0.0" onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'IWAE 정보' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
