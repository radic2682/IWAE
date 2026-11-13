// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle } from '../../core/canvasDocument'
import { NoteToolbar } from './NoteToolbar'

describe('NoteToolbar', () => {
  it('H1-H6와 기본 서식 명령을 선택 블록에 전달한다', () => {
    const onCommand = vi.fn()
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={onCommand}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '블록 유형' }))
    const list = screen.getByRole('listbox', { name: '블록 유형' })
    expect(within(list).getByRole('option', { name: /본문/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(list).getByRole('option', { name: /제목 3/ }))
    expect(screen.queryByRole('listbox', { name: '블록 유형' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '굵게' }))
    fireEvent.click(screen.getByRole('button', { name: '번호 목록' }))

    expect(onCommand).toHaveBeenNthCalledWith(1, { type: 'setLevel', level: 'h3' })
    expect(onCommand).toHaveBeenNthCalledWith(2, { type: 'toggleBold' })
    expect(onCommand).toHaveBeenNthCalledWith(3, { type: 'toggleList', list: 'number' })
  })

  it('선택한 텍스트 블록이 없으면 서식 컨트롤을 비활성화한다', () => {
    render(
      <NoteToolbar
        selectionStyle={null}
        canFormat={false}
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: '굵게' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('spinbutton', { name: '글자 크기' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('전체 화면 버튼을 별도 액션으로 전달한다', () => {
    const onToggleFullscreen = vi.fn()
    render(
      <NoteToolbar
        selectionStyle={null}
        canFormat={false}
        canUndo
        canRedo
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={onToggleFullscreen}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '노트 전체 화면' }))
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('기존 블록·그리기 도구 행을 제거한다', () => {
    render(
      <NoteToolbar
        selectionStyle={null}
        canFormat={false}
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    expect(screen.queryByRole('group', { name: '블록 및 그리기 도구' })).toBeNull()
    expect(screen.queryByRole('button', { name: '제목 블록' })).toBeNull()
  })

  it('글자색과 강조색을 스와치 팝오버에서 선택하고 바깥 클릭으로 닫는다', () => {
    const onCommand = vi.fn()
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={onCommand}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    expect(screen.getByRole('dialog', { name: '글자색 팔레트' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '글자색 파랑' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'setColor', color: '#1d4ed8' })

    fireEvent.click(screen.getByRole('button', { name: '강조색 선택' }))
    expect(screen.getByRole('dialog', { name: '강조색 팔레트' })).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: '강조색 팔레트' })).toBeNull()
  })

  it('새 색상 팝오버를 열면 이전 팝오버를 닫는다', () => {
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    expect(screen.getByRole('dialog', { name: '글자색 팔레트' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '블록 배경색 선택' }))
    expect(screen.queryByRole('dialog', { name: '글자색 팔레트' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '블록 배경색 팔레트' })).toBeDefined()
  })

  it('오른쪽 가장자리의 색상 팝오버를 화면 안쪽으로 보정한다', () => {
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: '글자색 선택' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 980,
      y: 10,
      width: 32,
      height: 30,
      top: 10,
      right: 1012,
      bottom: 40,
      left: 980,
      toJSON: () => ({}),
    })

    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: '글자색 팔레트' }).style.left).toBe('772px')
  })

  it('통합 서식 도구는 접히지 않고 항상 전체가 노출된다', () => {
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const toolbar = screen.getByRole('toolbar', { name: '노트 편집 도구' })
    expect(toolbar.getAttribute('data-expanded')).toBeNull()
    expect(screen.queryByRole('button', { name: '서식 도구 열기' })).toBeNull()
    expect(toolbar.querySelector('.note-toolbar-controls')).not.toBeNull()
  })

  it('좁은 화면에서 마우스 휠로 숨은 도구까지 가로 이동한다', () => {
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )
    const controls = screen.getByRole('toolbar', { name: '노트 편집 도구' }).querySelector('.note-toolbar-controls') as HTMLElement
    Object.defineProperties(controls, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 900 },
    })

    fireEvent.wheel(controls, { deltaY: 120 })

    expect(controls.scrollLeft).toBe(120)
  })

  it('두 번째 행에는 블록 추가와 연결선 종류, 맨 오른쪽 설정을 둔다', () => {
    render(
      <NoteToolbar
        selectionStyle={null}
        canFormat={false}
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const secondary = screen.getByRole('toolbar', { name: '노트 편집 도구' }).querySelector('.note-toolbar-secondary')
    expect(secondary?.querySelector('button[aria-label="블록 테두리색 선택"]')).not.toBeNull()
    expect(secondary?.querySelector('button[aria-label="텍스트 블록 추가"]')).not.toBeNull()
    expect(secondary?.querySelector('button[aria-label="네모 그리기"]')).not.toBeNull()
    expect(secondary?.querySelector('button[aria-label="이미지 추가"]')).not.toBeNull()
    expect(secondary?.querySelectorAll('.note-line-modes button')).toHaveLength(4)
    expect(secondary?.lastElementChild?.getAttribute('aria-label')).toBe('노트 옵션')
  })

  it('연결선 종류를 토글하고 삭제 버튼은 표시하지 않는다', () => {
    const onSetConnectionMode = vi.fn()
    const onDeleteSelectedEdges = vi.fn()
    render(
      <NoteToolbar
        selectionStyle={null}
        canFormat={false}
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={1}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onSetConnectionMode={onSetConnectionMode}
        onDeleteSelectedEdges={onDeleteSelectedEdges}
        onAddPreset={vi.fn()}
        onSetBlockBackground={vi.fn()}
        onSetBlockBorderColor={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '오른쪽 화살표' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '양방향 화살표' }))
    expect(onSetConnectionMode).toHaveBeenCalledWith('arrow', 'arrow')
    expect(screen.queryByRole('button', { name: '선택한 선 삭제' })).toBeNull()
    expect(onDeleteSelectedEdges).not.toHaveBeenCalled()
  })

  it('블록 배경색과 테두리색을 각각 선택한다', () => {
    const onSetBlockBackground = vi.fn()
    const onSetBlockBorderColor = vi.fn()
    render(
      <NoteToolbar
        selectionStyle={createDefaultTextBlockStyle()}
        canFormat
        canUndo={false}
        canRedo={false}
        onCommand={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        connectionStartMarker="none"
        connectionEndMarker="arrow"
        selectedEdgeCount={0}
        onSetConnectionStartMarker={vi.fn()}
        onSetConnectionEndMarker={vi.fn()}
        onDeleteSelectedEdges={vi.fn()}
        onAddPreset={vi.fn()}
        onSetBlockBackground={onSetBlockBackground}
        onSetBlockBorderColor={onSetBlockBorderColor}
        onToggleFullscreen={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '블록 배경색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '블록 배경색 노랑' }))
    fireEvent.click(screen.getByRole('button', { name: '블록 테두리색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '블록 테두리색 파랑' }))
    expect(onSetBlockBackground).toHaveBeenCalledWith('#fff2a8')
    expect(onSetBlockBorderColor).toHaveBeenCalledWith('#1d4ed8')
  })

  it('근거와 함께 내보내기 버튼은 핸들러가 있을 때만 보인다', () => {
    const onExportWithEvidence = vi.fn()
    const base = {
      selectionStyle: null, canFormat: false, canUndo: true, canRedo: true, onCommand: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
      connectionStartMarker: 'none' as const, connectionEndMarker: 'arrow' as const, selectedEdgeCount: 0,
      onSetConnectionStartMarker: vi.fn(), onSetConnectionEndMarker: vi.fn(), onDeleteSelectedEdges: vi.fn(), onAddPreset: vi.fn(),
      onSetBlockBackground: vi.fn(), onSetBlockBorderColor: vi.fn(), onToggleFullscreen: vi.fn(),
    }
    const { rerender } = render(<NoteToolbar {...base} />)
    expect(screen.queryByRole('button', { name: '근거와 함께 내보내기' })).toBeNull()
    rerender(<NoteToolbar {...base} onExportWithEvidence={onExportWithEvidence} />)
    fireEvent.click(screen.getByRole('button', { name: '근거와 함께 내보내기' }))
    expect(onExportWithEvidence).toHaveBeenCalled()
  })
})
