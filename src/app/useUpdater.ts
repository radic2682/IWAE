import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../core/errorText'
import {
  loadUpdatePreferences,
  saveUpdatePreferences,
  shouldNotifyUpdate,
  type UpdatePreferences,
  type UpdatePreferencesStorage,
} from '../core/updatePreferences'
import {
  updaterClient,
  type UpdatePackage,
  type UpdateProgress,
  type UpdaterClient,
} from '../bridge/updater'

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

interface UseUpdaterInput {
  readonly client?: UpdaterClient
  readonly storage?: UpdatePreferencesStorage
  readonly autoStart?: boolean
  readonly flushBeforeInstall: () => Promise<void>
}

export interface UseUpdaterResult {
  readonly status: UpdaterStatus
  readonly update: UpdatePackage | null
  readonly preferences: UpdatePreferences
  readonly progress: UpdateProgress
  readonly error: string | null
  readonly checkNow: () => Promise<void>
  readonly download: () => Promise<void>
  readonly install: () => Promise<void>
  readonly dismiss: () => void
  readonly suppressCurrentVersion: () => void
  readonly updatePreferences: (patch: Partial<Pick<UpdatePreferences, 'autoCheck' | 'autoDownload'>>) => void
  readonly clearSuppressedVersion: () => void
}

const EMPTY_PROGRESS: UpdateProgress = { downloaded: 0, total: null }

export function useUpdater({
  client = updaterClient,
  storage,
  autoStart = true,
  flushBeforeInstall,
}: UseUpdaterInput): UseUpdaterResult {
  const storageRef = useRef(storage)
  const [preferences, setPreferences] = useState(() => loadUpdatePreferences(storage))
  const [status, setStatus] = useState<UpdaterStatus>('idle')
  const [update, setUpdate] = useState<UpdatePackage | null>(null)
  const [progress, setProgress] = useState<UpdateProgress>(EMPTY_PROGRESS)
  const [error, setError] = useState<string | null>(null)

  const persistPreferences = useCallback((next: UpdatePreferences) => {
    setPreferences(next)
    saveUpdatePreferences(next, storageRef.current)
  }, [])

  const performDownload = useCallback(async (target: UpdatePackage) => {
    setStatus('downloading')
    setError(null)
    setProgress(EMPTY_PROGRESS)
    try {
      await target.download(setProgress)
      setStatus('ready')
    } catch (cause) {
      setError(errorText(cause))
      setStatus('available')
    }
  }, [])

  const checkNow = useCallback(async () => {
    setStatus('checking')
    setError(null)
    try {
      const target = await client.check()
      const checkedPreferences: UpdatePreferences = {
        ...preferences,
        lastCheckedAt: new Date().toISOString(),
      }
      persistPreferences(checkedPreferences)
      if (target === null || !shouldNotifyUpdate(checkedPreferences, target.version)) {
        setUpdate(null)
        setStatus('idle')
        return
      }
      setUpdate(target)
      setStatus('available')
      if (checkedPreferences.autoDownload) await performDownload(target)
    } catch (cause) {
      setError(errorText(cause))
      setStatus('error')
    }
  }, [client, performDownload, persistPreferences, preferences])

  useEffect(() => {
    if (!autoStart || !preferences.autoCheck) return
    void checkNow()
  }, [autoStart]) // 최초 실행에서 한 번만 확인한다.

  const download = useCallback(async () => {
    if (update === null || status === 'downloading') return
    await performDownload(update)
  }, [performDownload, status, update])

  const install = useCallback(async () => {
    if (update === null || status !== 'ready') return
    setStatus('installing')
    setError(null)
    try {
      await flushBeforeInstall()
      await update.installAndRelaunch()
    } catch (cause) {
      setError(errorText(cause))
      setStatus('ready')
    }
  }, [flushBeforeInstall, status, update])

  const dismiss = useCallback(() => {
    setStatus('idle')
    setUpdate(null)
    setError(null)
  }, [])

  const suppressCurrentVersion = useCallback(() => {
    if (update === null) return
    persistPreferences({ ...preferences, suppressedVersion: update.version })
    void update.close()
    dismiss()
  }, [dismiss, persistPreferences, preferences, update])

  const updatePreferences = useCallback((patch: Partial<Pick<UpdatePreferences, 'autoCheck' | 'autoDownload'>>) => {
    persistPreferences({ ...preferences, ...patch })
  }, [persistPreferences, preferences])

  const clearSuppressedVersion = useCallback(() => {
    persistPreferences({ ...preferences, suppressedVersion: null })
  }, [persistPreferences, preferences])

  return {
    status,
    update,
    preferences,
    progress,
    error,
    checkNow,
    download,
    install,
    dismiss,
    suppressCurrentVersion,
    updatePreferences,
    clearSuppressedVersion,
  }
}
