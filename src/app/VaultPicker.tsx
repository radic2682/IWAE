import { useCallback, useEffect, useState } from 'react'
import {
  openVault,
  pickVaultFolder,
  recentVaults,
  rememberVault,
  type VaultHandle,
} from '../bridge/vault'
import { errorText } from '../core/errorText'
import { folderAccessText, isFolderAccessDenied } from '../core/vaultAccess'
import { StartupShell } from './StartupShell'
import { pick, t } from '../i18n'

interface VaultPickerProps {
  onOpened: (vault: VaultHandle) => void
}

export function VaultPicker({ onOpened }: VaultPickerProps) {
  const [recent, setRecent] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let alive = true
    void recentVaults()
      .then((roots) => {
        if (alive) setRecent(roots)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [])

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

  return (
    <StartupShell>
      <main className="vault-picker">
        <section className="vault-picker-card">
        <p className="vault-picker-kicker">IWAE</p>
        <h1>{t('작업 폴더를 선택하세요')}</h1>
        <p className="vault-picker-copy">
          {t('Vault는 PDF 문서와 메모, 앱 설정을 함께 보관하는 작업 폴더입니다.')}
        </p>
        <ul className="vault-picker-details">
          <li>{pick({ ko: <>선택한 폴더 안에 <code>.iwae</code> 관리 폴더를 자동으로 만듭니다.</>, en: <>An <code>.iwae</code> folder is created inside the chosen folder automatically.</> })}</li>
          <li>{t('원본 문서는 이동하거나 수정하지 않습니다.')}</li>
          <li>{t('다음 실행부터 최근 Vault를 바로 다시 열 수 있습니다.')}</li>
        </ul>
        <button type="button" className="vault-picker-primary" disabled={opening} onClick={chooseFolder}>
          {opening ? t('Vault 여는 중…') : t('Vault 폴더 선택')}
        </button>
        {error !== null && <p className="vault-picker-error" role="alert">{error}</p>}
        {recent.length > 0 && (
          <div className="vault-picker-recent">
            <h2>{t('최근 Vault')}</h2>
            {recent.map((root) => (
              <button key={root} type="button" disabled={opening} onClick={() => void openRoot(root, true)}>
                {root}
              </button>
            ))}
          </div>
        )}
        </section>
      </main>
    </StartupShell>
  )
}
