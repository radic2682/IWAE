export interface UpdatePreferences {
  readonly version: 1
  readonly autoCheck: boolean
  readonly autoDownload: boolean
  readonly suppressedVersion: string | null
  readonly lastCheckedAt: string | null
}

export interface UpdatePreferencesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const UPDATE_PREFERENCES_KEY = 'iwae:update-preferences:v1'

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  version: 1,
  autoCheck: true,
  autoDownload: false,
  suppressedVersion: null,
  lastCheckedAt: null,
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function parseUpdatePreferences(value: unknown): UpdatePreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_UPDATE_PREFERENCES
  const candidate = value as Partial<UpdatePreferences>
  if (candidate.version !== 1
    || typeof candidate.autoCheck !== 'boolean'
    || typeof candidate.autoDownload !== 'boolean'
    || !isNullableString(candidate.suppressedVersion)
    || !isNullableString(candidate.lastCheckedAt)) {
    return DEFAULT_UPDATE_PREFERENCES
  }
  return {
    version: 1,
    autoCheck: candidate.autoCheck,
    autoDownload: candidate.autoDownload,
    suppressedVersion: candidate.suppressedVersion,
    lastCheckedAt: candidate.lastCheckedAt,
  }
}

function browserStorage(): UpdatePreferencesStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadUpdatePreferences(
  storage: UpdatePreferencesStorage | null = browserStorage(),
): UpdatePreferences {
  if (storage === null) return DEFAULT_UPDATE_PREFERENCES
  try {
    return parseUpdatePreferences(JSON.parse(storage.getItem(UPDATE_PREFERENCES_KEY) ?? 'null') as unknown)
  } catch {
    return DEFAULT_UPDATE_PREFERENCES
  }
}

export function saveUpdatePreferences(
  preferences: UpdatePreferences,
  storage: UpdatePreferencesStorage | null = browserStorage(),
): void {
  if (storage === null) return
  try {
    storage.setItem(UPDATE_PREFERENCES_KEY, JSON.stringify(parseUpdatePreferences(preferences)))
  } catch {
    // 설정 저장소가 잠겨 있어도 업데이트 확인 자체는 계속 동작한다.
  }
}

export function shouldNotifyUpdate(preferences: UpdatePreferences, version: string): boolean {
  return preferences.suppressedVersion !== version
}

export function memoryUpdatePreferencesStorage(
  initial: string | null = null,
): UpdatePreferencesStorage {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next
    },
  }
}
