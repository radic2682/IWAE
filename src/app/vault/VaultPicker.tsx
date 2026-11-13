import { useCallback, useEffect, useState } from 'react'
import { Folder, FolderOpen, Sparkle, SquaresFour, Highlighter, Folders, X } from '@phosphor-icons/react'
import {
  createExampleVaultFolder,
  forgetVault,
  openVault,
  pickVaultFolder,
  recentVaults,
  rememberVault,
  type VaultHandle,
} from '../../bridge/vault'
import { errorText } from '../../core/errorText'
import { folderAccessText, isFolderAccessDenied } from '../../core/vaultAccess'
import type { ResolvedTheme, ThemeAccent, ThemePalette, ThemePreference } from '../../core/theme'
import { StartupShell } from '../StartupShell'
import { ThemeSettings } from '../settings/ThemeSettings'
import { vaultFolderName } from '../sidebar/Sidebar'
import { getLocale, saveLocalePreference, setLocale, t, useLocale, type Locale } from '../../i18n'
import '../../ui/about-dialog.css'
import '../../ui/vault-picker.css'

/** 첫 실행 안내(언어 → 화면 → 시작)를 마쳤는가 */
const ONBOARDED_KEY = 'iwae:onboarded:v1'

type Step = 'language' | 'look' | 'start'

export interface VaultPickerTheme {
  readonly preference: ThemePreference
  readonly resolvedTheme: ResolvedTheme
  readonly setPreference: (preference: ThemePreference) => void
  readonly palette: ThemePalette
  readonly setPalette: (palette: ThemePalette) => void
  readonly accent: ThemeAccent
  readonly setAccent: (accent: ThemeAccent) => void
}

interface VaultPickerProps {
  onOpened: (vault: VaultHandle) => void
  /** 첫 실행 2단계(화면 고르기)에 쓴다. 없으면 그 단계를 건너뛴다 */
  theme?: VaultPickerTheme
  /** 정보 칸에 보일 버전 */
  version?: string
}

function readOnboarded(): boolean {
  try { return window.localStorage.getItem(ONBOARDED_KEY) === '1' } catch { return true }
}

function markOnboarded(): void {
  try { window.localStorage.setItem(ONBOARDED_KEY, '1') } catch { /* 이번 실행에만 */ }
}

