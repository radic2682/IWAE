import { useCallback, useEffect, useRef, useState } from 'react'
import { announceAction } from './actionFeedback'
import { autoBackupDue, backupStamp, readAutoBackup, writeAutoBackup, type AutoBackupSettings } from '../core/autoBackup'
import { backupAuto, formatBytes } from '../bridge/vaultBackup'
import { errorText } from '../core/errorText'
import { isDesktop } from '../bridge/window'
import { t } from '../i18n'

/** 켠 뒤 처음 확인까지 기다림(앱이 막 켜질 때 무거운 일을 겹치지 않게) */
const FIRST_CHECK_MS = 3 * 60 * 1000
/** 그 뒤 확인 간격 */
const CHECK_EVERY_MS = 30 * 60 * 1000

/**
 * 자동 백업: Vault 를 열고 있는 동안 30분마다 「할 차례인가」를 보고, 차례면 전체 백업을 만든다.
 * 설정은 Vault 마다 이 PC 에 둔다. 처음 쓰면 폴더를 「문서\IWAE 백업」으로 잡는다.
 */
export function useAutoBackup(vaultRoot: string | null) {
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (vaultRoot === null) {
      setSettings(null)
      return
    }
    let alive = true
    const saved = readAutoBackup(vaultRoot)
    if (saved.folder !== '' || !isDesktop()) {
      setSettings(saved)
      return
    }
    // 폴더를 아직 정하지 않았으면 문서 폴더 아래 「IWAE 백업」
    void (async () => {
      try {
        const { documentDir, join } = await import('@tauri-apps/api/path')
        const folder = await join(await documentDir(), 'IWAE 백업')
        const next = { ...saved, folder }
        writeAutoBackup(vaultRoot, next)
        if (alive) setSettings(next)
      } catch {
        if (alive) setSettings(saved)
      }
    })()
    return () => { alive = false }
  }, [vaultRoot])

  const update = useCallback((patch: Partial<AutoBackupSettings>) => {
    if (vaultRoot === null) return
    setSettings((current) => {
      const next = { ...(current ?? readAutoBackup(vaultRoot)), ...patch }
      writeAutoBackup(vaultRoot, next)
      return next
    })
  }, [vaultRoot])

  /** 지금 백업을 한다(차례가 아니어도). 끝나면 마지막 시각을 적는다 */
  const runNow = useCallback(async (reason: 'scheduled' | 'manual') => {
    if (vaultRoot === null || runningRef.current) return
    const current = readAutoBackup(vaultRoot)
    if (current.folder.trim() === '') return
    runningRef.current = true
    setRunning(true)
    if (reason === 'manual') announceAction(t('자동 백업을 만드는 중…'))
    try {
      const result = await backupAuto(current.folder, backupStamp(), current.keep, current.includeIndex)
      const next = { ...readAutoBackup(vaultRoot), lastAt: new Date().toISOString(), lastError: null }
      writeAutoBackup(vaultRoot, next)
      setSettings(next)
      announceAction(result.removed.length > 0 ? t('자동 백업을 만들었습니다 ({size}, 이전 백업 {count}개 정리)', { size: formatBytes(result.backup.archiveBytes), count: result.removed.length }) : t('자동 백업을 만들었습니다 ({size})', { size: formatBytes(result.backup.archiveBytes) }))
    } catch (cause) {
      const message = errorText(cause)
      // 다른 백업·복원이 돌고 있으면 다음 확인 때 다시 한다
      if (!/진행 중|in progress/iu.test(message)) {
        const next = { ...readAutoBackup(vaultRoot), lastError: message }
        writeAutoBackup(vaultRoot, next)
        setSettings(next)
        announceAction(t('자동 백업을 만들지 못했습니다: {message}', { message }))
      }
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [vaultRoot])

  // 차례가 되면 한다: 켜고 3분 뒤 한 번, 그 뒤 30분마다 확인
  useEffect(() => {
    if (vaultRoot === null || !isDesktop()) return
    const check = () => {
      if (autoBackupDue(readAutoBackup(vaultRoot))) void runNow('scheduled')
    }
    const first = window.setTimeout(check, FIRST_CHECK_MS)
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [runNow, vaultRoot])

  return { settings, update, runNow: () => runNow('manual'), running }
}
