// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { menuGuardActive, resetMenuGuard } from './menuGuard'
import { PopupMenu } from '../PopupMenu'
import { ContextMenu } from '../../ui/ContextMenu'
import { Select } from '../../ui/Select'
import { NoteFlow, type NoteFlowItem } from '../../pdf/NoteFlow'

afterEach(() => { cleanup(); resetMenuGuard(); vi.restoreAllMocks(); vi.useRealTimers() })

/** 포인터를 움직인다: 진짜 움직임은 movementX/Y 가 0 이 아니고, 레이아웃 뒤 브라우저가 만드는 합성 move 는 0 이다 */
const move = (target: Element | Window, movement: number) => {
  target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, movementX: movement, movementY: 0 }))
}

/** 메뉴 밑에 깔린 내용(메모 카드 같은 것) */
function Under({ children, onEnterGuard }: { readonly children: React.ReactNode; readonly onEnterGuard: (blocked: boolean) => void }) {
  return (
    <div>
      <div data-testid="under" onPointerEnter={() => onEnterGuard(menuGuardActive())}>카드</div>
      {children}
    </div>
  )
}

describe('메뉴 항목을 고른 직후, 밑에 있던 내용이 호버로 켜지지 않는다(포인터가 진짜 움직일 때까지)', () => {
  it('PopupMenu 항목을 고르면 켜지고, 움직임 없는 합성 move 로는 안 꺼지고, 진짜 움직임에서 꺼진다(시간이 아니다)', () => {
    vi.useFakeTimers()
    const onEnter = vi.fn()
    render(
      <Under onEnterGuard={onEnter}>
        <PopupMenu label="칸 메뉴" right={10} top={10} onClose={vi.fn()}>
          <button type="button" role="menuitem">띄우기</button>
        </PopupMenu>
      </Under>,
    )
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('menuitem', { name: '띄우기' }))
    expect(menuGuardActive()).toBe(true)
    // 오래 지나도(예전의 350ms 를 한참 넘겨도) 포인터가 안 움직였으면 그대로다
    vi.advanceTimersByTime(5000)
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(true)
    move(window, 0)
    expect(menuGuardActive()).toBe(true)
    move(window, 3)
    expect(menuGuardActive()).toBe(false)
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(false)
  })

  it('ContextMenu(우클릭 메뉴)도 같다', () => {
    const onEnter = vi.fn()
    render(
      <Under onEnterGuard={onEnter}>
        <ContextMenu x={5} y={5} label="문서" onClose={vi.fn()} entries={[{ key: 'a', icon: null, label: '열기', onSelect: vi.fn() }]} />
      </Under>,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: '열기' }))
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(true)
  })

  it('Select 의 목록 항목(role=option)을 골라도 켜진다', () => {
    render(<Select value="a" options={[{ value: 'a', label: '가' }, { value: 'b', label: '나' }]} onChange={vi.fn()} ariaLabel="고르기" />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: '나' }))
    expect(menuGuardActive()).toBe(true)
  })

  it('탭 목록 뒷판(.pane-tabs-backdrop)을 눌러 닫아도 켜진다', () => {
    render(<div><button type="button" className="pane-tabs-backdrop">닫기</button></div>)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(menuGuardActive()).toBe(true)
  })

  it('새로 누르면(pointerdown) 바로 꺼진다', () => {
    render(<button type="button" role="menuitem">항목</button>)
    fireEvent.click(screen.getByRole('menuitem'))
    expect(menuGuardActive()).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(menuGuardActive()).toBe(false)
  })

  it('메뉴가 아닌 곳의 click 은 켜지 않는다', () => {
    render(<button type="button">보통 단추</button>)
    fireEvent.click(screen.getByRole('button'))
    expect(menuGuardActive()).toBe(false)
  })
})

describe('NoteFlow 메모 카드: 비켜 간 진입은 포인터가 진짜 움직이면 켠다', () => {
  const highlight = {
    id: 'h1', color: 'green' as const, note: '쓴 메모',
    anchor: { docId: 'd', page: 3, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: '원문 글', prefix: '', suffix: '' },
  }
  const items: NoteFlowItem[] = [{ kind: 'memo', key: 'b1', highlight }]
  const props = () => ({
    editingKey: null, activeKey: null, pageSizeOf: () => undefined,
    onEdit: vi.fn(), onActivate: vi.fn(), onSaveMemo: vi.fn(), onCancelDraft: vi.fn(), onSaveText: vi.fn(), onRemoveText: vi.fn(), onRecolor: vi.fn(),
    onDeleteMemo: vi.fn(), onToggleCollapse: vi.fn(), onRate: vi.fn(), onMove: vi.fn(), onJump: vi.fn(), onCardLayout: vi.fn(),
  })
  const chooseMenuItem = () => {
    render(<button type="button" role="menuitem">항목</button>)
    fireEvent.click(screen.getByRole('menuitem'))
  }

  it('메뉴 항목을 고른 직후에는 카드가 켜지지 않고, 같은 카드 위에서 포인터가 움직이면 켜진다', () => {
    const handlers = props()
    const { container } = render(<NoteFlow {...handlers} items={items} />)
    const card = container.querySelector<HTMLElement>('[data-note-block="b1"]')!
    chooseMenuItem()
    fireEvent.pointerEnter(card)
    expect(handlers.onActivate).not.toHaveBeenCalled()
    move(card, 0)
    expect(handlers.onActivate).not.toHaveBeenCalled()
    move(card, 2)
    expect(handlers.onActivate).toHaveBeenCalledExactlyOnceWith('b1')
    // 그 뒤 움직임은 다시 부르지 않는다
    move(card, 2)
    expect(handlers.onActivate).toHaveBeenCalledTimes(1)
  })

  it('메뉴를 고르지 않았으면 들어가는 순간 켜진다', () => {
    const handlers = props()
    const { container } = render(<NoteFlow {...handlers} items={items} />)
    fireEvent.pointerEnter(container.querySelector('[data-note-block="b1"]')!)
    expect(handlers.onActivate).toHaveBeenCalledExactlyOnceWith('b1')
  })

  it('비켜 간 뒤 포인터가 카드를 떠나면 그 진입은 잊는다(나중 움직임이 켜지 않는다)', () => {
    const handlers = props()
    const { container } = render(<NoteFlow {...handlers} items={items} />)
    const card = container.querySelector<HTMLElement>('[data-note-block="b1"]')!
    chooseMenuItem()
    fireEvent.pointerEnter(card)
    fireEvent.pointerLeave(card)
    handlers.onActivate.mockClear()
    move(card, 4)
    expect(handlers.onActivate).not.toHaveBeenCalled()
  })
})
