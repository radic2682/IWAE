import { t } from '../i18n'
import { useEffect, useRef, type KeyboardEvent } from 'react'

export type BlockMenuAction =
  | 'delete'
  | 'disconnect'
  | 'duplicate'
  | 'openSource'
  | 'translate'
  | 'savePreset'
  | 'resetStyle'
  | 'bringForward'
  | 'sendBackward'

interface BlockContextMenuProps {
  readonly x: number
  readonly y: number
  readonly canOpenSource: boolean
  readonly canTranslate: boolean
  readonly canSavePreset?: boolean
  readonly canDisconnect?: boolean
  readonly onAction: (action: BlockMenuAction) => void
  readonly onClose: () => void
}

const ITEMS: readonly { action: BlockMenuAction; label: string }[] = [
  { action: 'duplicate', label: '복제' },
  { action: 'openSource', label: '원문 열기' },
  { action: 'translate', label: '번역 블록 만들기' },
  { action: 'savePreset', label: '프리셋으로 추가' },
  { action: 'resetStyle', label: '스타일 초기화' },
  { action: 'bringForward', label: '맨 앞으로' },
  { action: 'sendBackward', label: '맨 뒤로' },
  { action: 'disconnect', label: '연결 해제' },
  { action: 'delete', label: '삭제' },
]

export function BlockContextMenu({ x, y, canOpenSource, canTranslate, canSavePreset = false, canDisconnect = false, onAction, onClose }: BlockContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    menuRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  return (
    <>
      <button type="button" className="block-menu-backdrop" aria-label={t('블록 메뉴 닫기')} onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        className="block-context-menu"
        style={{ left: `${x}px`, top: `${y}px` }}
        onKeyDown={handleKeyDown}
      >
        {ITEMS.map(({ action, label }) => {
          const disabled = action === 'openSource'
            ? !canOpenSource
            : action === 'translate'
              ? !canTranslate
              : action === 'savePreset'
                ? !canSavePreset
                : action === 'disconnect'
                  ? !canDisconnect
                : false
          return (
            <button
              key={action}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                onAction(action)
                onClose()
              }}
            >
              {t(label)}
            </button>
          )
        })}
      </div>
    </>
  )
}
