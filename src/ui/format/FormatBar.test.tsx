// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FormatBar, formatGroupsOf, formatTitle, paletteWidth, popoverLeft } from './FormatBar'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const toggle = (active?: boolean) => ({ active, onToggle: vi.fn() })

describe('formatGroupsOf — 주인이 넘긴 묶음만 그린다', () => {
  it('넘긴 것에 따라 묶음이 정해지고 순서는 늘 문단 · 글자 모양 · 정렬 · 목록 · 색이다', () => {
    // 노트: 정렬 · 크기 없음
    expect(formatGroupsOf({ block: { value: 'p', options: [], onChange: vi.fn() }, marks: { bold: toggle() }, lists: { bullet: toggle() }, textColor: { colors: [], onChange: vi.fn() }, clear: vi.fn() }))
      .toEqual(['block', 'marks', 'lists', 'color'])
    // 캔버스: 정렬과 크기가 있다
    expect(formatGroupsOf({ fontSize: { value: 16, onChange: vi.fn(), min: 8, max: 96, step: 1, unit: 'px', presets: [] }, marks: { bold: toggle() }, align: { value: 'left', onChange: vi.fn() } }))
      .toEqual(['block', 'marks', 'align'])
    // 글 상자: 굵게와 색만
    expect(formatGroupsOf({ marks: { bold: toggle() }, highlight: { colors: [], onChange: vi.fn() } })).toEqual(['marks', 'color'])
    // 비어 있는 기록(값이 모두 undefined)은 묶음이 아니다
    expect(formatGroupsOf({ marks: { bold: undefined }, lists: {} })).toEqual([])
    // 목록 단추가 없어도 목록 자리에 덧붙인 것(표)이 있으면 목록 묶음이 있다
    expect(formatGroupsOf({ slots: { lists: 'x' } })).toEqual(['lists'])
  })

  it('넘기지 않은 묶음의 단추는 화면에 없다', () => {
    render(<FormatBar label="서식" marks={{ bold: toggle(), italic: toggle() }} />)
    const bar = screen.getByRole('toolbar', { name: '서식' })
    expect(within(bar).getByRole('button', { name: '굵게' })).toBeDefined()
    expect(within(bar).getByRole('button', { name: '기울임' })).toBeDefined()
    expect(within(bar).queryByRole('button', { name: '밑줄' })).toBeNull()
    expect(within(bar).queryByRole('button', { name: '왼쪽 정렬' })).toBeNull()
    expect(within(bar).queryByRole('combobox', { name: '문단 모양' })).toBeNull()
    expect(bar.querySelectorAll('[data-cluster]')).toHaveLength(1)
  })
})

