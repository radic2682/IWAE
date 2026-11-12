import { useEffect, useState } from 'react'
import { BUNDLED_RELEASE_NOTES, planWhatsNew, type ReleaseNote } from '../core/releaseNotes'
import { t } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { ReleaseNotesBody, releaseDateLabel } from './ReleaseNotesView'
import { useStartupDialog } from './startupDialogs'

/** 마지막으로 보여 준 버전. 새 버전 안내를 한 번만 띄우는 데 쓴다 */
export const LAST_SEEN_VERSION_KEY = 'iwae:last-seen-version:v1'
export const WHATS_NEW_DIALOG_ID = 'whats-new'
/** 시작 대화상자 줄에서 다른 안내보다 먼저 뜬다 */
const WHATS_NEW_PRIORITY = 10

function readLastSeen(): string | null {
  try { return window.localStorage.getItem(LAST_SEEN_VERSION_KEY) } catch { return null }
}

function writeLastSeen(version: string): void {
  try { window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version) } catch { /* 저장 못 하면 다음 실행에 한 번 더 보인다 */ }
}

interface WhatsNewHostProps {
  /** 메인 창이고 시작 준비를 마쳤을 때만 true. 새 창·떼어 낸 창에서는 false */
  readonly enabled: boolean
  readonly version: string
  readonly notes?: readonly ReleaseNote[]
  /** 「지난 기록 보기」: 설정의 업데이트 기록을 지금 버전 펼친 채로 연다 */
  readonly onShowHistory: (version: string) => void
}

/**
 * 업데이트하고 처음 시작했을 때의 「새 버전」 안내.
 * enabled 가 처음 true 가 될 때 한 번 판단한다: 처음 설치면 기록만, 업데이트면 건너뛴 버전까지 모아 보인다.
 * 안내를 닫을 때 지금 버전을 기록한다(닫기 전에 앱이 꺼지면 다음에 다시 보인다).
 */
export function WhatsNewHost({ enabled, version, notes = BUNDLED_RELEASE_NOTES, onShowHistory }: WhatsNewHostProps) {
  const [pending, setPending] = useState<readonly ReleaseNote[] | null>(null)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    if (!enabled || decided) return
    setDecided(true)
    const plan = planWhatsNew(readLastSeen(), version, notes)
    if (plan.kind === 'show') setPending(plan.notes)
    else if (plan.kind === 'store') writeLastSeen(version)
  }, [decided, enabled, notes, version])

  const turn = useStartupDialog(WHATS_NEW_DIALOG_ID, pending !== null, WHATS_NEW_PRIORITY)
  if (!turn || pending === null) return null

  const close = (showHistory: boolean) => {
    writeLastSeen(version)
    setPending(null)
    if (showHistory) onShowHistory(version)
  }
  const stacked = pending.length > 1
  return (
    <ConfirmDialog
      title={t('새 버전 v{version}', { version })}
      confirmLabel={t('확인')}
      hideCancel
      extra={{ label: t('지난 기록 보기'), onClick: () => close(true) }}
      onConfirm={() => close(false)}
      onCancel={() => close(false)}
    >
      <div className="whats-new-body">
        {pending.map((note) => (
          <section key={note.version} className="whats-new-release">
            {stacked ? (
              <h3>
                {`v${note.version}`}
                {note.date !== null ? <time dateTime={note.date}>{releaseDateLabel(note.date)}</time> : null}
              </h3>
            ) : null}
            <ReleaseNotesBody markdown={note.body} />
          </section>
        ))}
      </div>
    </ConfirmDialog>
  )
}
