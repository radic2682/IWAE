// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { UsageMeterSettings } from './UsageMeterSettings'
import { reloadUsageMeterPref, useUsageMeterEnabled } from '../core/usageMeterPref'
import { formatBytes, formatPercent, UsageMeter } from '../pdf/UsageMeter'
import { setLocale } from '../i18n'

function Probe() {
  return <span data-testid="probe">{useUsageMeterEnabled() ? 'on' : 'off'}</span>
}

describe('CPU·메모리 표시 설정', () => {
  beforeEach(() => {
    localStorage.clear()
    reloadUsageMeterPref()
  })

  it('기본은 끔이고, 스위치로 켜면 저장되고 쓰는 곳에도 바로 반영된다', () => {
    render(<><UsageMeterSettings /><Probe /></>)
    const toggle = screen.getByRole('switch', { name: '하단 막대에 CPU·메모리 보이기' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('probe').textContent).toBe('off')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('probe').textContent).toBe('on')
    expect(localStorage.getItem('iwae:usage-meter:v1')).toBe('on')
    // 다시 읽어도 그대로 기억한다
    act(() => reloadUsageMeterPref())
    expect(screen.getByTestId('probe').textContent).toBe('on')
  })

  it('영어 화면에서는 영어 이름을 보인다', () => {
    setLocale('en')
    render(<UsageMeterSettings />)
    expect(screen.getByRole('heading', { name: 'CPU and memory meter' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Show CPU and memory in the status bar' })).toBeTruthy()
  })
})

describe('UsageMeter', () => {
  it('IWAE 의 CPU·메모리를 보이고, 마우스를 올리면 시스템 전체도 보인다', async () => {
    const read = async () => ({ appCpu: 3.42, appMemory: 642 * 1024 * 1024, systemCpu: 17.8, systemMemoryUsed: 8 * 1024 ** 3, systemMemoryTotal: 16 * 1024 ** 3 })
    render(<UsageMeter read={read} />)
    const meter = await screen.findByRole('status')
    expect(meter.textContent).toBe('CPU 3.4%RAM 642MB')
    expect(meter.getAttribute('title')).toContain('시스템 전체 CPU 18%')
    expect(meter.getAttribute('title')).toContain('8.0GB / 16GB (50%)')
  })

  it('재지 못하면(브라우저 미리보기) 아무것도 그리지 않는다', async () => {
    const { container } = render(<UsageMeter read={async () => null} />)
    await act(async () => { await Promise.resolve() })
    expect(container.innerHTML).toBe('')
  })

  it('숫자 모양', () => {
    expect(formatBytes(512 * 1024 * 1024)).toBe('512MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5GB')
    expect(formatBytes(1019 * 1024 * 1024)).toBe('1.0GB')
    expect(formatPercent(0.25)).toBe('0.3%')
    expect(formatPercent(42.6)).toBe('43%')
  })
})
