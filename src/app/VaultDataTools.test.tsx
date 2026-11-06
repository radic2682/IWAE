// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrashEmptyControl, VaultBackupSettings } from './VaultDataTools'
import { backupCreate, backupEstimate, trashEmpty, trashStats } from '../bridge/vaultBackup'

vi.mock('../bridge/vaultBackup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bridge/vaultBackup')>()
  return {
    ...actual,
    backupEstimate: vi.fn(),
    backupCreate: vi.fn(),
    backupRestore: vi.fn(),
    backupCancel: vi.fn(),
    listenBackupProgress: vi.fn(async () => () => undefined),
    revealInFolder: vi.fn(),
    trashStats: vi.fn(),
    trashEmpty: vi.fn(),
  }
})
const dialog = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)

describe('TrashEmptyControl', () => {
  beforeEach(() => {
    vi.mocked(trashStats).mockReset()
    vi.mocked(trashEmpty).mockReset()
  })

  it('크기를 보여 주고 앱 안 확인 창을 거쳐서만 비운다', async () => {
    vi.mocked(trashStats).mockResolvedValueOnce({ entries: 2, files: 3, bytes: 2048 }).mockResolvedValue({ entries: 0, files: 0, bytes: 0 })
    vi.mocked(trashEmpty).mockResolvedValue({ entries: 2, files: 3, bytes: 2048 })
    const onEmptied = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<TrashEmptyControl count={2} onEmptied={onEmptied} />)

    await screen.findByText('2.0 KB')
    fireEvent.click(screen.getByRole('button', { name: /휴지통 비우기/u }))
    const alert = screen.getByRole('alertdialog')
    expect(alert.textContent).toContain('2개')
    expect(trashEmpty).not.toHaveBeenCalled()

    // 취소하면 아무것도 지우지 않는다
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(trashEmpty).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /휴지통 비우기/u }))
    fireEvent.click(screen.getByRole('button', { name: '영구 삭제' }))
    await waitFor(() => expect(trashEmpty).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onEmptied).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('Esc 는 확인 창만 닫고 바깥(설정 창)으로 새지 않는다', async () => {
    vi.mocked(trashStats).mockResolvedValue({ entries: 1, files: 1, bytes: 10 })
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(<TrashEmptyControl count={1} onEmptied={() => undefined} />)
    await screen.findByText('10 B')
    fireEvent.click(screen.getByRole('button', { name: /휴지통 비우기/u }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(outer).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outer)
  })

  it('비어 있으면 단추를 끈다', async () => {
    vi.mocked(trashStats).mockResolvedValue({ entries: 0, files: 0, bytes: 0 })
    render(<TrashEmptyControl count={0} onEmptied={() => undefined} />)
    await waitFor(() => expect((screen.getByRole('button', { name: /휴지통 비우기/u }) as HTMLButtonElement).disabled).toBe(true))
  })
})

describe('VaultBackupSettings', () => {
  it('저장 위치를 고르면 백업을 만들고 폴더에서 보기를 제안한다', async () => {
    vi.mocked(backupEstimate).mockResolvedValue({ files: 10, bytes: 5 * 1024 * 1024, rebuildableBytes: 1024 * 1024 })
    dialog.save.mockResolvedValue('D:/backup/MyVault.zip')
    vi.mocked(backupCreate).mockResolvedValue({ path: 'D:/backup/MyVault.zip', files: 10, bytes: 5 * 1024 * 1024, archiveBytes: 3 * 1024 * 1024, millis: 2100 })
    render(<VaultBackupSettings vault={{ root: 'C:/Vaults/MyVault' }} />)

    await screen.findByText('파일 10개 · 5.0 MB')
    fireEvent.click(screen.getByRole('button', { name: /백업 파일 만들기/u }))
    await screen.findByText('백업을 만들었습니다')
    expect(dialog.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringMatching(/^MyVault-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/u) }))
    expect(backupCreate).toHaveBeenCalledWith('D:/backup/MyVault.zip', false)
    expect(screen.getByRole('button', { name: /폴더에서 보기/u })).toBeDefined()
  })

  it('저장을 취소하면 아무것도 만들지 않는다', async () => {
    vi.mocked(backupEstimate).mockResolvedValue({ files: 1, bytes: 1, rebuildableBytes: 0 })
    vi.mocked(backupCreate).mockClear()
    dialog.save.mockResolvedValue(null)
    render(<VaultBackupSettings vault={{ root: 'C:/V' }} />)
    fireEvent.click(screen.getByRole('button', { name: /백업 파일 만들기/u }))
    await waitFor(() => expect(dialog.save).toHaveBeenCalled())
    expect(backupCreate).not.toHaveBeenCalled()
  })
})
