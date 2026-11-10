import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { DotsSixVertical, Plus, X } from '@phosphor-icons/react'
import {
  MAX_HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_NAME_LENGTH,
  addHighlightColor,
  colorNameOrDefault,
  highlightColorDisplayName,
  moveHighlightColor,
  recolorHighlightColor,
  removeHighlightColor,
  renameHighlightColor,
  type HighlightColorDef,
} from '../core/highlightColors'
import { t } from '../i18n'
import { setAppPref } from './appPrefs'
import { useHighlightColors } from './highlightColorStyle'
import { useHighlightColorUsage } from './highlightColorUsage'
import '../ui/highlight-colors.css'

function save(next: readonly HighlightColorDef[]): void {
  setAppPref('highlightColors', next)
}

/**
 * 설정 > 화면 테마 > 「형광펜 색」.
 * 색 하나(대표 색)를 고르면 본문 표시·카드 탭·테두리·연결선은 자동으로 만들어진다.
 * 바꾼 것은 저장 즉시 모든 창에 번진다(appPrefs → <style id="iwae-highlight-colors">).
 */
export function HighlightColorSettings() {
  const colors = useHighlightColors()
  const usage = useHighlightColorUsage()
  const listRef = useRef<HTMLDivElement>(null)
  const pickerRefs = useRef(new Map<string, HTMLInputElement>())
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; from: number; to: number } | null>(null)

  const openPicker = (id: string) => {
    const input = pickerRefs.current.get(id)
    if (input === undefined) return
    try { input.showPicker() } catch { input.click() }
  }

  const requestRemove = (id: string) => {
    if ((usage.get(id) ?? 0) > 0) setConfirmId(id)
    else save(removeHighlightColor(colors, id))
  }

  const rowIndexAt = (clientY: number): number => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-hlc-row]')
    if (rows === undefined || rows.length === 0) return 0
    let best = 0
    rows.forEach((row, index) => {
      const box = row.getBoundingClientRect()
      if (clientY >= box.top + box.height / 2) best = index
    })
    return best
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id, from: index, to: index })
  }
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag === null) return
    const to = rowIndexAt(event.clientY)
    if (to !== drag.to) setDrag({ ...drag, to })
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.to !== drag.from) save(moveHighlightColor(colors, drag.from, drag.to))
    setDrag(null)
  }
  const gripKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (delta === 0) return
    event.preventDefault()
    save(moveHighlightColor(colors, index, index + delta))
    // 순서가 바뀐 뒤에도 같은 손잡이에 초점이 남게 한다
    const grips = listRef.current?.querySelectorAll<HTMLButtonElement>('.hlc-grip')
    requestAnimationFrame(() => grips?.[index + delta]?.focus())
  }

  return (
    <div className="theme-subsection hlc-settings" data-testid="highlight-color-settings">
      <h3 id="hlc-title">
        {t('형광펜 색')} <small>{t('끌어서 순서 바꾸기 · 최대 {n}가지', { n: MAX_HIGHLIGHT_COLORS })}</small>
      </h3>
      <div className="hlc-list" ref={listRef} role="list" aria-labelledby="hlc-title">
        {colors.map((color, index) => {
          const count = usage.get(color.id) ?? 0
          const label = color.name.trim() === '' ? t('색') : highlightColorDisplayName(color)
          const dropMark = drag !== null && drag.to === index && drag.from !== index ? (drag.to > drag.from ? 'after' : 'before') : undefined
          return (
            <div
              key={color.id}
              className="hlc-row"
              role="listitem"
              data-hlc-row={color.id}
              data-hl={color.id}
              data-dragging={drag?.id === color.id ? 'true' : undefined}
              data-drop={dropMark}
            >
              <button
                type="button"
                className="hlc-grip"
                aria-label={t('{name} 순서 바꾸기(끌거나 위·아래 화살표)', { name: label })}
                onPointerDown={(event) => startDrag(event, color.id, index)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(event) => gripKey(event, index)}
              >
                <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
              </button>
              <span className="hlc-swatch-wrap">
                <button
                  type="button"
                  className="hlc-swatch"
                  style={{ background: color.fill }}
                  aria-label={t('{name} 색 고르기', { name: label })}
                  onClick={() => openPicker(color.id)}
                />
                <input
                  ref={(element) => { if (element === null) pickerRefs.current.delete(color.id); else pickerRefs.current.set(color.id, element) }}
                  type="color"
                  className="hlc-native"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={color.fill}
                  onChange={(event) => save(recolorHighlightColor(colors, color.id, event.target.value))}
                />
              </span>
              <input
                type="text"
                className="hlc-name"
                aria-label={t('{name} 이름', { name: label })}
                value={highlightColorDisplayName(color)}
                maxLength={MAX_HIGHLIGHT_NAME_LENGTH}
                spellCheck={false}
                onChange={(event) => save(renameHighlightColor(colors, color.id, event.target.value))}
                onBlur={() => { if (color.name.trim() !== color.name || color.name.trim() === '') save(renameHighlightColor(colors, color.id, colorNameOrDefault(color.name))) }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              />
              {confirmId === color.id ? (
                <span className="hlc-confirm" role="alertdialog" aria-label={t('색 지우기')}>
                  <span>{t('이 색으로 칠한 형광펜 {count}개는 「기타」 색으로 보입니다.', { count })}</span>
                  <button type="button" className="hlc-confirm-yes" onClick={() => { setConfirmId(null); save(removeHighlightColor(colors, color.id)) }}>{t('지우기')}</button>
                  <button type="button" onClick={() => setConfirmId(null)}>{t('취소')}</button>
                </span>
              ) : (
                <>
                  <span className="hlc-sample-cell"><span className="hlc-sample-mark">{t('본문 표시')}</span></span>
                  <span className="hlc-sample-cell"><span className="hlc-sample-tab">{`${label} · p.3`}</span></span>
                  <button
                    type="button"
                    className="hlc-remove"
                    aria-label={t('{name} 지우기', { name: label })}
                    disabled={colors.length <= 1}
                    onClick={() => requestRemove(color.id)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          )
        })}
        {colors.length >= MAX_HIGHLIGHT_COLORS ? null : (
          <button type="button" className="hlc-add" onClick={() => save(addHighlightColor(colors))}>
            <Plus size={13} weight="bold" aria-hidden="true" />
            <span>{t('색 추가')}</span>
          </button>
        )}
      </div>
      <p className="hlc-caption">
        {t('고른 색 하나로 본문 표시(반투명), 카드 탭·테두리·연결선(흰 글자가 읽히는 진한 톤)을 자동으로 만듭니다. 지운 색으로 칠한 형광펜은 「기타」 색으로 남습니다.')}
      </p>
    </div>
  )
}
