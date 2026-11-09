import { Eraser, Highlighter } from '@phosphor-icons/react'
import { t } from '../i18n'
import { useHighlightTool } from './highlightToolStore'
import type { PdfHighlightColor } from './persistentHighlight'
import { DocFormatStrip, StripSep, StripToggle } from './PdfOverlayPalette'

export const HIGHLIGHT_COLORS: readonly PdfHighlightColor[] = ['yellow', 'green', 'blue', 'pink']

const COLOR_LABEL: Record<PdfHighlightColor, string> = { yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍' }

/**
 * 문서 도구줄의 형광펜(PDF·Markdown 공통): 누르면 형광펜 모드. 색과 지우개는 다른 도구처럼
 * 도구줄 아래 서식 띠(HighlighterStrip)에 나온다.
 */
export function HighlighterToolbarControl({ active, onActiveChange, buttonClassName }: {
  readonly active: boolean
  readonly onActiveChange: (active: boolean) => void
  readonly buttonClassName: string
}) {
  const [, setTool] = useHighlightTool()
  return (
    <div className="pane-highlighter" role="group" aria-label={t('형광펜')}>
      <button
        type="button"
        className={`${buttonClassName}${active ? ' toolbar-tool-btn-active' : ''}`}
        aria-label={t('형광펜')}
        title={t('형광펜')}
        aria-pressed={active}
        onClick={(event) => {
          event.currentTarget.blur()
          if (active) setTool({ erase: false })
          onActiveChange(!active)
        }}
      >
        <Highlighter size={17} weight={active ? 'bold' : 'regular'} aria-hidden="true" />
      </button>
    </div>
  )
}

/** 형광펜 서식 띠: 색 넷 + 형광펜 지우개 */
export function HighlighterStrip({ onDone }: { readonly onDone: () => void }) {
  const [tool, setTool] = useHighlightTool()
  return (
    <DocFormatStrip
      icon={<Highlighter size={15} aria-hidden="true" />}
      label={t('형광펜')}
      onClose={() => { setTool({ erase: false }); onDone() }}
      hint={tool.erase ? t('형광펜을 누르면 지웁니다') : t('글을 끌면 칠합니다')}
    >
      <span className="doc-strip-swatches" role="group" aria-label={t('형광펜 색상')}>
        {HIGHLIGHT_COLORS.map((value) => (
          <button
            key={value}
            type="button"
            className={`doc-strip-swatch pane-highlighter-color-${value}${!tool.erase && tool.color === value ? ' doc-strip-swatch-on' : ''}`}
            aria-label={t('{color} 형광펜', { color: t(COLOR_LABEL[value]) })}
            title={t(COLOR_LABEL[value])}
            aria-pressed={!tool.erase && tool.color === value}
            onClick={() => setTool({ color: value, erase: false })}
          />
        ))}
      </span>
      <StripSep />
      <StripToggle on={tool.erase} label={t('형광펜 지우개')} onChange={(erase) => setTool({ erase })}>
        <Eraser size={15} weight={tool.erase ? 'fill' : 'regular'} aria-hidden="true" />
      </StripToggle>
    </DocFormatStrip>
  )
}
