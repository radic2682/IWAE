import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Warning, CheckCircle } from '@phosphor-icons/react'
import { normalizeHex } from '../core/colorMath'
import {
  BASE_PALETTE_IDS,
  BUILTIN_SEEDS,
  SEED_INFO,
  SEED_KEYS,
  THEME_NAME_MAX,
  contrastChecks,
  deriveThemeVars,
  parseThemeFile,
  serializeThemeFile,
  type BasePaletteId,
  type Brightness,
  type SeedKey,
  type ThemeSeeds,
  type UserTheme,
} from '../core/userTheme'
import { THEME_PALETTES } from '../core/theme'
import { t } from '../i18n'
import { Select } from '../ui/Select'
import { saveThemeFile, themeFileName } from './themeFile'
import { setThemeDraft } from './userThemeStore'
import '../ui/user-theme.css'

const CHECK_HINT: Record<string, string> = {
  'text-panel': '패널 위 글자가 읽기 어려울 수 있어요',
  'text-workspace': '작업 공간 위 글자가 읽기 어려울 수 있어요',
  'divider-panel': '선이 잘 안 보일 수 있어요',
  'accent-panel': '강조색이 패널에서 잘 안 보일 수 있어요',
}

/** 색 하나: 견본(누르면 색 고르기) + hex 입력. 고르는 동안 바로 값이 바뀐다 */
function SeedField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (hex: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  return (
    <span className="ut-seed-pill" data-invalid={normalizeHex(text) === null ? 'true' : undefined}>
      <span className="ut-seed-swatch">
        <i className="ut-seed-dot" style={{ background: value }} aria-hidden="true" />
        <input type="color" className="ut-seed-native" aria-label={`${label} ${t('색 고르기')}`} value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
      <input
        type="text"
        className="ut-seed-hex"
        aria-label={`${label} hex`}
        spellCheck={false}
        maxLength={7}
        value={text.toUpperCase()}
        onChange={(event) => {
          setText(event.target.value)
          const hex = normalizeHex(event.target.value)
          if (hex !== null) onChange(hex)
        }}
        onBlur={() => setText(value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
    </span>
  )
}

/** 실제 토큰으로 그린 작은 앱: 탭 줄·왼쪽 바(고른 줄)·PDF 쪽(형광펜)·노트 카드(호버 탭) */
export function ThemePreview({ theme, mode }: { readonly theme: UserTheme; readonly mode: Brightness }) {
  const vars = useMemo(() => deriveThemeVars(theme[mode], mode), [theme, mode])
  return (
    <div className="ut-preview" data-theme={mode} style={vars as CSSProperties} aria-hidden="true">
      <div className="ut-pv-tabs">
        <span className="ut-pv-tab ut-pv-tab-on" />
        <span className="ut-pv-tab" />
        <span className="ut-pv-field" />
      </div>
      <div className="ut-pv-body">
        <div className="ut-pv-left">
          <span className="ut-pv-row ut-pv-row-on" />
          <span className="ut-pv-row" />
          <span className="ut-pv-row" />
          <span className="ut-pv-row" />
        </div>
        <div className="ut-pv-work">
          <div className="ut-pv-page">
            <i className="ut-pv-line ut-pv-line-title" />
            <i className="ut-pv-line" />
            <i className="ut-pv-line ut-pv-line-hl" />
            <i className="ut-pv-line" />
            <i className="ut-pv-line ut-pv-line-short" />
          </div>
        </div>
        <div className="ut-pv-notes">
          <div className="ut-pv-card ut-pv-card-on">
            <b className="ut-pv-tag">{t('문서')} · p.2</b>
            <i className="ut-pv-line" />
            <i className="ut-pv-line ut-pv-line-short" />
          </div>
          <div className="ut-pv-card"><i className="ut-pv-line" /><i className="ut-pv-line ut-pv-line-short" /></div>
          <div className="ut-pv-card"><i className="ut-pv-line" /></div>
        </div>
      </div>
    </div>
  )
}

/**
 * 내 테마 만들기·고치기. 핵심 색 8개를 고르면 나머지는 자동 계산되어 미리보기와 앱 전체에 바로 반영된다.
 * 취소하면 원래 모습으로 돌아간다(draft 를 비운다). 저장하면 이 테마를 쓴다.
 */
export function ThemeEditorDialog({ initial, isNew, initialMode, takenNames, onSave, onCancel }: {
  readonly initial: UserTheme
  readonly isNew: boolean
  readonly initialMode: Brightness
  /** 다른 테마들이 이미 쓰는 이름 */
  readonly takenNames: readonly string[]
  readonly onSave: (theme: UserTheme) => void
  readonly onCancel: () => void
}) {
  const [draft, setDraft] = useState<UserTheme>(initial)
  const [mode, setMode] = useState<Brightness>(initialMode)
  const [message, setMessage] = useState<{ readonly kind: 'ok' | 'error'; readonly text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  // 고치는 동안 앱 전체에 비춘다. 닫으면(저장·취소 모두) 비운다
  useEffect(() => {
    setThemeDraft(draft)
  }, [draft])
  useEffect(() => () => setThemeDraft(null), [])
  useEffect(() => {
    document.documentElement.classList.add('ut-editing')
    return () => document.documentElement.classList.remove('ut-editing')
  }, [])
  useEffect(() => { nameInput.current?.focus() }, [])
  // 초점이 어디 있든 Esc 로 닫는다(목록 선택창이 열려 있으면 그것만 닫는다). 닫으면 열기 전 초점으로 돌아간다
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.app-select-list') !== null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus({ preventScroll: true })
    }
  }, [])

  const seeds = draft[mode]
  const checks = useMemo(() => contrastChecks(seeds), [seeds])
  const failing = checks.filter((check) => !check.ok)
  const nameTaken = takenNames.includes(draft.name.trim())
  const nameEmpty = draft.name.trim() === ''

  const setSeed = (key: SeedKey, hex: string) => setDraft((current) => ({ ...current, [mode]: { ...current[mode], [key]: hex } }))
  const exportFile = async () => {
    try {
      const path = await saveThemeFile(themeFileName(draft.name), serializeThemeFile({ ...draft, name: draft.name.trim() || t('내 테마') }))
      if (path !== null) setMessage({ kind: 'ok', text: `${t('파일로 내보냈습니다')}: ${path}` })
    } catch {
      setMessage({ kind: 'error', text: t('파일을 저장하지 못했습니다.') })
    }
  }
  const importFile = async (file: File) => {
    let text = ''
    try { text = await file.text() } catch { setMessage({ kind: 'error', text: t('파일을 읽지 못했습니다.') }); return }
    const parsed = parseThemeFile(text)
    if (!parsed.ok) { setMessage({ kind: 'error', text: `${t('불러오지 못했습니다')}: ${t(parsed.error)}` }); return }
    setDraft((current) => ({ ...current, name: parsed.theme.name, base: parsed.theme.base, light: parsed.theme.light, dark: parsed.theme.dark }))
    setMessage({ kind: 'ok', text: `${t('불러왔습니다')}: ${parsed.theme.name}` })
  }
  const resetToBase = () => {
    setDraft((current) => ({ ...current, [mode]: { ...BUILTIN_SEEDS[current.base][mode] } as ThemeSeeds }))
    setMessage(null)
  }
  const save = () => {
    if (nameEmpty) { nameInput.current?.focus(); return }
    onSave({ ...draft, name: draft.name.trim().slice(0, THEME_NAME_MAX) })
  }

  const baseOptions = BASE_PALETTE_IDS.map((id) => ({ value: id, label: THEME_PALETTES.find((item) => item.id === id)?.label ?? id }))

  return createPortal(
    <div className="ut-backdrop">
      <div
        className="ut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ut-title"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          onCancel()
        }}
      >
        <header className="ut-head">
          <h2 id="ut-title">{isNew ? t('새 테마 만들기') : t('내 테마 고치기')}{draft.name.trim() !== '' ? ` — ${draft.name.trim()}` : ''}</h2>
          <div className="ut-seg" role="radiogroup" aria-label={t('밝기')}>
            {(['light', 'dark'] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? 'ut-seg-on' : undefined} onClick={() => setMode(value)}>
                {value === 'light' ? t('라이트') : t('다크')}
              </button>
            ))}
          </div>
        </header>

        <div className="ut-main">
          <div className="ut-seeds">
            <div className="ut-meta">
              <label className="ut-meta-name">
                <span>{t('이름')}</span>
                <input
                  ref={nameInput}
                  type="text"
                  className="ut-text-input"
                  value={draft.name}
                  maxLength={THEME_NAME_MAX}
                  aria-invalid={nameEmpty ? 'true' : undefined}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <div className="ut-meta-base">
                <span>{t('바탕으로 한 구성')}</span>
                <Select value={draft.base} options={baseOptions} ariaLabel={t('바탕으로 한 구성')} onChange={(value) => setDraft((current) => ({ ...current, base: value as BasePaletteId }))} />
              </div>
            </div>
            {nameTaken ? <p className="ut-note">{t('같은 이름이 이미 있어 저장할 때 번호가 붙습니다.')}</p> : null}

            <ul className="ut-seed-list">
              {SEED_KEYS.map((key) => (
                <li key={key} className="ut-seed-row">
                  <span className="ut-seed-label">
                    <strong>{t(SEED_INFO[key].label)}</strong>
                    {SEED_INFO[key].hint !== '' ? <small>{t(SEED_INFO[key].hint)}</small> : null}
                  </span>
                  <SeedField label={t(SEED_INFO[key].label)} value={seeds[key]} onChange={(hex) => setSeed(key, hex)} />
                </li>
              ))}
            </ul>

            <div className="ut-checks" aria-live="polite">
              {failing.length === 0 ? (
                <span className="ut-check ut-check-ok"><CheckCircle size={14} weight="fill" aria-hidden="true" />{t('글자·구분선·강조색 대비가 모두 충분합니다')}</span>
              ) : failing.map((check) => (
                <span key={check.id} className="ut-check ut-check-warn">
                  <Warning size={14} weight="fill" aria-hidden="true" />
                  <b>{t(check.label)} {t('대비')} {check.ratio.toFixed(1)}</b>
                  <span>{t(CHECK_HINT[check.id] ?? '')}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="ut-preview-pane">
            <p className="ut-preview-caption">{t('미리보기 — 고칠 때마다 바로 바뀝니다')}</p>
            <ThemePreview theme={draft} mode={mode} />
          </div>
        </div>

        {message !== null ? <p className={`ut-message ut-message-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}

        <footer className="ut-foot">
          <button type="button" className="ut-btn" onClick={() => void exportFile()}>{t('파일로 내보내기')}</button>
          <button type="button" className="ut-btn" onClick={() => fileInput.current?.click()}>{t('파일 불러오기')}</button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="ut-file"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file !== undefined) void importFile(file)
            }}
          />
          <button type="button" className="ut-btn" title={t('지금 보는 밝기의 색을 바탕 구성의 값으로 되돌립니다')} onClick={resetToBase}>{t('바탕 구성대로 되돌리기')}</button>
          <span className="ut-foot-gap" />
          <button type="button" className="ut-btn" onClick={onCancel}>{t('취소')}</button>
          <button type="button" className="ut-btn ut-btn-primary" disabled={nameEmpty} onClick={save}>{t('저장')}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
