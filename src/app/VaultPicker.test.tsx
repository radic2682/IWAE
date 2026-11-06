// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openVault, pickVaultFolder, recentVaults, rememberVault } from '../bridge/vault'
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../bridge/window'
import { VaultPicker } from './VaultPicker'

vi.mock('../bridge/vault', () => ({
  openVault: vi.fn(),
  pickVaultFolder: vi.fn(),
  recentVaults: vi.fn(),
  rememberVault: vi.fn(),
}))
vi.mock('../bridge/window', () => ({
  closeWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  watchMaximized: vi.fn(async () => () => undefined),
}))

describe('VaultPicker', () => {
  beforeEach(() => {
    vi.mocked(openVault).mockReset()
    vi.mocked(pickVaultFolder).mockReset()
    vi.mocked(recentVaults).mockReset()
    vi.mocked(rememberVault).mockReset()
    vi.mocked(closeWindow).mockReset()
    vi.mocked(minimizeWindow).mockReset()
    vi.mocked(toggleMaximizeWindow).mockReset()
    vi.mocked(recentVaults).mockResolvedValue([])
  })

  it('Vault가 없을 때 데이터가 어디에 저장되는지 첫 화면에서 설명한다', () => {
    const { container } = render(<VaultPicker onOpened={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '작업 폴더를 선택하세요' })).toBeDefined()
    expect(screen.getByText('.iwae')).toBeDefined()
    expect(screen.getByText(/원본 문서는 이동하거나 수정하지 않습니다/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Vault 폴더 선택' })).toBeDefined()
    expect(container.querySelector('.startup-titlebar')?.getAttribute('data-tauri-drag-region')).toBe('deep')
    fireEvent.click(screen.getByRole('button', { name: '최소화' }))
    fireEvent.click(screen.getByRole('button', { name: '최대화' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(minimizeWindow).toHaveBeenCalledOnce()
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
    expect(closeWindow).toHaveBeenCalledOnce()
  })

  it('고른 폴더를 vault로 열고 최근 목록에 기억한다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue('C:/notes/IWAE')
    vi.mocked(openVault).mockResolvedValue({ root: 'C:/notes/IWAE' })
    const onOpened = vi.fn()
    render(<VaultPicker onOpened={onOpened} />)

    fireEvent.click(screen.getByRole('button', { name: 'Vault 폴더 선택' }))

    await waitFor(() => {
      expect(openVault).toHaveBeenCalledWith('C:/notes/IWAE')
    })
    expect(rememberVault).toHaveBeenCalledWith('C:/notes/IWAE')
    expect(onOpened).toHaveBeenCalledWith({ root: 'C:/notes/IWAE' })
  })

  it('최근 vault를 누르면 그 경로를 다시 연다', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['D:/Research', 'C:/notes/IWAE'])
    vi.mocked(openVault).mockResolvedValue({ root: 'D:/Research' })
    const onOpened = vi.fn()
    render(<VaultPicker onOpened={onOpened} />)

    fireEvent.click(await screen.findByRole('button', { name: 'D:/Research' }))

    await waitFor(() => {
      expect(openVault).toHaveBeenCalledWith('D:/Research')
    })
    expect(onOpened).toHaveBeenCalledWith({ root: 'D:/Research' })
  })

  it('허락이 없는 최근 vault는 그 폴더가 잡힌 선택 창을 띄워 다시 고르게 한다', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['C:/Vault'])
    vi.mocked(openVault)
      .mockRejectedValueOnce('forbidden path: C:/Vault')
      .mockResolvedValueOnce({ root: 'C:/Vault' })
    vi.mocked(pickVaultFolder).mockResolvedValue('C:/Vault')
    const onOpened = vi.fn()
    render(<VaultPicker onOpened={onOpened} />)

    fireEvent.click(await screen.findByRole('button', { name: 'C:/Vault' }))

    await waitFor(() => {
      expect(onOpened).toHaveBeenCalledWith({ root: 'C:/Vault' })
    })
    expect(pickVaultFolder).toHaveBeenCalledWith('C:/Vault')
    expect(rememberVault).toHaveBeenCalledWith('C:/Vault')
  })

  it('다시 고르기를 취소하면 영어 오류 대신 무엇을 하면 되는지 알려 준다', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['C:/Vault'])
    vi.mocked(openVault).mockRejectedValue('forbidden path: C:/Vault')
    vi.mocked(pickVaultFolder).mockResolvedValue(null)
    render(<VaultPicker onOpened={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'C:/Vault' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('C:/Vault 폴더를 한 번 더 골라 주세요')
    expect(alert.textContent).not.toContain('forbidden')
  })

  it('폴더 선택 창은 최근 vault 에서 열린다', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['C:/Vault'])
    vi.mocked(pickVaultFolder).mockResolvedValue(null)
    render(<VaultPicker onOpened={vi.fn()} />)
    await screen.findByRole('button', { name: 'C:/Vault' })

    fireEvent.click(screen.getByRole('button', { name: 'Vault 폴더 선택' }))

    await waitFor(() => {
      expect(pickVaultFolder).toHaveBeenCalledWith('C:/Vault')
    })
  })

  it('폴더 선택을 취소하면 아무 vault도 열지 않는다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue(null)
    render(<VaultPicker onOpened={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Vault 폴더 선택' }))

    await waitFor(() => {
      expect(pickVaultFolder).toHaveBeenCalledTimes(1)
    })
    expect(openVault).not.toHaveBeenCalled()
  })

  it('vault를 열지 못하면 사람이 읽을 오류를 보여준다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue('C:/locked')
    vi.mocked(openVault).mockRejectedValue(new Error('폴더를 읽을 권한이 없습니다'))
    render(<VaultPicker onOpened={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Vault 폴더 선택' }))

    expect((await screen.findByRole('alert')).textContent).toBe('폴더를 읽을 권한이 없습니다')
  })
})
