// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExampleVaultFolder, forgetVault, openVault, pickVaultFolder, recentVaults, rememberVault } from '../../bridge/vault'
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../../bridge/window'
import { VaultPicker } from './VaultPicker'

vi.mock('../../bridge/vault', () => ({
  createExampleVaultFolder: vi.fn(),
  forgetVault: vi.fn(async () => undefined),
  openVault: vi.fn(),
  pickVaultFolder: vi.fn(),
  recentVaults: vi.fn(),
  rememberVault: vi.fn(),
}))
vi.mock('../../bridge/window', () => ({
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
    vi.mocked(createExampleVaultFolder).mockReset()
    vi.mocked(forgetVault).mockClear()
    // 아래 시험들은 첫 실행 안내를 마친 사람의 시작 화면을 본다
    localStorage.setItem('iwae:onboarded:v1', '1')
  })

  it('시작 화면은 앱 소개와 예시로 시작하기·내 폴더 열기를 보이고, 데이터가 어디 저장되는지 알린다', () => {
    const { container } = render(<VaultPicker onOpened={vi.fn()} version="1.2.3" />)

    expect(screen.getByRole('heading', { name: 'IWAE' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '시작하기' })).toBeDefined()
    expect(screen.getByRole('button', { name: /예시로 시작하기/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /내 폴더 열기/ })).toBeDefined()
    expect(screen.getByText(/원본 문서는 옮기거나 고치지 않으며/)).toBeDefined()
    expect(screen.getByText('버전 1.2.3')).toBeDefined()
    expect(container.querySelector('.startup-titlebar')?.getAttribute('data-tauri-drag-region')).toBe('deep')
    fireEvent.click(screen.getByRole('button', { name: '최소화' }))
    fireEvent.click(screen.getByRole('button', { name: '최대화' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(minimizeWindow).toHaveBeenCalledOnce()
    expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
    expect(closeWindow).toHaveBeenCalledOnce()
  })

  it('처음 켜면 언어 → 화면 → 시작 순서로 안내하고, 건너뛰면 바로 시작 화면이다', async () => {
    localStorage.removeItem('iwae:onboarded:v1')
    const theme = { preference: 'dark' as const, resolvedTheme: 'dark' as const, setPreference: vi.fn(), palette: 'whale' as const, setPalette: vi.fn(), accent: 'auto' as const, setAccent: vi.fn() }
    render(<VaultPicker onOpened={vi.fn()} theme={theme} />)

    expect(screen.getByRole('radio', { name: '한국어' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'English' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByRole('heading', { name: '화면 구성을 고르세요' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(screen.getByRole('heading', { name: '시작하기' })).toBeDefined()
    expect(localStorage.getItem('iwae:onboarded:v1')).toBe('1')
  })

  it('예시로 시작하기는 문서 폴더에 예시 Vault 를 만들어 연다', async () => {
    vi.mocked(createExampleVaultFolder).mockResolvedValue('C:/Users/me/Documents/IWAE 예시')
    vi.mocked(openVault).mockResolvedValue({ root: 'C:/Users/me/Documents/IWAE 예시' })
    const onOpened = vi.fn()
    render(<VaultPicker onOpened={onOpened} />)

    fireEvent.click(screen.getByRole('button', { name: /예시로 시작하기/ }))

    await waitFor(() => expect(onOpened).toHaveBeenCalledWith({ root: 'C:/Users/me/Documents/IWAE 예시' }))
    expect(createExampleVaultFolder).toHaveBeenCalledWith('IWAE 예시')
    expect(rememberVault).toHaveBeenCalledWith('C:/Users/me/Documents/IWAE 예시')
  })

  it('최근 Vault 는 폴더 이름으로 보이고, ×로 목록에서 뺄 수 있다(폴더는 그대로)', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['D:/Research', 'C:/notes/IWAE'])
    render(<VaultPicker onOpened={vi.fn()} />)

    expect(await screen.findByText('Research')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '목록에서 빼기: Research' }))
    expect(screen.queryByText('Research')).toBeNull()
    expect(forgetVault).toHaveBeenCalledWith('D:/Research')
  })

  it('고른 폴더를 vault로 열고 최근 목록에 기억한다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue('C:/notes/IWAE')
    vi.mocked(openVault).mockResolvedValue({ root: 'C:/notes/IWAE' })
    const onOpened = vi.fn()
    render(<VaultPicker onOpened={onOpened} />)

    fireEvent.click(screen.getByRole('button', { name: /내 폴더 열기/ }))

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
    expect(alert.textContent).toContain('C:/Vault 폴더를 한 번 더 선택하세요')
    expect(alert.textContent).not.toContain('forbidden')
  })

  it('폴더 선택 창은 최근 vault 에서 열린다', async () => {
    vi.mocked(recentVaults).mockResolvedValue(['C:/Vault'])
    vi.mocked(pickVaultFolder).mockResolvedValue(null)
    render(<VaultPicker onOpened={vi.fn()} />)
    await screen.findByRole('button', { name: 'C:/Vault' })

    fireEvent.click(screen.getByRole('button', { name: /내 폴더 열기/ }))

    await waitFor(() => {
      expect(pickVaultFolder).toHaveBeenCalledWith('C:/Vault')
    })
  })

  it('폴더 선택을 취소하면 아무 vault도 열지 않는다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue(null)
    render(<VaultPicker onOpened={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /내 폴더 열기/ }))

    await waitFor(() => {
      expect(pickVaultFolder).toHaveBeenCalledTimes(1)
    })
    expect(openVault).not.toHaveBeenCalled()
  })

  it('vault를 열지 못하면 사람이 읽을 오류를 보여준다', async () => {
    vi.mocked(pickVaultFolder).mockResolvedValue('C:/locked')
    vi.mocked(openVault).mockRejectedValue(new Error('폴더를 읽을 권한이 없습니다'))
    render(<VaultPicker onOpened={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /내 폴더 열기/ }))

    expect((await screen.findByRole('alert')).textContent).toBe('폴더를 읽을 권한이 없습니다')
  })
})
