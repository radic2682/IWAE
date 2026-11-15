import { describe, expect, it } from 'vitest'
import { canStart, screenFor, shortPath, type SetupState } from './screen'
import { stepProgress } from './ease'

const base: SetupState = {
  mode: 'install',
  phase: 'start',
  lang: 'ko',
  version: '0.2.9',
  existing: null,
  installDir: 'D:\\IWAE',
  customDir: null,
  percent: 0,
}
const st = (o: Partial<SetupState>): SetupState => ({ ...base, ...o })

describe('screenFor', () => {
  it('fresh start offers install and a location link', () => {
    const m = screenFor(base)
    expect(m.primary).toEqual({ label: '설치', action: 'install' })
    expect(m.link).toEqual({ label: '설치 위치 바꾸기', action: 'pickDir' })
    expect(m.showVersion && m.closable && m.showLang).toBe(true)
    expect(m.sub).toBeNull()
  })
  it('upgrade says update and hides the location', () => {
    const m = screenFor(st({ existing: { version: '0.2.7', kind: 'upgrade' } }))
    expect(m.primary?.label).toBe('업데이트')
    expect(m.link).toBeNull()
  })
  it('same version says reinstall', () => {
    expect(screenFor(st({ existing: { version: '0.2.9', kind: 'same' } })).primary?.label).toBe('다시 설치')
  })
  it('downgrade installs with an older-version note', () => {
    const m = screenFor(st({ existing: { version: '0.2.8', kind: 'downgrade' } }))
    expect(m.primary?.label).toBe('설치')
    expect(m.sub).toBe('설치된 버전 0.2.8보다 낮은 버전입니다')
  })
  it('custom dir shows a shortened path plus change', () => {
    const dir = 'D:\\테스트 폴더\\아주 긴 이름의 폴더\\또 다른 아주 긴 폴더\\더 깊은 폴더\\IWAE'
    const m = screenFor(st({ customDir: dir }))
    expect(m.link?.action).toBe('pickDir')
    expect(m.link?.label).toBe(`${shortPath(dir)} 바꾸기`)
    expect(m.link?.label.startsWith('…')).toBe(true)
  })
  it('shortPath keeps short paths and trims long ones to 34 chars', () => {
    expect(shortPath('D:\\IWAE')).toBe('D:\\IWAE')
    const long = 'D:\\' + 'a'.repeat(60) + '\\IWAE'
    const s = shortPath(long)
    expect(s.length).toBe(34)
    expect(s).toBe('…' + long.slice(-33))
    expect(shortPath('x'.repeat(34))).toBe('x'.repeat(34))
  })
  it('appRunning asks to close first', () => {
    const m = screenFor(st({ phase: 'appRunning' }))
    expect(m.title).toBe('IWAE가 켜져 있습니다')
    expect(m.sub).toBe('저장할 것이 있으면 저장해 주세요.')
    expect(m.primary).toEqual({ label: '닫고 설치', action: 'closeAndInstall' })
    expect(m.link).toEqual({ label: '취소', action: 'cancel' })
    const u = screenFor(st({ mode: 'uninstall', phase: 'appRunning' }))
    expect(u.primary).toEqual({ label: '닫고 지우기', action: 'closeAndUninstall' })
  })
  it('appStuck offers force close', () => {
    const m = screenFor(st({ phase: 'appStuck' }))
    expect(m.title).toBe('IWAE가 닫히지 않았습니다')
    expect(m.primary).toEqual({ label: '강제로 닫기', action: 'forceClose' })
    expect(m.secondary).toEqual({ label: '취소', action: 'cancel' })
  })
  it('installing shows progress and is not closable', () => {
    const m = screenFor(st({ phase: 'installing', percent: 62 }))
    expect(m.progress).toBe(62)
    expect(m.title).toBe('설치하고 있습니다 62%')
    expect(m.closable).toBe(false)
    expect(m.primary || m.secondary || m.link).toBeFalsy()
  })
  it('done offers open', () => {
    const m = screenFor(st({ phase: 'done' }))
    expect(m.title).toBe('설치했습니다')
    expect(m.primary).toEqual({ label: 'IWAE 열기', action: 'openApp' })
  })
  it('failed offers retry and log, plus close in update mode', () => {
    const m = screenFor(st({ phase: 'failed' }))
    expect(m.title).toBe('설치하지 못했습니다')
    expect(m.sub).toBe('기록에 원인을 남겼습니다.')
    expect(m.primary).toEqual({ label: '다시 시도', action: 'retry' })
    expect(m.link).toEqual({ label: '기록 보기', action: 'showLog' })
    expect(m.secondary).toBeNull()
    expect(screenFor(st({ mode: 'update', phase: 'failed' })).secondary).toEqual({ label: '닫기', action: 'close' })
  })
  it('uninstall failed uses its own title and keeps retry, log, close', () => {
    const m = screenFor(st({ mode: 'uninstall', phase: 'failed' }))
    expect(m.title).toBe('지우지 못했습니다')
    expect(m.primary).toEqual({ label: '다시 시도', action: 'retry' })
    expect(m.link).toEqual({ label: '기록 보기', action: 'showLog' })
    expect(m.secondary).toEqual({ label: '닫기', action: 'close' })
  })
  it('uninstall start, progress and end', () => {
    const s = screenFor(st({ mode: 'uninstall', phase: 'uninstallStart' }))
    expect(s.title).toBe('IWAE를 지웁니다')
    expect(s.sub).toBe('Vault와 설정은 남겨 둡니다.')
    expect(s.primary).toEqual({ label: '지우기', action: 'uninstall' })
    const p = screenFor(st({ mode: 'uninstall', phase: 'uninstalling' }))
    expect(p.progress).toBe('indeterminate')
    expect(p.closable).toBe(false)
    expect(p.title).toBe('지우고 있습니다')
    const d = screenFor(st({ mode: 'uninstall', phase: 'uninstalled' }))
    expect(d.title).toBe('지웠습니다')
    expect(d.primary).toEqual({ label: '닫기', action: 'close' })
  })
  it('speaks English', () => {
    const m = screenFor(st({ lang: 'en', phase: 'installing', percent: 5 }))
    expect(m.title).toBe('Installing 5%')
    expect(screenFor(st({ lang: 'en', mode: 'uninstall', phase: 'failed' })).title).toBe("Couldn't uninstall")
  })
})

