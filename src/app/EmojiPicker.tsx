import { useEffect, useMemo, useState } from 'react'
import {
  EMOJI_GROUPS,
  loadEmojiRows,
  readRecentEmoji,
  rememberRecentEmoji,
  rowsInGroup,
  searchEmoji,
  type EmojiRow,
} from '../core/emojiCatalog'
import '../ui/item-emoji.css'
import '../ui/emoji-picker.css'
import { t } from '../i18n'

const PICKER_WIDTH = 320
const PICKER_HEIGHT = 360
const EDGE = 8

interface EmojiPickerProps {
  /** 오른쪽 클릭한 자리. 창 밖으로 넘치면 안쪽으로 당긴다 */
  readonly anchor: { readonly x: number; readonly y: number }
  readonly current?: string
  readonly onSelect: (emoji: string) => void
  readonly onRemove?: () => void
  readonly onClose: () => void
  /** 테스트용 주입 통로. 기본값은 지연 로딩되는 번들 데이터다 */
  readonly loadRows?: () => Promise<readonly EmojiRow[]>
}

/**
 * Confluence 식 이모지 선택창 — 검색, 최근 사용, 분류 탭.
 *
 * Escape 는 여기서 소비한다(preventDefault). 라이브러리 모드도 document 의
 * Escape 로 닫히는데, 선택창만 닫으려던 Escape 가 라이브러리까지 접으면
 * 사용자가 하던 정리 작업 화면이 통째로 사라진다.
 */
export function EmojiPicker({ anchor, current, onSelect, onRemove, onClose, loadRows = loadEmojiRows }: EmojiPickerProps) {
  const [rows, setRows] = useState<readonly EmojiRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(EMOJI_GROUPS[0]?.id ?? 0)
  const [recent] = useState(readRecentEmoji)

  useEffect(() => {
    let active = true
    void loadRows().then((loaded) => { if (active) setRows(loaded) })
    return () => { active = false }
  }, [loadRows])

  const labels = useMemo(() => new Map((rows ?? []).map((row) => [row[0], row[1]])), [rows])
  const searching = query.trim() !== ''
  const visible = rows === null ? [] : searching ? searchEmoji(rows, query) : rowsInGroup(rows, group)
  const left = Math.max(EDGE, Math.min(anchor.x, window.innerWidth - PICKER_WIDTH - EDGE))
  const top = Math.max(EDGE, Math.min(anchor.y, window.innerHeight - PICKER_HEIGHT - EDGE))

  const choose = (emoji: string) => {
    rememberRecentEmoji(emoji)
    onSelect(emoji)
  }

  return (
    <>
      <div className="emoji-picker-backdrop" onClick={onClose} />
      <div
        className="emoji-picker"
        role="dialog"
        aria-label={t('이모지 선택')}
        style={{ left, top, width: PICKER_WIDTH, height: PICKER_HEIGHT }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="emoji-picker-head">
          <input
            type="search"
            aria-label={t('이모지 검색')}
            placeholder={t('이모지 검색')}
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          {current !== undefined && onRemove !== undefined ? (
            <button type="button" className="emoji-picker-remove" onClick={onRemove}>{t('이모지 제거')}</button>
          ) : null}
        </div>
        {!searching && recent.length > 0 ? (
          <div className="emoji-picker-section">
            <p className="emoji-picker-label">{t('최근 사용')}</p>
            <div className="emoji-picker-grid">
              {recent.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="item-emoji emoji-picker-cell"
                  aria-label={labels.get(emoji) ?? emoji}
                  onClick={() => choose(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="emoji-picker-section emoji-picker-scroll">
          {rows === null ? <p className="emoji-picker-label">{t('불러오는 중…')}</p> : null}
          {rows !== null && visible.length === 0 ? <p className="emoji-picker-label">{t('결과가 없습니다')}</p> : null}
          <div className="emoji-picker-grid">
            {visible.map(([emoji, label]) => (
              <button
                key={emoji}
                type="button"
                className="item-emoji emoji-picker-cell"
                aria-label={label}
                title={label}
                onClick={() => choose(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <div className="emoji-picker-tabs" role="tablist" aria-label={t('이모지 분류')}>
          {EMOJI_GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={!searching && group === item.id}
              aria-label={item.label}
              title={item.label}
              className="item-emoji emoji-picker-tab"
              onClick={() => {
                setQuery('')
                setGroup(item.id)
              }}
            >
              {item.sample}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
