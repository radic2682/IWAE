import { ArrowCounterClockwise, Robot, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { aiChangeViews, hasUndoableAiChange, subscribeAiChanges, undoAllAiChanges, type AiChangeView } from './mcp/aiChangeLog'
import { useAiActivity } from './mcp/aiActivityStore'
import '../ui/ai-inbox.css'

/**
 * 상단바의 「AI가 편집 중」 알약. 바깥 AI(MCP)가 쓰는 동안 켜지고 마지막 요청 3초 뒤에 사라진다.
 * 누르면 AI 가 한 변경 목록과 「모두 되돌리기」가 열린다(여는 동안은 알약이 남는다).
 */
export function AiActivityPill() {
  const activity = useAiActivity()
  const [open, setOpen] = useState(false)
  const [changes, setChanges] = useState<readonly AiChangeView[]>(() => aiChangeViews())
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeAiChanges(() => setChanges(aiChangeViews())), [])
  // 목록은 열 때마다 새로 읽는다(사람이 고쳐서 되돌릴 수 없게 된 것도 보이게)
  useEffect(() => { if (open) setChanges(aiChangeViews()) }, [open, activity])
  if (!activity.active && !open) return null
  const label = activity.target === ''
    ? t('AI가 작업 중 ({count}개 변경)', { count: activity.changes })
    : t('AI가 편집 중: {target} ({count}개 변경)', { target: activity.target, count: activity.changes })
  const undoAll = () => {
    setBusy(true)
    void undoAllAiChanges().finally(() => {
      setBusy(false)
      setChanges(aiChangeViews())
    })
  }
  return (
    <div className="ai-pill-wrap">
      <button
        type="button"
        className="ai-pill"
        data-active={activity.active}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <Robot size={13} weight="fill" aria-hidden="true" />
        <span className="ai-pill-text">{label}</span>
      </button>
      {open ? (
        <div className="ai-changes" role="dialog" aria-label={t('AI가 한 변경')}>
          <div className="ai-changes-head">
            <strong>{t('AI가 한 변경')}</strong>
            <button type="button" className="ai-inbox-close" aria-label={t('닫기')} onClick={() => setOpen(false)}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          {changes.length === 0 ? <p className="ai-changes-empty">{t('아직 AI가 한 변경이 없습니다')}</p> : (
            <ol className="ai-changes-list">
              {changes.slice(0, 50).map((change) => (
                <li key={change.seq} className={change.undone ? 'ai-change ai-change-undone' : 'ai-change'}>
                  <span className="ai-change-summary">{change.summary}</span>
                  {change.undone ? <span className="ai-change-tag">{t('되돌림')}</span> : change.edited_since ? <span className="ai-change-tag">{t('사람이 고침')}</span> : null}
                </li>
              ))}
            </ol>
          )}
          <button type="button" className="ai-changes-undo" disabled={busy || !hasUndoableAiChange()} onClick={undoAll}>
            <ArrowCounterClockwise size={13} aria-hidden="true" />
            {t('모두 되돌리기')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
