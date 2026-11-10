import { Toolbox } from '@phosphor-icons/react'
import { PDF_TOOL_GROUPS, type PdfToolViewId } from './PdfToolsDialog'
import { t } from '../i18n'

interface PdfToolsPanelProps {
  /** 도구를 쓸 PDF 의 제목. 열린 PDF 가 없으면 null */
  readonly docTitle: string | null
  /** 지금 PDF 창에 펼쳐 둔 도구 */
  readonly activeTool: PdfToolViewId | null
  readonly onPick: (tool: PdfToolViewId) => void
}

/**
 * 왼쪽 바 「PDF 도구」 보기. 도구를 고르면 팝업이 아니라 지금 PDF 창 자리에 그 도구 화면이 펼쳐진다.
 * 같은 도구를 다시 누르면 접고 PDF 로 돌아간다.
 */
export function PdfToolsPanel({ docTitle, activeTool, onPick }: PdfToolsPanelProps) {
  const disabled = docTitle === null
  return (
    <div className="side-scroll side-tools-panel">
      <div className="side-panel-head side-tools-head">
        <Toolbox size={15} aria-hidden="true" />
        <span className="side-tools-title">{t('PDF 도구')}</span>
        <span className="side-tools-doc" title={docTitle ?? undefined}>{docTitle ?? ''}</span>
      </div>
      {disabled ? <div className="side-panel-empty">{t('열린 PDF 가 없습니다')}</div> : null}
      <nav className="pdf-tools-list" aria-label={t('도구')}>
        {PDF_TOOL_GROUPS.map((group) => (
          <div key={group.title} className="pdf-tools-group">
            <div className="pdf-tools-group-title">{t(group.title)}</div>
            {group.tools.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pdf-tools-item${item.id === activeTool ? ' pdf-tools-item-on' : ''}`}
                aria-current={item.id === activeTool ? 'true' : undefined}
                disabled={disabled}
                onClick={() => onPick(item.id)}
              >
                <span className="pdf-tools-item-icon" aria-hidden="true">{item.icon}</span>
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </div>
  )
}
