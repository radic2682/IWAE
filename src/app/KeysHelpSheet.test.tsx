// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DEFAULT_PREFIX_BINDINGS } from '../core/prefixKeys'
import { commandNames } from './workspaceCommands'
import { ruleDecl } from './cssRules.testutil'
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
    expect(screen.getByText(/Ctrl\+B를 눌렀다 놓은 다음/u)).toBeDefined()
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
    expect(ruleDecl('keys-help.css', '.keys-help-item', 'white-space')).toBe('nowrap')
    expect(css).not.toContain('keys-help-token')
    expect(css).not.toContain('keys-help-state')
  })

  it('동작 글은 「 · 」 로 나뉜 토막마다 한 덩어리다: 구분점은 앞 토막 끝에 붙고, 토막이 하나면 그대로다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    const table = screen.getByRole('table')
    const actionCell = (keys: string) => within(within(table).getAllByRole('row').slice(1).find((candidate) => within(candidate).getAllByRole('cell')[0]!.textContent === keys)!).getAllByRole('cell')[1]!
    expect([...actionCell('f · w').querySelectorAll('.keys-help-seg')].map((seg) => seg.textContent)).toEqual(['떠 있는 칸 숨기기·보이기 ·', '번역기'])
    expect([...actionCell('n p l · 0–9').querySelectorAll('.keys-help-seg')].map((seg) => seg.textContent)).toEqual(['다음 ·', '이전 ·', '마지막 화면 ·', '번호로'])
    expect([...actionCell('x').querySelectorAll('.keys-help-seg')].map((seg) => seg.textContent)).toEqual(['칸 닫기'])
    expect(actionCell('f · w').textContent).toBe('떠 있는 칸 숨기기·보이기 · 번역기')
  })

  it('동작 열은 190px, 명령 열이 나머지를 쓰며(고정 폭 표), 토막은 칸보다 길 때만 안에서 꺾인다', () => {
    expect(ruleDecl('keys-help.css', '.keys-help-table', 'table-layout')).toBe('fixed')
    expect(ruleDecl('keys-help.css', '.keys-help-table th:nth-child(2)', 'width')).toBe('190px')
    expect(ruleDecl('keys-help.css', '.keys-help-table th:nth-child(3)', 'width')).toBeUndefined()
    expect(ruleDecl('keys-help.css', '.keys-help-seg', 'display')).toBe('inline-block')
    expect(ruleDecl('keys-help.css', '.keys-help-seg', 'max-width')).toBe('100%')
  })

  it('명령은 앱의 고정폭 글꼴(Cascadia Mono · Consolas)이고 자간은 그대로이다. 브라우저 기본 monospace 만 쓰지 않는다', () => {
    const family = ruleDecl('keys-help.css', '.keys-help code', 'font-family') ?? ''
    expect(family).toContain('Cascadia Mono')
    expect(family).toContain('Consolas')
    expect(family).not.toBe('monospace')
    expect(ruleDecl('keys-help.css', '.keys-help code', 'letter-spacing')).toBe('normal')
    // 굵지 않고(400) 흐린 글색 — 다른 곳의 코드와 같다
    expect(ruleDecl('keys-help.css', '.keys-help code', 'font-weight')).toBe('400')
    expect(ruleDecl('keys-help.css', '.keys-help code', 'color')).toBe('var(--text-muted)')
  })

  it('본문은 스크롤되고 맨 아래에 여백이 있어 마지막 줄이 가려지지 않는다', () => {
    expect(ruleDecl('keys-help.css', '.keys-help .sko-body', 'overflow-y')).toBe('auto')
    expect(ruleDecl('keys-help.css', '.keys-help .sko-body', 'padding-bottom')).toContain('--space-')
  })

  it('「:」 줄은 명령 대신 풀이를 보이고 자연스럽게 읽힌다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    const colonRow = within(screen.getByRole('table')).getAllByRole('row').slice(1).find((candidate) => within(candidate).getAllByRole('cell')[0]!.textContent === ':')!
    expect(within(colonRow).getAllByRole('cell')[2]!.textContent).toBe('명령 팔레트를 「:」로 엽니다')
    expect(colonRow.textContent).not.toContain('(명령 팔레트가')
  })

  it('z 줄은 「이 칸 확대 / 원래 크기로」 이고 「되돌리기」 가 아니다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    expect(screen.getByText('이 칸 확대 / 원래 크기로')).toBeDefined()
    expect(screen.queryByText('이 칸 확대 / 되돌리기')).toBeNull()
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
