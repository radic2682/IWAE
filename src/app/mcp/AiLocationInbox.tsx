import { ArrowRight, Robot, X } from '@phosphor-icons/react'
import type { AiLocation } from '../../bridge/ai'
import { t } from '../../i18n'
import '../../ui/ai-inbox.css'

const VISIBLE = 5

interface AiLocationInboxProps {
  readonly items: readonly AiLocation[]
  readonly docTitles: Readonly<Record<string, string>>
  readonly onOpen: (item: AiLocation) => void
  readonly onDismiss: (id: string) => void
}

/**
 * 바깥 AI(Claude Code 등)가 `show_location` 으로 보낸 자리. 사용자가 터미널에서 일하는
 * 동안 들어올 수 있어서 저절로 사라지지 않는다 — 누르거나 닫을 때까지 남는다.
 */
export function AiLocationInbox({ items, docTitles, onOpen, onDismiss }: AiLocationInboxProps) {
  if (items.length === 0) return null
  const shown = items.slice(0, VISIBLE)
  const hidden = items.length - shown.length
  return (
    <div className="ai-inbox" aria-label={t('AI가 보낸 위치')}>
      {shown.map((item) => (
        <div key={item.id} className="ai-inbox-card" role="alert">
          <div className="ai-inbox-head">
            <Robot size={14} aria-hidden="true" />
            <span>{t('AI가 위치를 보냈습니다')}</span>
            <button type="button" className="ai-inbox-close" aria-label={t('닫기')} onClick={() => onDismiss(item.id)}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="ai-inbox-target">
            <strong>{docTitles[item.docId] ?? t('알 수 없는 문서')}</strong>
            <span>p.{item.page}</span>
          </div>
          {item.message ? <p className="ai-inbox-message">{item.message}</p> : null}
          {item.quote && !item.message ? <p className="ai-inbox-message">“{item.quote}”</p> : null}
          <button type="button" className="ai-inbox-open" onClick={() => onOpen(item)}>
            {t('이동')}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      {hidden > 0 ? <div className="ai-inbox-more">+{hidden}</div> : null}
    </div>
  )
}
