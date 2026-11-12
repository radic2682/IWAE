// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AiActivityPill } from './AiActivityPill'
import { aiActivityBegin, aiActivityEnd, resetAiActivity } from './mcp/aiActivityStore'

afterEach(() => { act(() => { resetAiActivity() }) })

describe('AiActivityPill', () => {
  it('AI 가 일하지 않으면 아무것도 그리지 않는다', () => {
    const { container } = render(<AiActivityPill />)
    expect(container.firstChild).toBeNull()
  })

  it('편집 중인 대상과 변경 수를 보여 준다', () => {
    render(<AiActivityPill />)
    act(() => { aiActivityBegin('논문 노트'); aiActivityEnd(2) })
    expect(screen.getByRole('button', { name: /AI가 편집 중: 논문 노트 \(2개 변경\)/u })).toBeTruthy()
  })

  it('바뀐 것이 없으면 「보는 중」으로 보여 준다', () => {
    render(<AiActivityPill />)
    act(() => { aiActivityBegin('논문'); aiActivityEnd(0) })
    expect(screen.getByRole('button', { name: 'AI가 보는 중: 논문' })).toBeTruthy()
    act(() => { resetAiActivity(); aiActivityBegin(''); aiActivityEnd(0) })
    expect(screen.getByRole('button', { name: 'AI가 보는 중' })).toBeTruthy()
  })

  it('누르면 변경 목록이 열리고 Esc 로 닫히며 초점이 알약으로 돌아온다', () => {
    render(<AiActivityPill />)
    act(() => { aiActivityBegin('노트'); aiActivityEnd(1) })
    const pill = screen.getByRole('button', { name: /AI가 편집 중/u })
    fireEvent.click(pill)
    expect(screen.getByRole('dialog', { name: 'AI가 한 변경' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /모두 되돌리기/u })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(pill)
  })
})
