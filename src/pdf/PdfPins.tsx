import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowSquareIn, PencilSimple, PushPin, Trash } from '@phosphor-icons/react'
import { ContextMenu } from '../ui/ContextMenu'
import type { PdfBookmark } from '../core/pdfBookmarks'
import '../ui/pdf-pins.css'
import { t } from '../i18n'

const LazyEmojiPicker = lazy(async () => {
  const module = await import('../app/EmojiPicker')
  return { default: module.EmojiPicker }
})

export interface PlacedPin {
  readonly pin: PdfBookmark
  /** 스크롤 막대 위 높이(px, 막대 맨 위에서) */
  readonly y: number
  /** 누르면 옮겨 갈 스크롤 위치 */
  readonly target: number
}

export interface PdfPinPatchInput {
  readonly title?: string
  readonly emoji?: string | null
}

interface PdfPinsProps {
  readonly pins: readonly PlacedPin[]
  /** 이름·이모지를 고치는 중인 핀 */
  readonly editingId: string | null
  readonly onEdit: (id: string | null) => void
  readonly onJump: (target: number) => void
  readonly onUpdate?: (id: string, patch: PdfPinPatchInput) => void
  readonly onRemove?: (id: string) => void
  readonly style?: CSSProperties
  /** 핀이 움직일 수 있는 막대 위 범위(px) */
  readonly track?: { readonly top: number; readonly bottom: number }
  /** 꾹 눌러(0.35초) 끌어 놓은 막대 위 높이(px) */
  readonly onMove?: (id: string, barY: number) => void
}

/** 이만큼 누르고 있으면 끌어 옮기기가 된다(ms). 그 전에 떼면 그냥 누름(그 자리로 가기) */
const PIN_HOLD_MS = 350
/** 누르는 동안 이보다 많이 움직이면 꾹 누르기가 아니다(px) */
const PIN_HOLD_SLOP = 5

/**
 * 스크롤 막대 옆에 꽂아 둔 책갈피 핀. 늘 보이고, 막대에 마우스를 올리면 잠깐 숨는다(막대 쪽 목차·새 핀 자리를 가리지 않게).
 * 누르면 그 자리로 가고, 두 번 누르거나 우클릭하면 그 자리에서 이모지·이름을 고친다.
 */
export function PdfPins({ pins, editingId, onEdit, onJump, onUpdate, onRemove, style, track, onMove }: PdfPinsProps) {
  const [pinMenu, setPinMenu] = useState<{ placed: PlacedPin; x: number; y: number } | null>(null)
  // 끄는 중인 핀과 그 높이. 끄는 동안은 그 핀만 손을 따라 그린다
  const [dragging, setDragging] = useState<{ id: string; y: number } | null>(null)
  // 꾹 누르기로 끈 뒤 따라오는 click(그 자리로 가기)은 무시한다
  const suppressClickRef = useRef(false)
  if (pins.length === 0) return null
  const startHold = (event: React.PointerEvent<HTMLButtonElement>, placed: PlacedPin) => {
    if (onMove === undefined || event.button !== 0) return
    const button = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    // 막대 좌표 = 핀 줄(.pdf-pins) 맨 위 기준
    const originTop = (button.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0
    let active = false
    const clamp = (y: number) => track === undefined ? y : Math.min(Math.max(y, track.top), track.bottom)
    const timer = window.setTimeout(() => {
      active = true
      button.setPointerCapture?.(pointerId)
      document.body.classList.add('pdf-pin-moving')
      setDragging({ id: placed.pin.id, y: placed.y })
    }, PIN_HOLD_MS)
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > PIN_HOLD_SLOP) finish(false)
        return
      }
      moveEvent.preventDefault()
      setDragging({ id: placed.pin.id, y: clamp(moveEvent.clientY - originTop) })
    }
    const finish = (commit: boolean, endEvent?: PointerEvent) => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (!active) return
      document.body.classList.remove('pdf-pin-moving')
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
      setDragging(null)
      if (commit && endEvent !== undefined) onMove(placed.pin.id, clamp(endEvent.clientY - originTop))
    }
    const up = (upEvent: PointerEvent) => { if (upEvent.pointerId === pointerId) finish(true, upEvent) }
    const cancel = () => finish(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
  return (
    <div className={`pdf-pins${editingId !== null ? ' pdf-pins-editing' : ''}`} style={style}>
      {pins.map((placed) => placed.pin.id === editingId && onUpdate !== undefined
        ? <PinEditor key={placed.pin.id} placed={placed} onUpdate={onUpdate} onRemove={onRemove} onDone={() => onEdit(null)} />
        : (
            <button
              key={placed.pin.id}
              type="button"
              className={`pdf-pin${dragging?.id === placed.pin.id ? ' pdf-pin-dragging' : ''}`}
              style={{ top: `${dragging?.id === placed.pin.id ? dragging.y : placed.y}px` }}
              onPointerDown={(event) => startHold(event, placed)}
              title={t('{title} · {page}쪽', { title: placed.pin.title, page: placed.pin.page + 1 })}
              aria-label={t('책갈피 {title} {page}쪽', { title: placed.pin.title, page: placed.pin.page + 1 })}
              onClick={() => {
                if (suppressClickRef.current) return
                onJump(placed.target)
              }}
              onDoubleClick={() => onEdit(placed.pin.id)}
              onContextMenu={(event) => {
                // 다른 곳과 같이 우클릭은 메뉴(가기·이름 바꾸기·빼기). 이름 고치기는 두 번 누르기로도 된다
                event.preventDefault()
                setPinMenu({ placed, x: event.clientX, y: event.clientY })
              }}
            >
              <span className="pdf-pin-name">{placed.pin.title}</span>
              <PinHead emoji={placed.pin.emoji} />
            </button>
          ))}
      {pinMenu === null ? null : (
        <ContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          label={t('책갈피 {title}', { title: pinMenu.placed.pin.title })}
          onClose={() => setPinMenu(null)}
          entries={[
            { key: 'jump', icon: <ArrowSquareIn size={15} />, label: t('이 위치로 이동'), onSelect: () => onJump(pinMenu.placed.target) },
            ...(onUpdate === undefined ? [] : [{ key: 'rename', icon: <PencilSimple size={15} />, label: t('이름 바꾸기'), onSelect: () => onEdit(pinMenu.placed.pin.id) }]),
            ...(onRemove === undefined ? [] : [
              { key: 'sep', separator: true as const },
              { key: 'remove', icon: <Trash size={15} />, label: t('핀 빼기'), danger: true, onSelect: () => onRemove(pinMenu.placed.pin.id) },
            ]),
          ]}
        />
      )}
    </div>
  )
}

