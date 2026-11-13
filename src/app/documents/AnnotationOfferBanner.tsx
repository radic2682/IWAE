import { Highlighter, X } from '@phosphor-icons/react'
import { t } from '../../i18n'
import '../../ui/notice-stack.css'

interface AnnotationOfferBannerProps {
  /** PDF 안에서 찾은 표시 수 */
  readonly count: number
  readonly onImport: () => void
  readonly onDismiss: () => void
}

/**
 * PDF 를 열었더니 다른 프로그램에서 단 형광펜·밑줄·쪽지가 들어 있을 때 한 번만 권하는 작은 알림.
 * 오른쪽 아래 알림 줄기의 카드 모양을 쓴다.
 */
export function AnnotationOfferBanner({ count, onImport, onDismiss }: AnnotationOfferBannerProps) {
  const title = t('이 PDF에 다른 프로그램에서 만든 주석이 {count}개 있습니다', { count })
  return (
    <aside className="notice-card" aria-label={title} aria-live="polite">
      <div className="notice-mark"><Highlighter size={16} weight="bold" aria-hidden="true" /></div>
      <div className="notice-copy">
        <strong>{title}</strong>
        <span>{t('내 형광펜과 메모로 가져올 수 있습니다. PDF 파일은 바뀌지 않습니다.')}</span>
      </div>
      <button type="button" className="notice-close" aria-label={t('나중에')} onClick={onDismiss}><X size={14} aria-hidden="true" /></button>
      <div className="notice-actions">
        <button type="button" className="notice-primary" onClick={onImport}>{t('가져오기')}</button>
      </div>
    </aside>
  )
}
