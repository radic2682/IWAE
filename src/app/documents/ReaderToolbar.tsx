import type { Dispatch } from 'react'
import { Hand, Highlighter, MagnifyingGlass, Selection, CursorText, Translate, ChatTeardropText, PencilSimpleLine } from '@phosphor-icons/react'
import type { ReaderPrimaryMode, ReaderToolAction, ReaderToolState } from '../../core/readerTools'
import '../../ui/pdf-followup.css'
import { t } from '../../i18n'

interface ReaderToolbarProps {
  readonly state: ReaderToolState
  readonly dispatch: Dispatch<ReaderToolAction>
  readonly query?: string
  readonly onQueryChange?: (query: string) => void
  readonly modes?: readonly Exclude<ReaderPrimaryMode, 'idle'>[]
  readonly modeLabels?: Partial<Record<Exclude<ReaderPrimaryMode, 'idle'>, string>>
  readonly className?: string
  readonly toolsClassName?: string
  readonly buttonClassName?: string
  readonly showLabels?: boolean
}

const TOOL_DEFINITIONS = {
  pan: { label: '손 도구', icon: Hand },
  'text-select': { label: '텍스트 선택', icon: CursorText },
  'region-select': { label: '영역 선택', icon: Selection },
  highlight: { label: '형광펜', icon: Highlighter },
  translate: { label: '번역', icon: Translate },
  'box-memo': { label: '박스 메모', icon: ChatTeardropText },
  edit: { label: 'PDF 편집', icon: PencilSimpleLine },
} as const

export function ReaderToolbar({
  state,
  dispatch,
  query,
  onQueryChange,
  modes = ['text-select', 'region-select', 'highlight', 'translate'],
  modeLabels,
  className = '',
  toolsClassName = '',
  buttonClassName = '',
  showLabels = false,
}: ReaderToolbarProps) {
  const searchEnabled = query !== undefined && onQueryChange !== undefined
  return (
    <div className={`reader-toolbar${className ? ` ${className}` : ''}`} role="toolbar" aria-label={t('문서 읽기 도구')}>
      {searchEnabled ? (
        <div
          className={`reader-search${state.searchExpanded ? ' reader-search-expanded' : ''}`}
          onMouseEnter={() => dispatch({ type: 'expand-search' })}
          onMouseLeave={() => dispatch({ type: 'collapse-search' })}
        >
          <button
            type="button"
            className="reader-tool-button"
            aria-label={t('검색')}
            aria-expanded={state.searchExpanded}
            aria-pressed={state.searchPinned}
            onClick={() => dispatch({ type: 'set-search-pinned', pinned: !state.searchPinned })}
          >
            <MagnifyingGlass size={17} weight="bold" aria-hidden="true" />
          </button>
          {state.searchExpanded ? (
            <input
              type="search"
              aria-label={t('문서 검색')}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
          ) : null}
        </div>
      ) : null}
      <div className={`reader-primary-tools${toolsClassName ? ` ${toolsClassName}` : ''}`}>
        {modes.map((mode) => {
          const definition = TOOL_DEFINITIONS[mode]
          const label = t(modeLabels?.[mode] ?? definition.label)
          const Icon = definition.icon
          const active = state.primary === mode
          return (
            <button
              key={mode}
              type="button"
              className={`reader-tool-button${buttonClassName ? ` ${buttonClassName}` : ''}${active ? ' reader-tool-button-active toolbar-tool-btn-active' : ''}`}
              aria-label={label}
              title={label}
              data-tour={mode === 'region-select' ? 'region-capture' : undefined}
              aria-pressed={active}
              onClick={(event) => {
                // 초점 테두리가 남아 두 도구가 켜진 것처럼 보이지 않게
                event.currentTarget.blur()
                dispatch({ type: 'toggle', mode })
              }}
            >
              <Icon size={17} weight={active ? 'bold' : 'regular'} aria-hidden="true" />
              {showLabels ? <span className="pdf-compact-tool-label">{label}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
