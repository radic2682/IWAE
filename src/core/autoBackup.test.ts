// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { autoBackupDue, backupStamp, DEFAULT_AUTO_BACKUP, nextAutoBackupAt, readAutoBackup, writeAutoBackup } from './autoBackup'

const on = { ...DEFAULT_AUTO_BACKUP, folder: 'D:/backups', everyDays: 7 }

describe('자동 백업 일정', () => {
  it('처음이거나 n 일이 지났으면 할 차례', () => {
    const now = new Date('2026-11-10T12:00:00')
    expect(autoBackupDue(on, now)).toBe(true)
    expect(autoBackupDue({ ...on, lastAt: '2026-11-05T12:00:00' }, now)).toBe(false)
    expect(autoBackupDue({ ...on, lastAt: '2026-11-03T12:00:00' }, now)).toBe(true)
    expect(nextAutoBackupAt({ ...on, lastAt: '2026-11-05T12:00:00' }, now)?.toISOString()).toBe(new Date('2026-11-12T12:00:00').toISOString())
  })

  it('꺼져 있거나 폴더가 없으면 하지 않는다', () => {
    expect(autoBackupDue({ ...on, enabled: false })).toBe(false)
    expect(autoBackupDue({ ...on, folder: '' })).toBe(false)
    expect(nextAutoBackupAt({ ...on, enabled: false })).toBeNull()
  })

  it('Vault 마다 따로 저장하고 이상한 값은 범위로 자른다', () => {
    writeAutoBackup('C:/A', { ...on, everyDays: 999, keep: 0 })
    expect(readAutoBackup('c:/a')).toMatchObject({ everyDays: 365, keep: 1, folder: 'D:/backups' })
    expect(readAutoBackup('C:/B')).toEqual(DEFAULT_AUTO_BACKUP)
  })

  it('파일 이름 시각은 현지 YYYY-MM-DD-HHMM', () => {
    expect(backupStamp(new Date(2026, 10, 3, 9, 5))).toBe('2026-11-03-0905')
  })
})
