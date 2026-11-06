/**
 * 자동 백업 설정과 「지금 할 차례인가」. Vault 마다 따로 둔다(이 PC 의 localStorage).
 * 백업은 Vault 전체를 zip 하나로 묶고(수동 백업과 같은 방식), 폴더에는 자동 백업을 keep 개만 남긴다.
 */

export interface AutoBackupSettings {
  readonly enabled: boolean
  /** 며칠마다 */
  readonly everyDays: number
  /** 자동 백업 zip 을 둘 폴더(Vault 밖). 빈 글이면 아직 정하지 않았다 */
  readonly folder: string
  /** 자동 백업을 몇 개까지 남길지(넘으면 오래된 것부터 지운다) */
  readonly keep: number
  /** 검색 색인·미리보기 캐시도 넣기(다시 만들 수 있어 기본으로 뺀다) */
  readonly includeIndex: boolean
  /** 마지막으로 자동 백업을 마친 시각(ISO) */
  readonly lastAt: string | null
  /** 마지막 자동 백업이 실패했으면 그 까닭 */
  readonly lastError: string | null
}

export const AUTO_BACKUP_DAY_CHOICES = [1, 3, 7, 14, 30] as const
export const AUTO_BACKUP_KEEP_CHOICES = [2, 3, 5, 10, 20] as const

export const DEFAULT_AUTO_BACKUP: AutoBackupSettings = {
  enabled: true,
  everyDays: 7,
  folder: '',
  keep: 5,
  includeIndex: false,
  lastAt: null,
  lastError: null,
}

const DAY_MS = 24 * 60 * 60 * 1000

function storageKey(vaultRoot: string): string {
  return `iwae:auto-backup:v1:${vaultRoot.replaceAll('\\', '/').toLowerCase()}`
}

export function readAutoBackup(vaultRoot: string): AutoBackupSettings {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(storageKey(vaultRoot)) ?? 'null')
    if (raw === null || typeof raw !== 'object') return DEFAULT_AUTO_BACKUP
    const value = raw as Partial<AutoBackupSettings>
    const number = (input: unknown, fallback: number, min: number, max: number) =>
      typeof input === 'number' && Number.isFinite(input) ? Math.min(Math.max(Math.round(input), min), max) : fallback
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AUTO_BACKUP.enabled,
      everyDays: number(value.everyDays, DEFAULT_AUTO_BACKUP.everyDays, 1, 365),
      folder: typeof value.folder === 'string' ? value.folder : '',
      keep: number(value.keep, DEFAULT_AUTO_BACKUP.keep, 1, 100),
      includeIndex: value.includeIndex === true,
      lastAt: typeof value.lastAt === 'string' ? value.lastAt : null,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
    }
  } catch {
    return DEFAULT_AUTO_BACKUP
  }
}

export function writeAutoBackup(vaultRoot: string, settings: AutoBackupSettings): void {
  try { window.localStorage.setItem(storageKey(vaultRoot), JSON.stringify(settings)) } catch { /* 이번 실행에만 */ }
}

/** 지금 자동 백업을 할 차례인가. 켜져 있고 폴더가 있고, 마지막 백업에서 everyDays 가 지났으면 */
export function autoBackupDue(settings: AutoBackupSettings, now: Date = new Date()): boolean {
  if (!settings.enabled || settings.folder.trim() === '') return false
  if (settings.lastAt === null) return true
  const last = Date.parse(settings.lastAt)
  if (!Number.isFinite(last)) return true
  return now.getTime() - last >= settings.everyDays * DAY_MS
}

/** 다음 자동 백업 예정 시각. 꺼져 있거나 폴더가 없으면 null */
export function nextAutoBackupAt(settings: AutoBackupSettings, now: Date = new Date()): Date | null {
  if (!settings.enabled || settings.folder.trim() === '') return null
  if (settings.lastAt === null || !Number.isFinite(Date.parse(settings.lastAt))) return now
  return new Date(Date.parse(settings.lastAt) + settings.everyDays * DAY_MS)
}

/** 파일 이름에 넣을 현지 시각 YYYY-MM-DD-HHMM */
export function backupStamp(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}
