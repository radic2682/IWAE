import { useMemo, useState, type CSSProperties } from 'react'
import { CaretDown, CaretRight, X } from '@phosphor-icons/react'
import { t } from '../../i18n'
import { PreviewColumnsSwitch, usePreviewColumns } from '../sidebar/SidePanels'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { DocumentFormat } from '../../core/documentFormat'
import { flowHeadings, flowSectionPreviews } from '../../core/flowRender'
import { markdownHeadings, markdownSectionPreviews } from '../../core/markdownHeadings'

// 예전 위치에서 쓰던 이름을 그대로 내보낸다(순수 함수는 core 로 옮겼다)
export { markdownHeadings, markdownSectionPreviews }

/** 제목마다 절 번호(h1–h3 만 절로 센다 — 아래 막대·스크롤바와 같은 차례). h4 이하는 앞 절에 속한다 */
function headingsWithSections(source: string, format: DocumentFormat) {
  let section = -1
  return flowHeadings(format, source).map((heading) => {
    if (heading.depth <= 3) section += 1
    return { ...heading, section: Math.max(section, 0), isSection: heading.depth <= 3 }
  })
}

/**
 * 왼쪽 바 「목록」의 Markdown 판 — PDF 목차와 같은 모양: 「목차」 제목 아래 제목 줄들, 그 아래 「책갈피」.
 * 누르면 그 절로 간다.
 */
export function MarkdownOutline({ source, format = 'markdown', currentSection, onSelectSection, bookmarks = [], onSelectBookmark, onRemoveBookmark }: {
  readonly source: string
  /** 문서 형식(HTML 은 그린 본문에서, 그 밖에는 원문에서 제목을 읽는다) */
  readonly format?: DocumentFormat
  /** 지금 절(h1–h3 차례) */
  readonly currentSection: number
  readonly onSelectSection: (index: number) => void
  readonly bookmarks?: readonly PdfBookmark[]
  readonly onSelectBookmark?: (bookmark: PdfBookmark) => void
  readonly onRemoveBookmark?: (bookmark: PdfBookmark) => void
}) {
  const headings = useMemo(() => headingsWithSections(source, format), [source, format])
  const minDepth = headings.length === 0 ? 1 : Math.min(...headings.map((heading) => heading.depth))
  return (
    <div className="side-scroll markdown-outline">
      <section className="outline-section" aria-labelledby="md-outline-section-title">
        <div className="outline-section-head">
          <h2 id="md-outline-section-title" className="side-panel-section-title">{t('목차')}</h2>
        </div>
        {headings.length === 0 ? <div className="side-panel-empty side-panel-empty-inline">{t('이 문서에는 제목이 없습니다')}</div> : (
          <div className="outline-list">
            {headings.map((heading, index) => {
              const current = heading.isSection && heading.section === currentSection
              return (
                <div
                  key={`${index}:${heading.title}`}
                  className={['outline-row', current ? 'outline-row-current' : ''].filter(Boolean).join(' ')}
                  style={{ '--outline-depth': heading.depth - minDepth } as CSSProperties}
                >
                  <span className="outline-toggle-space" aria-hidden="true" />
                  <button
                    type="button"
                    className="outline-item"
                    aria-current={current ? 'location' : undefined}
                    onClick={() => onSelectSection(heading.section)}
                  >
                    <span className="outline-title">{heading.title}</span>
                    {heading.isSection ? <span className="outline-page">{t('{count}절', { count: heading.section + 1 })}</span> : null}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
      <section className="outline-section bookmark-section" aria-labelledby="md-bookmark-section-title">
        <div className="outline-section-head bookmark-section-head">
          <h2 id="md-bookmark-section-title" className="side-panel-section-title">{t('책갈피')}</h2>
        </div>
        {bookmarks.length === 0 ? (
          <div className="side-panel-empty side-panel-empty-inline">{t('책갈피가 없습니다')}</div>
        ) : (
          <div className="outline-list bookmark-list">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="bookmark-row">
                <button type="button" className="outline-item bookmark-item" onClick={() => onSelectBookmark?.(bookmark)}>
                  <span className="outline-title">{bookmark.emoji === undefined ? null : <span className="bookmark-emoji" aria-hidden="true">{bookmark.emoji} </span>}{bookmark.title}</span>
                  <span className="outline-page">{`${Math.round((bookmark.y ?? 0) * 100)}%`}</span>
                </button>
                {onRemoveBookmark === undefined ? null : (
                  <button type="button" className="bookmark-remove" aria-label={t('{title} 책갈피 지우기', { title: bookmark.title })} onClick={() => onRemoveBookmark(bookmark)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** 절 하나의 축소판: PDF 쪽 축소판과 같은 틀(종이 비율 · 번호)에 그 절의 제목과 첫 줄들 */
function SectionThumb({ section, index, current, onSelect }: {
  readonly section: { title: string; depth: number; excerpt: string }
  readonly index: number
  readonly current: boolean
  readonly onSelect: (index: number) => void
}) {
  return (
    <button
      type="button"
      className={current ? 'thumb-item thumb-item-current' : 'thumb-item'}
      aria-current={current ? 'page' : undefined}
      aria-label={t('{count}절 {title}', { count: index + 1, title: section.title })}
      onClick={() => onSelect(index)}
    >
      <span className="thumb-frame md-thumb-frame" style={{ aspectRatio: '1 / 1.414' }}>
        <span className="md-thumb-paper">
          <strong className={`md-thumb-title md-thumb-h${section.depth}`}>{section.title}</strong>
          <span className="md-thumb-text">{section.excerpt}</span>
        </span>
      </span>
      <span className="thumb-num">{index + 1}</span>
    </button>
  )
}

/** 왼쪽 바 「미리보기」의 Markdown 판 — PDF 미리보기와 같은 모양: 위에 「n절」과 1단·2단, 아래 축소판 격자 */
export function MarkdownSectionPreview({ source, format = 'markdown', currentSection, onSelectSection }: {
  readonly source: string
  readonly format?: DocumentFormat
  readonly currentSection: number
  readonly onSelectSection: (index: number) => void
}) {
  const sections = useMemo(() => flowSectionPreviews(format, source), [source, format])
  const [columns, setColumns] = usePreviewColumns()
  return (
    <div className="side-scroll thumb-panel md-section-preview" aria-label={t('Markdown 절 미리보기')} style={{ '--preview-columns': columns } as CSSProperties}>
      <div className="outline-preview-bar thumb-panel-bar">
        <span className="thumb-panel-count">{t('{count}절', { count: sections.length })}</span>
        <PreviewColumnsSwitch columns={columns} onChange={setColumns} />
      </div>
      {sections.length === 0 ? <div className="side-panel-empty side-panel-empty-inline">{t('이 문서에는 제목이 없습니다')}</div> : (
        <div className="thumb-grid">
          {sections.map((section, index) => (
            <SectionThumb key={`${index}:${section.title}`} section={section} index={index} current={index === currentSection} onSelect={onSelectSection} />
          ))}
        </div>
      )}
    </div>
  )
}
