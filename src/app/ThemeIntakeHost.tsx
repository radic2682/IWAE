import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { WarningCircle } from '@phosphor-icons/react'
import type { ResolvedTheme } from '../core/theme'
import { findSameTheme, isThemeFileName } from '../core/themeFile'
import { t } from '../i18n'
import { announceAction } from './actionFeedback'
import {
  checkIncomingThemeFile,
  getThemeDropHover,
  importThemeFile,
  readThemeBlobs,
  subscribeThemeDropHover,
  useThemeFileOffers,
  type IncomingThemeCheck,
  type IncomingThemeFile,
} from './themeIntake'
import { UserThemePreview } from './UserThemeCards'
import { useUserThemes } from './userThemeStore'
import '../ui/confirm-dialog.css'
import '../ui/user-theme.css'

/**
 * 테마 파일이 들어오면(창 아무 데나 끌어 놓기·탐색기에서 열기·설정의 「테마 파일 불러오기」) 묻는 창.
 * 「「숲」 테마를 추가할까요? [추가] [추가하고 적용]」. 틀린 파일은 이유를 한국어로 보여 주고 닫는다.
 * 여러 파일이면 하나씩 차례로 묻는다.
 */
export function ThemeIntakeHost({ resolvedTheme }: { readonly resolvedTheme: ResolvedTheme }) {
  const [queue, setQueue] = useState<readonly IncomingThemeCheck[]>([])
  const [withHighlights, setWithHighlights] = useState(false)
  const { themes } = useUserThemes()
  const hovering = useSyncExternalStore(subscribeThemeDropHover, getThemeDropHover, getThemeDropHover)

  const offer = useCallback((files: readonly IncomingThemeFile[]) => {
    setQueue((current) => [...current, ...files.map(checkIncomingThemeFile)])
  }, [])
  useThemeFileOffers(offer)

  // 브라우저(미리보기)에서는 DOM 으로 끌어 놓는다. 데스크톱은 Tauri 가 경로로 알려 주므로 여기까지 오지 않는다
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true
    const onOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault() }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      const overSection = (event.target as Element | null)?.closest?.('.theme-settings') != null
      const files = [...(event.dataTransfer?.files ?? [])].filter((file) => isThemeFileName(file.name, overSection))
      if (files.length === 0) return
      event.preventDefault()
      void readThemeBlobs(files).then(offer)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [offer])

  const current = queue[0] ?? null
  const currentKey = current === null ? null : `${current.file}:${current.kind}`
  // 다음 파일로 넘어가면 형광펜 색 선택은 다시 「안 바꿈」
  useEffect(() => { setWithHighlights(false) }, [currentKey])
  const next = () => setQueue((items) => items.slice(1))

  const finish = (apply: boolean) => {
    if (current === null || current.kind !== 'ok') return
    const outcome = importThemeFile(current.content, { apply, withHighlights })
    if (!outcome.ok) announceAction(t(outcome.error))
    else {
      const parts = [outcome.added ? `「${outcome.name}」 ${t('테마를 추가했습니다')}` : `「${outcome.name}」 ${t('같은 테마가 이미 있습니다')}`]
      if (outcome.applied) parts.push(t('적용했습니다'))
      if (outcome.highlightColors) parts.push(t('형광펜 색도 바꿨습니다'))
      announceAction(parts.join(' · '))
    }
    next()
  }

  return (
    <>
      {hovering && current === null
        ? createPortal(<div className="ut-drop-hint" role="status"><span>{t('테마 파일을 놓으면 추가할 수 있어요')}</span></div>, document.body)
        : null}
      {current === null ? null : createPortal(
        <div className="confirm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) next() }}>
          <div
            className="confirm-dialog ut-intake"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ut-intake-title"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              event.nativeEvent.stopImmediatePropagation()
              next()
            }}
          >
            {current.kind === 'error' ? (
              <>
                <div className="confirm-dialog-head">
                  <span className="confirm-dialog-mark"><WarningCircle size={18} weight="fill" aria-hidden="true" /></span>
                  <h2 id="ut-intake-title">{t('테마 파일을 불러오지 못했습니다')}</h2>
                </div>
                <div className="confirm-dialog-body">
                  <p><strong>{current.file}</strong></p>
                  <p className="ut-intake-error">{t(current.error)}</p>
                </div>
                <div className="confirm-dialog-actions">
                  <button type="button" className="confirm-dialog-confirm" autoFocus onClick={next}>{t('확인')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="confirm-dialog-head"><h2 id="ut-intake-title">{`「${current.content.theme.name}」 ${t('테마를 추가할까요?')}`}</h2></div>
                <div className="confirm-dialog-body">
                  <div className="ut-intake-preview"><UserThemePreview theme={current.content.theme} mode={resolvedTheme} /></div>
                  <p>{current.file}{queue.length > 1 ? ` · ${t('남은 파일')} ${queue.length - 1}` : ''}</p>
                  {findSameTheme(current.content.theme, themes) !== undefined ? <p>{t('같은 테마가 이미 있어서 새로 만들지 않고 그것을 씁니다.')}</p> : null}
                  {current.content.highlightColors !== undefined ? (
                    <label className="ut-intake-check">
                      <input type="checkbox" checked={withHighlights} onChange={(event) => setWithHighlights(event.target.checked)} />
                      <span>{t('형광펜 색 {count}개도 함께 바꾸기', { count: current.content.highlightColors.length })}</span>
                    </label>
                  ) : null}
                  {current.content.highlightColors !== undefined && withHighlights ? <p>{t('목록에 없는 색으로 칠한 형광펜은 「기타」 색으로 보입니다.')}</p> : null}
                  {current.content.warnings.map((warning) => <p key={warning} className="ut-intake-error">{t(warning)}</p>)}
                </div>
                <div className="confirm-dialog-actions">
                  <button type="button" onClick={next}>{t('취소')}</button>
                  <button type="button" onClick={() => finish(false)}>{t('추가')}</button>
                  <button type="button" className="confirm-dialog-confirm" autoFocus onClick={() => finish(true)}>{t('추가하고 적용')}</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
