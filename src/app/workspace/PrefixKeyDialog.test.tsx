// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PrefixKeyHost } from './PrefixKeyDialog'
import { getAppPrefs, setAppPref } from '../appPrefs'
import { WhatsNewHost } from '../onboarding/WhatsNewDialog'
import { resetStartupDialogs } from '../onboarding/startupDialogs'
import { effectiveKeys, SHORTCUT_DEFS } from '../../core/shortcutRegistry'

const prefixKeys = () => effectiveKeys(SHORTCUT_DEFS.find((def) => def.id === 'prefixKey')!, getAppPrefs().shortcuts, false)

beforeEach(() => {
  localStorage.clear()
  setAppPref('shortcuts', {})
  setAppPref('prefixKeyAsked', false)
})
afterEach(() => {
  cleanup()
  resetStartupDialogs()
  setAppPref('shortcuts', {})
  setAppPref('prefixKeyAsked', false)
})

const dialog = () => screen.queryByRole('alertdialog', { name: '접두키 고르기' })

describe('첫 실행 「접두키 고르기」 창', () => {
  it('접두키를 고른 적이 없으면 뜨고, Ctrl+B 가 미리 골라져 있으며 안내가 보인다', () => {
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    expect(dialog()).not.toBeNull()
    expect(screen.getByText('칸 나누기나 화면 바꾸기 같은 작업 공간 명령은 접두키를 누른 뒤 한 글자로 실행합니다(tmux 방식).')).toBeDefined()
    expect(screen.getByText('설정 → 단축키에서 언제든 바꿀 수 있습니다')).toBeDefined()
    expect(screen.getByText('기본 (tmux와 같음)')).toBeDefined()
    expect(screen.getByText(/메모를 쓸 때 Ctrl\+B는 굵게입니다/u)).toBeDefined()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.value)).toEqual(['Ctrl+B', 'Ctrl+Space', 'Ctrl+A', 'custom'])
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false, false])
    expect(document.querySelectorAll('kbd.prefix-dialog-key')).toHaveLength(3)
  })

  it('한 번 묻고 나면 다시 뜨지 않는다', () => {
    const { rerender } = render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(dialog()).toBeNull()
    expect(getAppPrefs().prefixKeyAsked).toBe(true)
    rerender(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    expect(dialog()).toBeNull()
  })

  it('이미 고른 접두키가 설정에 있거나 이미 물었으면 뜨지 않는다', () => {
    setAppPref('shortcuts', { prefixKey: 'Mod+Space' })
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    expect(dialog()).toBeNull()
    cleanup()
    setAppPref('shortcuts', {})
    setAppPref('prefixKeyAsked', true)
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    expect(dialog()).toBeNull()
  })

  it('다른 앱 창이거나 시작 중이거나 keys.conf 가 접두키를 정했으면(enabled false) 뜨지 않고 물은 것으로도 치지 않는다', () => {
    render(<PrefixKeyHost enabled={false} onChooseCustom={vi.fn()} />)
    expect(dialog()).toBeNull()
    expect(getAppPrefs().prefixKeyAsked).toBe(false)
  })

  it('고른 키가 설정의 단축키 값에 저장된다: Ctrl+Space, Ctrl+A', () => {
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Ctrl\+Space/u }))
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(getAppPrefs().shortcuts).toEqual({ prefixKey: 'Mod+Space' })
    expect(prefixKeys()).toEqual(['Mod+Space'])
    cleanup()
    resetStartupDialogs()
    setAppPref('shortcuts', {})
    setAppPref('prefixKeyAsked', false)
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Ctrl\+A/u }))
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(getAppPrefs().shortcuts).toEqual({ prefixKey: 'Mod+A' })
  })

  it('Ctrl+B 를 확인하면 기본값 그대로(저장된 값 없음)이다', () => {
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(getAppPrefs().shortcuts).toEqual({})
    expect(prefixKeys()).toEqual(['Mod+B'])
  })

  it('「나중에」 는 Ctrl+B 를 그대로 두고 다시 묻지 않는다', () => {
    render(<PrefixKeyHost enabled onChooseCustom={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Ctrl\+A/u }))
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    expect(dialog()).toBeNull()
    expect(getAppPrefs().shortcuts).toEqual({})
    expect(getAppPrefs().prefixKeyAsked).toBe(true)
    expect(prefixKeys()).toEqual(['Mod+B'])
  })

  it('「직접 정하기…」 를 확인하면 창을 닫고 설정의 단축키 녹음으로 보낸다', () => {
    const onChooseCustom = vi.fn()
    render(<PrefixKeyHost enabled onChooseCustom={onChooseCustom} />)
    fireEvent.click(screen.getByRole('radio', { name: /직접 정하기/u }))
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(onChooseCustom).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(getAppPrefs().prefixKeyAsked).toBe(true)
    expect(getAppPrefs().shortcuts).toEqual({})
  })

  it('「새 버전」 창이 먼저 뜨고, 그것이 닫힌 뒤에 접두키 창이 뜬다(겹치지 않는다)', () => {
    localStorage.setItem('iwae:last-seen-version:v1', '0.0.1')
    const notes = [{ version: '9.9.9', date: null, body: '- 새 기능' }]
    render(<><WhatsNewHost enabled version="9.9.9" notes={notes} onShowHistory={vi.fn()} /><PrefixKeyHost enabled onChooseCustom={vi.fn()} /></>)
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.queryByRole('alertdialog', { name: /새 버전/u })).not.toBeNull()
    expect(dialog()).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('button', { name: '확인' })) })
    expect(screen.queryAllByRole('alertdialog')).toHaveLength(1)
    expect(dialog()).not.toBeNull()
  })
})
