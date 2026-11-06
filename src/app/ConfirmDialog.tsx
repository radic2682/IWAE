import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { WarningCircle } from '@phosphor-icons/react'
import '../ui/confirm-dialog.css'
import { t } from '../i18n'

interface ConfirmDialogProps {
  readonly title: string
  readonly children?: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  /** danger: 되돌릴 수 없는 일(지우기) — 확인 단추가 빨갛고, 처음 초점은 취소에 간다 */
  readonly tone?: 'default' | 'danger'
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * 앱 안 확인 창. window.confirm 은 웹뷰 바깥 모양이라 앱과 어울리지 않고 테마도 따르지 않는다.
 * Esc 는 이 창만 닫는다(뒤의 설정 창까지 닫지 않게 이벤트를 멈춘다).
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = t('취소'), tone = 'default', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ;(tone === 'danger' ? cancelButton : confirmButton).current?.focus()
  }, [tone])
  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        className={`confirm-dialog confirm-dialog-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          if (!busy) onCancel()
        }}
      >
        <div className="confirm-dialog-head">
          {tone === 'danger' ? <span className="confirm-dialog-mark"><WarningCircle size={18} weight="fill" aria-hidden="true" /></span> : null}
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
        {children !== undefined ? <div className="confirm-dialog-body">{children}</div> : null}
        <div className="confirm-dialog-actions">
          <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button ref={confirmButton} type="button" className="confirm-dialog-confirm" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    // 설정 창 안의 제목(h3) 같은 곳에서 열려도 글꼴·굵기를 물려받지 않게 body 에 띄운다
    document.body,
  )
}
