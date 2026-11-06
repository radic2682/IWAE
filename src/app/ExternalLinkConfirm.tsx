import { t } from '../i18n'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { externalLinkHost } from '../bridge/external'
import '../ui/external-link.css'

interface ExternalLinkConfirmProps {
  readonly url: string
  readonly onOpen: (url: string) => void
  readonly onCancel: () => void
}

/**
 * PDF 안 외부 링크를 열기 전의 확인. 링크 글자와 실제 주소가 다를 수 있어서(문서에
 * "doi.org" 라고 적고 다른 곳을 가리키는 경우) 주소 전체와 호스트를 따로 보여 준다.
 */
export function ExternalLinkConfirm({ url, onOpen, onCancel }: ExternalLinkConfirmProps) {
  return (
    <div className="external-link-backdrop" onClick={onCancel}>
      <div
        className="external-link-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('외부 링크 열기')}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <p className="external-link-title">
          <ArrowSquareOut size={16} aria-hidden="true" />
          <strong>{externalLinkHost(url)}</strong>
        </p>
        <p className="external-link-url">{url}</p>
        <div className="external-link-actions">
          <button type="button" onClick={onCancel}>{t('취소')}</button>
          <button type="button" className="external-link-open" autoFocus onClick={() => onOpen(url)}>
            {t('브라우저에서 열기')}
          </button>
        </div>
      </div>
    </div>
  )
}