export function VaultPicker({ onOpened, theme, version }: VaultPickerProps) {
  useLocale()
  const [recent, setRecent] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  // 최근 Vault 가 있으면(이미 쓰던 사람) 안내 없이 바로 시작 단계
  const [step, setStep] = useState<Step>(() => (readOnboarded() ? 'start' : 'language'))

  useEffect(() => {
    let alive = true
    void recentVaults()
      .then((roots) => {
        if (!alive) return
        setRecent(roots)
        if (roots.length > 0) setStep('start')
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const goStart = () => {
    markOnboarded()
    setStep('start')
  }

  const openRoot = useCallback(
    async (root: string, regrant: boolean) => {
      setOpening(true)
      setError(null)
      try {
        let target = root
        let vault: VaultHandle
        try {
          vault = await openVault(root)
        } catch (err) {
          // 허락이 없는 최근 Vault: 그 폴더가 잡힌 선택 창을 띄워 한 번 고르게 한다
          if (!regrant || !isFolderAccessDenied(err)) throw err
          const picked = await pickVaultFolder(root)
          if (picked === null) {
            setError(folderAccessText(root))
            return
          }
          target = picked
          vault = await openVault(picked)
        }
        await rememberVault(target)
        markOnboarded()
        onOpened(vault)
      } catch (err) {
        setError(isFolderAccessDenied(err) ? folderAccessText(root) : errorText(err))
      } finally {
        setOpening(false)
      }
    },
    [onOpened],
  )

  const chooseFolder = useCallback(() => {
    void (async () => {
      // 최근 Vault 가 막혀 있으면 그 폴더에서 선택 창을 연다
      const root = await pickVaultFolder(recent[0])
      if (root !== null) await openRoot(root, false)
    })()
  }, [openRoot, recent])

  const startWithExample = useCallback(() => {
    void (async () => {
      setOpening(true)
      setError(null)
      try {
        const root = await createExampleVaultFolder(t('IWAE 예시'))
        await openRoot(root, false)
      } catch (err) {
        setError(errorText(err))
        setOpening(false)
      }
    })()
  }, [openRoot])

  // 폴더를 창에 끌어 놓으면 그 폴더로 연다(시작 단계에서만)
  useEffect(() => {
    if (step !== 'start') return
    let dispose: (() => void) | undefined
    let alive = true
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== 'drop') return
          const first = event.payload.paths[0]
          if (first === undefined || /\.[a-z0-9]{2,5}$/iu.test(first)) return
          void openRoot(first, true)
        })
        if (alive) dispose = stop
        else stop()
      } catch {
        // 브라우저 미리보기 등: 끌어 놓기 없음
      }
    })()
    return () => {
      alive = false
      try { dispose?.() } catch { /* 이미 풀린 구독 */ }
    }
  }, [openRoot, step])

  const removeRecent = (root: string) => {
    setRecent((current) => current.filter((candidate) => candidate !== root))
    void forgetVault(root).catch(() => undefined)
  }

  const chooseLanguage = (locale: Locale) => {
    saveLocalePreference(locale)
    setLocale(locale)
  }

  const onboarding = step !== 'start'
  const steps: readonly { readonly id: Step; readonly label: string }[] = [
    { id: 'language', label: t('언어') },
    ...(theme === undefined ? [] : [{ id: 'look' as const, label: t('화면') }]),
    { id: 'start', label: t('시작') },
  ]
  const stepIndex = steps.findIndex((item) => item.id === step)
  const next = () => {
    const following = steps[stepIndex + 1]
    if (following === undefined || following.id === 'start') goStart()
    else setStep(following.id)
  }
  const previous = () => {
    const before = steps[stepIndex - 1]
    if (before !== undefined) setStep(before.id)
  }

  return (
    <StartupShell>
      <main className="vault-picker">
        <section className="vault-picker-card vault-picker-two">
          <aside className="vault-picker-brand">
            <div className="about-logo vault-picker-logo" aria-hidden="true">
              <img className="about-logo-piece about-logo-back" src="/about/iwae-logo-back.png" alt="" />
              <img className="about-logo-piece about-logo-front" src="/about/iwae-logo-front.png" alt="" />
              <img className="about-logo-final" src="/iwae-logo.png" alt="" />
            </div>
            <h1 className="vault-picker-name">IWAE</h1>
            <p className="vault-picker-tagline">{t('PDF를 폴더에서 정리하고, 열어서 나란히 읽고, 칠한 곳을 노트로 엮습니다.')}</p>
            <ul className="vault-picker-features">
              <li><Folders size={18} aria-hidden="true" />{t('내 폴더가 곧 서재')}</li>
              <li><SquaresFour size={18} aria-hidden="true" />{t('탭과 나란히 보기')}</li>
              <li><Highlighter size={18} aria-hidden="true" />{t('원문과 이어진 메모와 노트')}</li>
            </ul>
            {version === undefined ? null : <p className="vault-picker-version">{t('버전 {version}', { version })}</p>}
          </aside>

          <div className="vault-picker-main">
            {onboarding ? (
              <ol className="vault-picker-steps" aria-label={t('처음 설정')}>
                {steps.map((item, index) => (
                  <li key={item.id} className={item.id === step ? 'vault-picker-step-current' : index < stepIndex ? 'vault-picker-step-done' : undefined} aria-current={item.id === step ? 'step' : undefined}>
                    <span>{index + 1}</span>{item.label}
                  </li>
                ))}
              </ol>
            ) : null}

            {step === 'language' ? (
              <div className="vault-picker-pane">
                {/* 읽지 못하는 언어로 떠도 찾을 수 있게 두 언어로 */}
                <h2>{getLocale() === 'ko' ? '어떤 언어로 쓸까요? · Language' : 'Which language? · 언어'}</h2>
                <div className="vault-picker-choices" role="radiogroup" aria-label={t('언어')}>
                  {(['ko', 'en'] as const).map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      role="radio"
                      aria-checked={getLocale() === locale}
                      className={`vault-picker-choice${getLocale() === locale ? ' vault-picker-choice-active' : ''}`}
                      onClick={() => chooseLanguage(locale)}
                    >
                      <strong>{locale === 'ko' ? '한국어' : 'English'}</strong>
                    </button>
                  ))}
                </div>
                <p className="vault-picker-note">{t('나중에 설정에서 바꿀 수 있습니다.')}</p>
              </div>
            ) : null}

            {step === 'look' && theme !== undefined ? (
              <div className="vault-picker-pane vault-picker-look">
                <h2>{t('화면 구성을 고르세요')}</h2>
                <p className="vault-picker-note">{t('고르는 즉시 이 창에 적용됩니다. 나중에 설정에서 바꿀 수 있습니다.')}</p>
                <ThemeSettings
                  preference={theme.preference}
                  resolvedTheme={theme.resolvedTheme}
                  onChange={theme.setPreference}
                  palette={theme.palette}
                  onPaletteChange={theme.setPalette}
                  accent={theme.accent}
                  onAccentChange={theme.setAccent}
                />
              </div>
            ) : null}

            {onboarding ? (
              <div className="vault-picker-nav">
                <button type="button" className="vault-picker-ghost" onClick={goStart}>{t('건너뛰기')}</button>
                <span>
                  {stepIndex > 0 ? <button type="button" className="vault-picker-secondary" onClick={previous}>{t('이전')}</button> : null}
                  <button type="button" className="vault-picker-primary" onClick={next}>{t('다음')}</button>
                </span>
              </div>
            ) : (
              <div className="vault-picker-pane">
                <h2>{t('시작하기')}</h2>
                <button type="button" className="vault-picker-action vault-picker-action-primary" disabled={opening} onClick={startWithExample}>
                  <Sparkle size={20} aria-hidden="true" />
                  <span>
                    <strong>{t('예시로 시작하기')}</strong>
                    <small>{t('문서 폴더에 사용 안내서와 예시 노트가 든 Vault를 만듭니다')}</small>
                  </span>
                </button>
                <button type="button" className="vault-picker-action" disabled={opening} onClick={chooseFolder}>
                  <FolderOpen size={20} aria-hidden="true" />
                  <span>
                    <strong>{opening ? t('Vault 여는 중…') : t('내 폴더 열기')}</strong>
                    <small>{t('PDF가 든 폴더를 고릅니다. 빈 폴더면 예시를 넣습니다')}</small>
                  </span>
                </button>
                {error !== null && <p className="vault-picker-error" role="alert">{error}</p>}
                {recent.length > 0 && (
                  <div className="vault-picker-recent">
                    <h3>{t('최근 Vault')}</h3>
                    <ul>
                      {recent.map((root) => (
                        <li key={root}>
                          <button type="button" className="vault-picker-recent-open" disabled={opening} title={root} aria-label={root} onClick={() => void openRoot(root, true)}>
                            <Folder size={16} aria-hidden="true" />
                            <span>
                              <strong>{vaultFolderName(root)}</strong>
                              <small>{root}</small>
                            </span>
                          </button>
                          <button type="button" className="vault-picker-recent-remove" aria-label={t('목록에서 빼기: {name}', { name: vaultFolderName(root) })} title={t('목록에서 빼기 (폴더는 그대로)')} onClick={() => removeRecent(root)}>
                            <X size={13} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="vault-picker-drop">{t('폴더를 이 창에 끌어 놓아도 열립니다. 원본 문서는 옮기거나 고치지 않으며, 앱의 기록은 폴더 안 .iwae에 저장합니다.')}</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </StartupShell>
  )
}
