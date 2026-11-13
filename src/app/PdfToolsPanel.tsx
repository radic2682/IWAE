import type { ReactNode } from 'react'
import { ArrowSquareOut, CaretDown, CaretRight, FilePdf, Toolbox } from '@phosphor-icons/react'
import { PDF_TOOL_GROUPS, type PdfToolViewId } from './PdfToolsDialog'
import { t } from '../i18n'
import { Collapse } from './Collapse'

interface PdfToolsPanelProps {
  /** 도구를 쓸 PDF 의 제목. 열린 PDF 가 없으면 null */
  readonly docTitle: string | null
  /** 지금 펼쳐 둔 도구 */
  readonly activeTool: PdfToolViewId | null
  readonly onPick: (tool: PdfToolViewId) => void
  /** 펼친 도구 줄 아래에 놓을 도구 화면. null 이면 줄만 켜진다(PDF 창 자리를 쓰는 쪽 편집처럼) */
  readonly renderTool?: (tool: PdfToolViewId) => ReactNode
}

/**
 * 왼쪽 바 「PDF 도구」 보기. 도구 줄을 누르면 그 줄 아래로 도구의 옵션이 펼쳐진다(한 번에 하나).
 * 같은 줄을 다시 누르면 접는다. PDF 는 그대로 보인다.
 */
export function PdfToolsPanel({ docTitle, activeTool, onPick, renderTool }: PdfToolsPanelProps) {
  const disabled = docTitle === null
  return (
    <div className="side-tools-panel">
      <div className="side-panel-head side-tools-head">
        <Toolbox className="side-section-icon" size={15} aria-hidden="true" />
        <span className="side-tools-title">{t('PDF 도구')}</span>
      </div>
      <nav className="pdf-tools-list" aria-label={t('도구')}>
        {disabled ? (
          <div className="side-panel-empty">{t('열린 PDF가 없습니다')}</div>
        ) : (
          <div className="pdf-tools-target" title={docTitle}>
            <FilePdf size={14} aria-hidden="true" />
            <span>{docTitle}</span>
          </div>
        )}
        {PDF_TOOL_GROUPS.map((group) => (
          <div key={group.title} className="pdf-tools-group">
            <div className="pdf-tools-group-title">{t(group.title)}</div>
            {group.tools.map((item) => {
              const open = item.id === activeTool
              const body = open && renderTool !== undefined ? renderTool(item.id) : null
              return (
                <div key={item.id} className={`pdf-tools-entry${body !== null ? ' pdf-tools-entry-open' : ''}`}>
                  <button
                    type="button"
                    className={`pdf-tools-item${open ? ' pdf-tools-item-on' : ''}`}
                    title={t(item.label)}
                    aria-current={open ? 'true' : undefined}
                    aria-expanded={body === null ? undefined : true}
                    disabled={disabled}
                    onClick={() => onPick(item.id)}
                  >
                    <span className="pdf-tools-item-icon" aria-hidden="true">{item.icon}</span>
                    <span className="pdf-tools-item-label">{t(item.label)}</span>
                    <span className="pdf-tools-item-trail" aria-hidden="true">
                      {item.id === 'pageEdit' ? <ArrowSquareOut size={13} /> : open ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
                    </span>
                  </button>
                  <Collapse open={body !== null}><div className="pdf-tools-body">{body}</div></Collapse>
                </div>
              )
            })}
          </div>
        ))}
      </nav>
    </div>
  )
}

