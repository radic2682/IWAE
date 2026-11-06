import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { StackSimple, X } from '@phosphor-icons/react'
import { compareVersionLabels, guessVersionLabel } from '../core/versionGroups'
import '../ui/version-groups.css'
import { t } from '../i18n'

export interface StackDoc {
  readonly docId: string
  readonly title: string
  /** 판 이름을 추정할 때 쓰는 파일 이름(없으면 제목) */
  readonly fileName: string
}

interface StackVersionsDialogProps {
  /** 아래에 깔리는 문서(묶음이면 대표 자리 문서) */
  readonly base: StackDoc
  /** 위에 겹칠 문서. 없으면 아래 목록에서 고른다 */
  readonly added: StackDoc | null
  /** 고를 수 있는 문서들(이미 묶인 문서·base 는 뺀 것) */
  readonly candidates: readonly StackDoc[]
  /** 이미 묶음이면 묶음 이름(안내용) */
  readonly groupTitle?: string
  readonly onConfirm: (input: { added: StackDoc; baseLabel: string | null; addedLabel: string; makeDefault: boolean }) => void
  readonly onClose: () => void
  /** 가져온 파일이 같은 문서의 다른 판 같아서 앱이 먼저 묻는 경우(안내 한 줄) */
  readonly suggested?: boolean
}

/**
 * 판으로 겹치기. 새 문서를 위에 겹치면 한 줄(<판 이름> 칩)로 보인다. 판 이름은 파일 이름의 버전·날짜에서 추정해 채우고 고칠 수 있다.
 * 기본 판(핀)은 판 이름으로 더 새것을 고르고, 비교할 수 없으면 새로 겹친 쪽을 권한다.
 */
export function StackVersionsDialog({ base, added: given, candidates, groupTitle, onConfirm, onClose, suggested = false }: StackVersionsDialogProps) {
  const [picked, setPicked] = useState<StackDoc | null>(given)
  const [query, setQuery] = useState('')
  const alreadyGroup = groupTitle !== undefined
  const [baseLabel, setBaseLabel] = useState(() => guessVersionLabel(base.fileName, base.title))
  const [addedLabel, setAddedLabel] = useState(() => given === null ? '' : guessVersionLabel(given.fileName, given.title))
  // 기본 판(핀): 판 이름으로 어느 쪽이 새것인지 알 수 있으면 새것, 모르면 위에 겹치는 쪽
  const [makeDefault, setMakeDefault] = useState(() => given === null || compareVersionLabels(guessVersionLabel(given.fileName, given.title), guessVersionLabel(base.fileName, base.title)) >= 0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return candidates.filter((doc) => needle === '' || doc.title.toLowerCase().includes(needle) || doc.fileName.toLowerCase().includes(needle)).slice(0, 80)
  }, [candidates, query])

  const choose = (doc: StackDoc) => {
    setPicked(doc)
    const label = guessVersionLabel(doc.fileName, doc.title)
    setAddedLabel(label)
    setMakeDefault(compareVersionLabels(label, baseLabel) >= 0)
  }
  const sameLabels = !alreadyGroup && picked !== null && baseLabel.trim().toLowerCase() === addedLabel.trim().toLowerCase()
  const ready = picked !== null && addedLabel.trim() !== '' && (alreadyGroup || baseLabel.trim() !== '') && !sameLabels

  return createPortal(
    <div className="stack-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="stack-dialog" role="dialog" aria-modal="true" aria-label={t('판으로 겹치기')}>
        <header className="stack-head">
          <span className="stack-icon" aria-hidden="true"><StackSimple size={17} /></span>
          <div className="stack-titles">
            <h2>{t('판으로 겹치기')}</h2>
            <p title={base.title}>{alreadyGroup ? t('「{title}」에 판 추가', { title: groupTitle }) : t('「{title}」 위에 겹칩니다', { title: base.title })}</p>
          </div>
          <button type="button" className="stack-close" aria-label={t('닫기')} onClick={onClose}><X size={15} aria-hidden="true" /></button>
        </header>

        <div className="stack-body">
          {suggested ? <p className="stack-suggested">{t('가져온 파일이 이 문서의 다른 판 같습니다. 겹치지 않으려면 취소하세요(파일은 그대로 들어와 있습니다).')}</p> : null}
          {given === null ? (
            <div className="stack-picker">
              <input aria-label={t('겹칠 문서 찾기')} placeholder={t('겹칠 문서 이름')} value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
              <div className="stack-candidates" role="radiogroup" aria-label={t('겹칠 문서')}>
                {filtered.length === 0 ? <p className="stack-empty">{t('겹칠 수 있는 문서가 없습니다.')}</p> : filtered.map((doc) => (
                  <button key={doc.docId} type="button" role="radio" aria-checked={picked?.docId === doc.docId} className={`stack-candidate${picked?.docId === doc.docId ? ' stack-candidate-on' : ''}`} onClick={() => choose(doc)}>
                    {doc.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="stack-moving" title={given.title}>{t('겹칠 문서:')} <strong>{given.title}</strong></p>
          )}

          {picked === null ? null : (
            <div className="stack-labels">
              {alreadyGroup ? null : (
                <label>
                  <span>{t('아래 판 이름')}</span>
                  <input aria-label={t('아래 판 이름')} value={baseLabel} onChange={(event) => setBaseLabel(event.target.value)} />
                </label>
              )}
              <label>
                <span>{t('겹치는 판 이름')}</span>
                <input aria-label={t('겹치는 판 이름')} value={addedLabel} autoFocus={given !== null} onChange={(event) => setAddedLabel(event.target.value)} />
              </label>
              <label className="stack-check">
                <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
                <span>{t('겹치는 판을 문서 기본 판으로 (핀)')}</span>
              </label>
              {sameLabels ? <p className="stack-error" role="alert">{t('두 판 이름이 같습니다. 구분되게 적어 주세요.')}</p> : null}
            </div>
          )}
        </div>

        <footer className="stack-foot">
          <button type="button" className="stack-secondary" onClick={onClose}>{t('취소')}</button>
          <button
            type="button"
            className="stack-primary"
            disabled={!ready}
            onClick={() => { if (picked !== null && ready) onConfirm({ added: picked, baseLabel: alreadyGroup ? null : baseLabel.trim(), addedLabel: addedLabel.trim(), makeDefault }) }}
          >
            {t('겹치기')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
