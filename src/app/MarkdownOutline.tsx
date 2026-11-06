import { useMemo } from 'react'
import { t } from '../i18n'

/** Markdown 원문의 제목(# … ######) 목록. 코드 블록 안의 # 은 뺀다 */
export function markdownHeadings(source: string): { title: string; depth: number }[] {
  const out: { title: string; depth: number }[] = []
  let inFence = false
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (match !== null) out.push({ depth: match[1]!.length, title: match[2]!.replace(/[*_`]/gu, '') })
  }
  return out
}

/**
 * 왼쪽 바 「목차」의 Markdown 판: 제목을 깊이대로 들여 보이고, 누르면 그 절로 간다.
 * 아래 막대·스크롤바의 절 차례와 같다(h1–h3 만 절로 센다).
 */
export function MarkdownOutline({ source, currentSection, onSelectSection }: {
  readonly source: string
  /** 지금 절(h1–h3 차례) */
  readonly currentSection: number
  readonly onSelectSection: (index: number) => void
}) {
  const headings = useMemo(() => markdownHeadings(source), [source])
  let sectionIndex = -1
  return (
    <nav className="side-outline markdown-outline" aria-label={t('Markdown 목차')}>
      {headings.length === 0 ? <p className="side-outline-empty">{t('제목이 없습니다.')}</p> : (
        <ul>
          {headings.map((heading, index) => {
            const isSection = heading.depth <= 3
            if (isSection) sectionIndex += 1
            const target = sectionIndex
            return (
              <li key={`${index}:${heading.title}`}>
                <button
                  type="button"
                  className={`markdown-outline-item${isSection && target === currentSection ? ' markdown-outline-current' : ''}`}
                  style={{ paddingLeft: `${8 + (heading.depth - 1) * 12}px` }}
                  onClick={() => onSelectSection(Math.max(target, 0))}
                >
                  {heading.title}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

/** 절 미리보기용: h1–h3 로 나눈 절마다 제목과 첫 몇 줄(표·코드 기호는 걷어 낸다) */
export function markdownSectionPreviews(source: string, lines = 4): { title: string; depth: number; excerpt: string }[] {
  const out: { title: string; depth: number; excerpt: string[] }[] = []
  let inFence = false
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence
      continue
    }
    const heading = inFence ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading !== null) {
      out.push({ title: heading[2]!.replace(/[*_`]/gu, ''), depth: heading[1]!.length, excerpt: [] })
      continue
    }
    const current = out.at(-1)
    const text = line.replace(/^[#>\-*+|\s]+|[|*_`]/gu, ' ').replace(/\s+/gu, ' ').trim()
    if (current !== undefined && text !== '' && current.excerpt.length < lines && !/^[-:| ]+$/u.test(line.trim())) current.excerpt.push(text)
  }
  return out.map((item) => ({ title: item.title, depth: item.depth, excerpt: item.excerpt.join(' ') }))
}

/** 왼쪽 바 「미리보기」의 Markdown 판: 절마다 작은 종이 카드(제목 + 첫 줄들). 누르면 그 절로 */
export function MarkdownSectionPreview({ source, currentSection, onSelectSection }: {
  readonly source: string
  readonly currentSection: number
  readonly onSelectSection: (index: number) => void
}) {
  const sections = useMemo(() => markdownSectionPreviews(source), [source])
  return (
    <div className="markdown-section-preview" aria-label={t('Markdown 절 미리보기')}>
      {sections.length === 0 ? <p className="side-outline-empty">{t('제목이 없습니다.')}</p> : sections.map((section, index) => (
        <button
          key={`${index}:${section.title}`}
          type="button"
          className={`markdown-section-card${index === currentSection ? ' markdown-section-card-current' : ''}`}
          onClick={() => onSelectSection(index)}
        >
          <span className="markdown-section-card-paper">
            <strong className={`markdown-section-card-title markdown-section-card-h${section.depth}`}>{section.title}</strong>
            <span className="markdown-section-card-text">{section.excerpt}</span>
          </span>
          <span className="markdown-section-card-number">{index + 1}</span>
        </button>
      ))}
    </div>
  )
}
