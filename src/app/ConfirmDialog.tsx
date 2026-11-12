import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { WarningCircle } from '@phosphor-icons/react'
import '../ui/confirm-dialog.css'
import { t } from '../i18n'
import { useFocusTrap } from '../ui/useFocusTrap'

interface ConfirmDialogProps {
  readonly title: string
  readonly children?: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  /** danger: 되돌릴 수 없는 일(지우기) — 확인 단추가 빨갛고, 처음 초점은 취소에 간다 */
  readonly tone?: 'default' | 'danger'
  readonly busy?: boolean
  /** 취소와 확인 사이에 하나 더 두는 단추(세 갈래 선택) */
  readonly extra?: { readonly label: string; readonly onClick: () => void }
  /** 고르기 전에는 닫히지 않는다: Esc·바깥 누르기가 아무 일도 하지 않는다(데이터가 걸린 선택) */
  readonly locked?: boolean
  /** 취소 단추를 그리지 않는다(알림만 하는 창). Esc·바깥 누르기는 그대로 onCancel */
  readonly hideCancel?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * 앱 안 확인 창. window.confirm 은 웹뷰 바깥 모양이라 앱과 어울리지 않고 테마도 따르지 않는다.
 * Esc 는 이 창만 닫는다(뒤의 설정 창까지 닫지 않게 이벤트를 멈춘다).
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = t('취소'), tone = 'default', busy = false, extra, locked = false, hideCancel = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)
  useEffect(() => {
    ;(tone === 'danger' ? cancelButton : confirmButton).current?.focus()
  }, [tone])
  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !locked) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className={`confirm-dialog confirm-dialog-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          if (!busy && !locked) onCancel()
        }}
      >
        <div className="confirm-dialog-head">
          {tone === 'danger' ? <span className="confirm-dialog-mark"><WarningCircle size={18} weight="fill" aria-hidden="true" /></span> : null}
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
        {children !== undefined ? <div className="confirm-dialog-body">{children}</div> : null}
        <div className="confirm-dialog-actions">
          {hideCancel ? null : <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>}
          {extra !== undefined ? <button type="button" disabled={busy} onClick={extra.onClick}>{extra.label}</button> : null}
          <button ref={confirmButton} type="button" className="confirm-dialog-confirm" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    // 설정 창 안의 제목(h3) 같은 곳에서 열려도 글꼴·굵기를 물려받지 않게 body 에 띄운다
    document.body,
  )
}
