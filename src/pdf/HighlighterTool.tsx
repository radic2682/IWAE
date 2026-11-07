import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Highlighter } from '@phosphor-icons/react'
import { t } from '../i18n'
import { useHighlightTool } from './highlightToolStore'
import type { PdfHighlightColor } from './persistentHighlight'

export const HIGHLIGHT_COLORS: readonly PdfHighlightColor[] = ['yellow', 'green', 'blue', 'pink']

const COLOR_LABEL: Record<PdfHighlightColor, string> = { yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍' }

/**
 * 문서 도구줄의 형광펜(PDF·Markdown 공통): 누르면 형광펜 모드, 형광펜 모드인 동안 도구줄 바로 아래에 색 넷과 지우개가 떠 있다.
 * 지우개를 켜면 형광펜을 눌러 지운다.
 */
export function HighlighterToolbarControl({ active, onActiveChange, buttonClassName }: {
  readonly active: boolean
  readonly onActiveChange: (active: boolean) => void
  readonly buttonClassName: string
}) {
  const [tool, setTool] = useHighlightTool()
  // 색 고르개는 도구줄(넘치면 잘라 내는 줄) 밖, 형광펜 단추 바로 아래 가운데에 띄운다
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!active) { setPlace(null); return undefined }
    const measure = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      const bar = buttonRef.current?.closest('.pane-frame-with-toolbar, .pane-frame')?.querySelector('.pane-toolbar')?.getBoundingClientRect()
      if (rect !== undefined) setPlace({ left: rect.left + rect.width / 2, top: Math.max(rect.bottom, bar?.bottom ?? rect.bottom) + 8 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])
  return (
    <div className="pane-highlighter" role="group" aria-label={t('형광펜')}>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClassName}${active ? ' toolbar-tool-btn-active' : ''}`}
        aria-label={t('형광펜')}
        title={t('형광펜')}
        aria-pressed={active}
        onClick={() => {
          if (active) setTool({ erase: false })
          onActiveChange(!active)
        }}
      >
        <Highlighter size={17} weight={active ? 'bold' : 'regular'} aria-hidden="true" />
      </button>
      {active && place !== null ? createPortal(
        <div className="pane-highlighter-palette pane-highlighter-floating" role="group" aria-label={t('형광펜 색상')} style={{ left: place.left, top: place.top }}>
          {HIGHLIGHT_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className={`pane-highlighter-color pane-highlighter-color-${value}`}
              aria-label={t('{color} 형광펜', { color: t(COLOR_LABEL[value]) })}
              title={t(COLOR_LABEL[value])}
              aria-pressed={!tool.erase && tool.color === value}
              onClick={() => setTool({ color: value, erase: false })}
            />
          ))}
          <button
            type="button"
            className={`${buttonClassName} pane-highlighter-eraser${tool.erase ? ' toolbar-tool-btn-active' : ''}`}
            aria-label={t('형광펜 지우개')}
            title={t('형광펜 지우개')}
            aria-pressed={tool.erase}
            onClick={() => setTool({ erase: !tool.erase })}
          >
            <Eraser size={16} weight={tool.erase ? 'fill' : 'regular'} aria-hidden="true" />
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
