// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DEFAULT_PREFIX_BINDINGS } from '../core/prefixKeys'
import { commandNames } from './workspaceCommands'
import { KeysHelpSheet, PREFIX_KEY_ROWS } from './KeysHelpSheet'

afterEach(cleanup)

describe('KeysHelpSheet', () => {
  it('접두키 다음 키마다 키 · 동작 · 명령을 보인다. 「상태」 칸은 없다(모든 줄이 됨이라 쓸모가 없었다)', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[{ label: '명령 팔레트', keys: 'Ctrl+K' }]} prefixText="Ctrl+B" />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['키', '동작', '명령'])
    const rows = within(table).getAllByRole('row').slice(1)
    for (const row of rows) expect(within(row).getAllByRole('cell')).toHaveLength(3)
    expect(table.querySelector('.keys-help-state')).toBeNull()
    expect(screen.queryByText('됨')).toBeNull()
    const commandOf = (keys: string) => within(rows.find((row) => within(row).getAllByRole('cell')[0]!.textContent === keys)!).getAllByRole('cell')[2]!
    expect(commandOf('% / "').textContent).toBe('split-window -h / -v')
    expect(commandOf('q').textContent).toBe('display-panes')
    expect(screen.getByText(/접두키\(Ctrl\+B\)를 누르고/u)).toBeDefined()
    expect(screen.getByText('Ctrl+K')).toBeDefined()
  })

  it('명령은 하나하나 한 덩어리(<code>)이고 줄이 꺾이는 곳은 「 · 」 뒤뿐이다 — 명령 안의 공백 · 슬래시에서는 꺾이지 않는다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    const table = screen.getByRole('table')
    const row = (keys: string) => within(table).getAllByRole('row').slice(1).find((candidate) => within(candidate).getAllByRole('cell')[0]!.textContent === keys)!
    const cmds = (keys: string) => [...row(keys).querySelectorAll('.keys-help-cmd')].map((code) => code.textContent)
    expect(cmds('% / "')).toEqual(['split-window -h / -v'])
    expect(cmds('c · , · &')).toEqual(['new-window', 'rename-window', 'kill-window'])
    expect(cmds('f · w')).toEqual(['toggle-floating', 'display-popup'])
    // 구분자 「 ·」 는 앞 명령과 같은 덩어리(.keys-help-item) 안에 있어 줄 첫머리에 홀로 오지 않는다
    const item = row('c · , · &').querySelector('.keys-help-item')!
    expect(item.textContent).toBe('new-window ·')
    // 마지막 명령 뒤에는 구분자가 없다
    expect(row('c · , · &').querySelectorAll('.keys-help-sep')).toHaveLength(2)
    // CSS: 덩어리는 줄바꿈 금지, 예전의 낱말 단위 꺾기(.keys-help-token · overflow-wrap) 규칙은 없다
    const css = readFileSync('src/ui/keys-help.css', 'utf8')
    expect(css).toMatch(/\.keys-help-item \{ white-space: nowrap; \}/u)
    expect(css).not.toContain('keys-help-token')
    expect(css).not.toContain('keys-help-state')
  })

  it('「:」 줄은 명령 대신 풀이를 보이고 자연스럽게 읽힌다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    const colonRow = within(screen.getByRole('table')).getAllByRole('row').slice(1).find((candidate) => within(candidate).getAllByRole('cell')[0]!.textContent === ':')!
    expect(within(colonRow).getAllByRole('cell')[2]!.textContent).toBe('명령 팔레트를 「:」 로 엽니다')
    expect(colonRow.textContent).not.toContain('(명령 팔레트가')
  })

  it('z 줄은 「이 칸만 크게 / 원래 크기로」 이고 「되돌리기」 가 아니다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    expect(screen.getByText('이 칸만 크게 / 원래 크기로')).toBeDefined()
    expect(screen.queryByText('이 칸만 크게 / 되돌리기')).toBeNull()
  })

  it('도움말의 접두키 표가 가리키는 명령은 실제 명령이거나 다음 단계 명령이다', () => {
    const known = new Set(commandNames({ includeSoon: true }))
    const internal = ['command-prompt', 'rename-prompt', 'confirm-kill-window', 'choose-session']
    for (const line of Object.values(DEFAULT_PREFIX_BINDINGS)) {
      const name = line.split(' ')[0]!
      expect(known.has(name) || internal.includes(name), name).toBe(true)
    }
    // 표의 명령은 모두 실제 명령이다
    for (const name of PREFIX_KEY_ROWS.flatMap((row) => row.commands).map((command) => command.split(' ')[0]!)) {
      expect(known.has(name) || internal.includes(name) || name === 'toggle-floating' || name === 'display-popup', name).toBe(true)
    }
  })

  it('명령줄 명령 목록이 있다(다음 단계 명령은 뺀다)', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    expect(screen.getByText('split-window [-h|-v]')).toBeDefined()
    expect(screen.getByText('apply-template 이름')).toBeDefined()
    // 떠 있는 칸 · 세션 · 앱 창 명령은 이제 모두 된다
    expect(screen.getByText('float-pane')).toBeDefined()
    expect(screen.getByText('embed-pane')).toBeDefined()
    expect(screen.getByText('kill-session [-t 이름]')).toBeDefined()
    expect(screen.getByText('new-client [-t 세션이름]')).toBeDefined()
    expect(screen.getAllByText('detach').length).toBeGreaterThan(0)
  })
})
