// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DEFAULT_PREFIX_BINDINGS } from '../core/prefixKeys'
import { commandNames } from './workspaceCommands'
import { KeysHelpSheet, PREFIX_KEY_ROWS } from './KeysHelpSheet'

afterEach(cleanup)

describe('KeysHelpSheet', () => {
  it('접두키 다음 키마다 되는지(됩니다 · 일부만 · 다음 단계)를 보인다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[{ label: '명령 팔레트', keys: 'Ctrl+K' }]} prefixText="Ctrl+B" />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    const state = (keys: string) => within(rows.find((row) => within(row).getAllByRole('cell')[0]!.textContent === keys)!).getAllByRole('cell')[3]!.textContent
    expect(state('% / "')).toBe('됩니다')
    expect(state('q')).toBe('됩니다')
    expect(state('f · w')).toBe('다음 단계')
    expect(state('d')).toBe('다음 단계')
    expect(state('s')).toBe('일부만')
    expect(screen.getByText(/접두키\(Ctrl\+B\)를 누르고/u)).toBeDefined()
    expect(screen.getByText('Ctrl+K')).toBeDefined()
  })

  it('도움말의 접두키 표가 가리키는 명령은 실제 명령이거나 다음 단계 명령이다', () => {
    const known = new Set(commandNames({ includeSoon: true }))
    const internal = ['command-prompt', 'rename-prompt', 'confirm-kill-window', 'choose-session']
    for (const line of Object.values(DEFAULT_PREFIX_BINDINGS)) {
      const name = line.split(' ')[0]!
      expect(known.has(name) || internal.includes(name), name).toBe(true)
    }
    const soon = PREFIX_KEY_ROWS.filter((row) => row.status === 'soon').map((row) => row.keys)
    expect(soon).toEqual(['f · w', 'd'])
  })

  it('명령줄 명령 목록이 있다(다음 단계 명령은 뺀다)', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    expect(screen.getByText('split-window [-h|-v]')).toBeDefined()
    expect(screen.getByText('apply-template 이름')).toBeDefined()
    expect(screen.queryByText('float-pane')).toBeNull()
  })
})