describe('stepProgress', () => {
  it('never goes backwards', () => {
    expect(stepProgress(50, 40, 0.1)).toBe(50)
    expect(stepProgress(50, 50, 0.1)).toBe(50)
  })
  it('eases toward the target without overshooting', () => {
    const v = stepProgress(10, 60, 0.1)
    expect(v).toBeGreaterThan(10)
    expect(v).toBeLessThanOrEqual(60)
    expect(stepProgress(10, 11, 5)).toBeCloseTo(11, 3)
  })
  it('moves at most 4 per second from 95', () => {
    expect(stepProgress(95, 100, 1)).toBeCloseTo(99, 5)
    expect(stepProgress(97, 100, 0.5)).toBeLessThanOrEqual(99)
  })
  it('stops at 95 when a step would cross it', () => {
    expect(stepProgress(94.9, 100, 0.25)).toBe(95)
    expect(stepProgress(95, 100, 0.25)).toBeCloseTo(96, 5)
  })
})

describe('canStart', () => {
  it('only allows starting from idle or failed screens', () => {
    for (const p of ['start', 'appRunning', 'appStuck', 'failed', 'uninstallStart'] as const) expect(canStart(p)).toBe(true)
    for (const p of ['installing', 'uninstalling', 'done', 'uninstalled'] as const) expect(canStart(p)).toBe(false)
  })
})
