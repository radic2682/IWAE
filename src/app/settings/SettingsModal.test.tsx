// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { setLocale } from '../../i18n'

function DraftField() {
  const [value, setValue] = useState('draft')
  return <input aria-label="임시 설정" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
}

describe('SettingsModal', () => {
  it('설정 영역을 왼쪽 탐색과 선택된 상세 화면으로 분리한다', () => {
    render(
      <SettingsModal
        open
        onClose={vi.fn()}
        sections={[
          { id: 'general', label: '일반', content: <p>일반 설정 내용</p> },
          { id: 'updates', label: '업데이트', content: <p>업데이트 설정 내용</p> },
        ]}
      />,
    )

    expect(screen.getByRole('navigation', { name: '설정 항목' })).not.toBeNull()
    expect(screen.getByText('일반 설정 내용')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '업데이트' }))
    expect(screen.getByText('업데이트 설정 내용')).not.toBeNull()
    expect(screen.queryByText('일반 설정 내용')).toBeNull()
  })

  it('먼저 보일 항목을 정해 열 수 있다(복구할 것이 있을 때 데이터 항목)', () => {
    render(
      <SettingsModal
        open
        initialSectionId="data"
        onClose={vi.fn()}
        sections={[
          { id: 'general', label: '일반', content: <p>일반 설정 내용</p> },
          { id: 'data', label: '데이터 및 복구', content: <p>복구 기록</p> },
        ]}
      />,
    )
    expect(screen.getByText('복구 기록')).not.toBeNull()
    expect(screen.queryByText('일반 설정 내용')).toBeNull()
  })

  it('닫았다 다시 열면 내부 임시 상태를 초기화한다', () => {
    const view = render(<SettingsModal open onClose={vi.fn()}><DraftField /></SettingsModal>)
    fireEvent.change(screen.getByRole('textbox', { name: '임시 설정' }), { target: { value: 'changed' } })
    expect((screen.getByRole('textbox', { name: '임시 설정' }) as HTMLInputElement).value).toBe('changed')

    view.rerender(<SettingsModal open={false} onClose={vi.fn()}><DraftField /></SettingsModal>)
    view.rerender(<SettingsModal open onClose={vi.fn()}><DraftField /></SettingsModal>)
    expect((screen.getByRole('textbox', { name: '임시 설정' }) as HTMLInputElement).value).toBe('draft')
  })

  it('닫히면 열기 전 포커스로 돌아간다', () => {
    const trigger = document.createElement('button')
    trigger.textContent = '설정 열기'
    document.body.append(trigger)
    trigger.focus()

    const view = render(<SettingsModal open onClose={vi.fn()}><span>내용</span></SettingsModal>)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('설정 닫기')
    view.rerender(<SettingsModal open={false} onClose={vi.fn()}><span>내용</span></SettingsModal>)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('영어 화면에서는 머리말과 닫기 단추가 영어다', () => {
    setLocale('en')
    render(<SettingsModal open onClose={vi.fn()}><span>내용</span></SettingsModal>)
    expect(screen.getByRole('heading', { name: 'Settings' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close settings' })).not.toBeNull()
  })
})