describe('FormatBar — 단추 · 상태 · 명령', () => {
  it('글자 모양 · 정렬 · 목록 단추가 주인의 명령을 부르고, 그 뒤 onCommand 를 부른다', () => {
    const bold = toggle(false)
    const check = toggle(false)
    const align = vi.fn()
    const clear = vi.fn()
    const onCommand = vi.fn()
    render(<FormatBar label="서식" marks={{ bold }} align={{ value: 'left', onChange: align }} lists={{ check }} clear={clear} onCommand={onCommand} />)
    fireEvent.click(screen.getByRole('button', { name: '굵게' }))
    fireEvent.click(screen.getByRole('button', { name: '가운데 정렬' }))
    fireEvent.click(screen.getByRole('button', { name: '할 일 목록' }))
    fireEvent.click(screen.getByRole('button', { name: '서식 지우기' }))
    expect(bold.onToggle).toHaveBeenCalledTimes(1)
    expect(align).toHaveBeenCalledWith('center')
    expect(check.onToggle).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledTimes(4)
  })

  it('켜짐을 넘기면 눌림(aria-pressed)을 보이고, 모르면(undefined) 눌림 표시가 없다', () => {
    render(<FormatBar label="서식" marks={{ bold: toggle(true), italic: toggle(false), underline: toggle() }} align={{ value: 'right', onChange: vi.fn() }} />)
    expect(screen.getByRole('button', { name: '굵게' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '굵게' }).classList.contains('format-bar-btn-on')).toBe(true)
    expect(screen.getByRole('button', { name: '기울임' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '밑줄' }).hasAttribute('aria-pressed')).toBe(false)
    expect(screen.getByRole('button', { name: '오른쪽 정렬' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '왼쪽 정렬' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('꺼진 서식 줄(쓰는 칸 없음)은 모든 단추 · 고르개가 꺼지고 눌림 표시도 없다', () => {
    render(<FormatBar label="서식" disabled block={{ value: 'p', options: [{ value: 'p', label: '본문' }], onChange: vi.fn() }} marks={{ bold: toggle(true) }} textColor={{ colors: [{ name: '검정', value: '#000000' }], onChange: vi.fn() }} />)
    const bar = screen.getByRole('toolbar', { name: '서식' })
    expect(bar.classList.contains('format-bar-idle')).toBe(true)
    expect(bar.getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByRole('button', { name: '굵게' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '굵게' }).hasAttribute('aria-pressed')).toBe(false)
    expect((screen.getByRole('combobox', { name: '문단 모양' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '글자색 선택' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('누를 때 초점을 가져오지 않는다(글 쓰는 칸의 고른 글을 지킨다): 단추 · 고르개 · 색 칸 모두 pointerdown 을 막는다', () => {
    render(<FormatBar label="서식" block={{ value: 'p', options: [{ value: 'p', label: '본문' }, { value: 'h2', label: '제목 1' }], onChange: vi.fn() }} marks={{ bold: toggle() }} textColor={{ colors: [{ name: '빨강', value: '#ff0000' }], onChange: vi.fn() }} />)
    expect(fireEvent.pointerDown(screen.getByRole('button', { name: '굵게' }))).toBe(false)
    expect(fireEvent.pointerDown(screen.getByRole('combobox', { name: '문단 모양' }))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    expect(fireEvent.pointerDown(screen.getByRole('button', { name: '글자색 빨강' }))).toBe(false)
  })

  it('풍선 도움말은 「이름 (단축)」, 단축은 주인이 넘긴 것만', () => {
    expect(formatTitle('굵게', 'Ctrl+B')).toBe('굵게 (Ctrl+B)')
    expect(formatTitle('취소선', undefined)).toBe('취소선')
    render(<FormatBar label="서식" marks={{ bold: toggle(), strike: toggle() }} shortcuts={{ bold: 'Ctrl+B' }} />)
    expect(screen.getByRole('button', { name: '굵게' }).getAttribute('title')).toBe('굵게 (Ctrl+B)')
    expect(screen.getByRole('button', { name: '취소선' }).getAttribute('title')).toBe('취소선')
  })

  it('문단 모양은 앱 드롭다운(Select)이고, 고르면 주인에게 값이 간다. 덧말(단축 안내)이 목록에 보인다', () => {
    const onChange = vi.fn()
    const onCommand = vi.fn()
    render(<FormatBar label="서식" onCommand={onCommand} block={{ value: 'p', options: [{ value: 'p', label: '본문' }, { value: 'h2', label: '제목 1', hint: '# 띄어쓰기' }], onChange }} />)
    const trigger = screen.getByRole('combobox', { name: '문단 모양' })
    expect(trigger.textContent).toContain('본문')
    fireEvent.click(trigger)
    const list = screen.getByRole('listbox', { name: '문단 모양' })
    expect(within(list).getByRole('option', { name: /제목 1/ }).textContent).toContain('# 띄어쓰기')
    fireEvent.click(within(list).getByRole('option', { name: /제목 1/ }))
    expect(onChange).toHaveBeenCalledWith('h2')
    expect(onCommand).toHaveBeenCalledTimes(1)
    // 고르개는 초점을 가져가지 않는다(keepFocus)
    expect(document.activeElement).not.toBe(trigger)
  })

  it('색 단추는 팔레트를 열고, 고르면 값을 넘기고 닫힌다. 「기본으로」와 지금 색 막대가 있다', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(<FormatBar label="서식" textColor={{ value: '#00ff00', colors: [{ name: '빨강', value: '#ff0000' }, { name: '초록', value: '#00ff00' }], onChange, clear: { label: '기본 글자색', onClear } }} />)
    const trigger = screen.getByRole('button', { name: '글자색 선택' })
    expect(trigger.querySelector('.format-bar-color-current')).not.toBeNull()
    fireEvent.click(trigger)
    const palette = screen.getByRole('dialog', { name: '글자색 팔레트' })
    expect(within(palette).getByRole('button', { name: '글자색 초록' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(palette).getByRole('button', { name: '글자색 빨강' }))
    expect(onChange).toHaveBeenCalledWith('#ff0000')
    expect(screen.queryByRole('dialog', { name: '글자색 팔레트' })).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '기본 글자색' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('팔레트는 한 번에 하나: 다른 색 단추를 열면 앞의 것이 닫힌다. 바깥을 누르거나 Esc 로도 닫힌다', () => {
    render(<FormatBar label="서식" textColor={{ colors: [{ name: '빨강', value: '#ff0000' }], onChange: vi.fn() }} highlight={{ colors: [{ name: '노랑', value: '#ffff00' }], onChange: vi.fn() }} />)
    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    expect(screen.getByRole('dialog', { name: '글자색 팔레트' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '글자 배경색 선택' }))
    expect(screen.queryByRole('dialog', { name: '글자색 팔레트' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '글자 배경색 팔레트' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '글자 배경색 팔레트' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '글자색 팔레트' })).toBeNull()
  })

  it('팔레트는 화면 안으로 들인다: 오른쪽 끝 단추면 왼쪽으로 민다(한 줄 일곱 칸 = 244px)', () => {
    expect(paletteWidth(21)).toBe(244)
    expect(paletteWidth(5)).toBe(5 * 28 + 4 * 5 + 18)
    expect(paletteWidth(8)).toBe(8 * 28 + 7 * 5 + 18)
    expect(paletteWidth(9)).toBe(244)
    expect(popoverLeft(980, 244, 1024)).toBe(772)
    expect(popoverLeft(2, 244, 1024)).toBe(8)
  })

  it('덧붙인 묶음(extras)은 맨 뒤에 따로 묶이고, 묶음 끝 자리(slots)는 그 묶음 안에 든다', () => {
    render(<FormatBar label="서식" lists={{ bullet: toggle() }} slots={{ lists: <button type="button">표</button> }} extras={[{ key: 'bg', node: <button type="button">배경</button> }]} />)
    const clusters = screen.getByRole('toolbar', { name: '서식' }).querySelectorAll<HTMLElement>('[data-cluster]')
    expect([...clusters].map((cluster) => cluster.dataset.group)).toEqual(['lists', 'extra'])
    expect(within(clusters[0]!).getByRole('button', { name: '표' })).toBeDefined()
    expect(within(clusters[1]!).getByRole('button', { name: '배경' })).toBeDefined()
  })

  it('글자 크기 칸: 단위 · 범위 · 걸음을 주인이 정하고, 꺼지면 입력도 꺼진다', () => {
    const onChange = vi.fn()
    const { rerender } = render(<FormatBar label="서식" fontSize={{ value: 16, onChange, min: 8, max: 96, step: 1, unit: 'px', presets: [12, 16, 24] }} />)
    const size = screen.getByRole('spinbutton', { name: '글자 크기' }) as HTMLInputElement
    expect(size.value).toBe('16')
    fireEvent.keyDown(size, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(17)
    fireEvent.change(size, { target: { value: '200' } })
    fireEvent.keyDown(size, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(96)
    fireEvent.click(screen.getByRole('button', { name: '자주 쓰는 크기' }))
    fireEvent.click(screen.getByRole('option', { name: '24 px' }))
    expect(onChange).toHaveBeenLastCalledWith(24)
    rerender(<FormatBar label="서식" disabled fontSize={{ value: 16, onChange, min: 8, max: 96, step: 1, unit: 'px', presets: [12] }} />)
    expect((screen.getByRole('spinbutton', { name: '글자 크기' }) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('FormatBar — 접는 자리에서 모자라면 「⋯」 로 접는다', () => {
  it('data-format-fold-host 안에서 폭이 모자라면 뒤쪽 묶음이 「⋯」 메뉴(body)로 가고, 접는 자리 밖에서는 접지 않는다', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const width = this.dataset.formatFoldHost !== undefined ? 200 : this.dataset.cluster !== undefined ? 80 : 0
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect
    })
    const props = { label: '서식', marks: { bold: toggle() }, align: { value: null, onChange: vi.fn() }, lists: { bullet: toggle() } } as const
    const view = render(<div data-format-fold-host=""><FormatBar {...props} /></div>)
    // 200 - 1(여유) = 199: 「⋯」(34) + 80 + 80 = 194 → 둘만 줄에
    const more = await screen.findByRole('button', { name: '서식 더 보기' })
    const bar = screen.getByRole('toolbar', { name: '서식' })
    expect(bar.querySelectorAll(':scope > [data-cluster]')).toHaveLength(2)
    act(() => { fireEvent.click(more) })
    const panel = screen.getByRole('group', { name: '서식 더 보기' })
    expect(panel.parentElement).toBe(document.body)
    expect(within(panel).getByRole('button', { name: '글머리 목록' })).toBeDefined()
    // 메뉴 안 단추도 같은 명령
    fireEvent.click(within(panel).getByRole('button', { name: '글머리 목록' }))
    expect(props.lists.bullet.onToggle).toHaveBeenCalled()
    view.unmount()
    render(<FormatBar {...props} />)
    expect(screen.queryByRole('button', { name: '서식 더 보기' })).toBeNull()
  })
})