export function PinHead({ emoji }: { readonly emoji?: string | undefined }) {
  return (
    <span className="pdf-pin-head" aria-hidden="true">
      {emoji === undefined ? <PushPin size={13} weight="fill" /> : emoji}
    </span>
  )
}

function PinEditor({ placed, onUpdate, onRemove, onDone }: {
  readonly placed: PlacedPin
  readonly onUpdate: (id: string, patch: PdfPinPatchInput) => void
  readonly onRemove?: ((id: string) => void) | undefined
  readonly onDone: () => void
}) {
  const { pin } = placed
  const [title, setTitle] = useState(pin.title)
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    if (title.trim() !== '' && title !== pin.title) onUpdate(pin.id, { title })
    onDone()
  }
  return (
    <div
      ref={rootRef}
      className="pdf-pin-editor"
      style={{ top: `${placed.y}px` }}
      role="group"
      aria-label={t('책갈피 핀 고치기')}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        // 이모지 고르는 창으로 가거나 편집 칸 안에서 옮겨 가는 것은 끝내는 게 아니다
        if (picker !== null) return
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
        commit()
      }}
    >
      <button
        type="button"
        className="pdf-pin-editor-emoji"
        aria-label={t('핀 이모지 고르기')}
        title={t('이모지')}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPicker({ x: rect.left, y: rect.bottom + 4 })
        }}
      >
        <PinHead emoji={pin.emoji} />
      </button>
      <input
        ref={inputRef}
        className="pdf-pin-editor-name"
        aria-label={t('핀 이름')}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            doneRef.current = true
            onDone()
          }
        }}
      />
      {onRemove !== undefined ? (
        <button
          type="button"
          className="pdf-pin-editor-remove"
          aria-label={t('핀 빼기')}
          title={t('핀 빼기')}
          onClick={() => {
            doneRef.current = true
            onRemove(pin.id)
            onDone()
          }}
        >
          <Trash size={13} aria-hidden="true" />
        </button>
      ) : null}
      {picker !== null ? (
        <Suspense fallback={null}>
          <LazyEmojiPicker
            anchor={picker}
            current={pin.emoji}
            onSelect={(emoji) => {
              onUpdate(pin.id, { emoji })
              setPicker(null)
              inputRef.current?.focus()
            }}
            onRemove={() => {
              onUpdate(pin.id, { emoji: null })
              setPicker(null)
              inputRef.current?.focus()
            }}
            onClose={() => {
              setPicker(null)
              inputRef.current?.focus()
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
