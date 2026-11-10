import { describe, expect, it } from 'vitest'
import { buildIssueUrl, buildReport, ISSUE_URL_LIMIT, redactText } from './supportReport'
import { clearRecordedErrors, recordedErrors, recordError } from './errorBuffer'

describe('redactText', () => {
  it('Vault 경로와 파일 이름을 자리표시자로 바꾼다', () => {
    const out = redactText('open C:\\Users\\kim\\Documents\\내 Vault\\논문.pdf failed', { vaultRoot: 'C:\\Users\\kim\\Documents\\내 Vault' }) // release-scan-allow
    expect(out).not.toContain('kim')
    expect(out).not.toContain('논문')
    expect(out).toContain('<vault>')
  })
  it('남은 절대 경로와 파일 이름을 가린다', () => {
    expect(redactText('read /Users/kim/notes/secret plan.md')).not.toContain('kim')
    expect(redactText('error in thesis-final.pdf at line 3')).toBe('error in <file>.pdf at line 3')
  })
  it('키와 토큰을 가린다', () => {
    const text = 'Authorization: Bearer abcdefghijklmnop key sk-ant-abcdefghijklmnopqrst api_key=XYZ12345 deepl 12345678-1234-1234-1234-123456789abc:fx'
    const out = redactText(text)
    for (const secret of ['abcdefghijklmnop', 'sk-ant', 'XYZ12345', '12345678-1234']) expect(out).not.toContain(secret)
  })
  it('주소의 질의 문자열과 메일을 뗀다', () => {
    const out = redactText('GET https://example.com/a/b?token=abc123&x=1 by me@mail.com') // release-scan-allow
    expect(out).toBe('GET https://example.com/a/b by <email>')
  })
})

describe('buildReport', () => {
  const base = { description: '열면 멈춰요', appVersion: '0.1.10', os: 'Windows 10/11', includeLogs: true, logLines: ['INFO ok', 'ERROR C:\\Users\\a\\b.pdf'], errors: [], vaultRoot: null } // release-scan-allow
  it('기록을 끄면 본문에 기록이 없다', () => {
    const report = buildReport({ ...base, includeLogs: false })
    expect(report.body).not.toContain('app log')
    expect(report.body).toContain('0.1.10')
  })
  it('기록은 가려진 채 들어간다', () => {
    expect(buildReport(base).body).not.toContain('C:\\Users')
  })
  it('짧으면 한 주소에, 길면 줄이고 붙여넣기를 안내한다', () => {
    const short = buildReport(base)
    expect(buildIssueUrl(short, base).needsPaste).toBe(false)
    const big = buildReport({ ...base, logLines: Array.from({ length: 120 }, (_, i) => `INFO line ${i} ${'word '.repeat(20)}`) })
    const link = buildIssueUrl(big, base)
    expect(link.needsPaste).toBe(true)
    expect(link.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT)
    expect(link.url.startsWith('https://github.com/radic2682/IWAE/issues/new?')).toBe(true)
  })
})

describe('error buffer', () => {
  it('최대 개수를 넘으면 오래된 것부터 버린다', () => {
    clearRecordedErrors()
    for (let i = 0; i < 60; i += 1) recordError('error', new Error(`e${i}`))
    const all = recordedErrors()
    expect(all).toHaveLength(50)
    expect(all[0]?.message).toContain('e10')
  })
})

describe('redactText file names with spaces', () => {
  it('hides the whole name of a file inside the vault even when it has spaces', () => {
    const out = redactText('open C:\\Users\\kim\\Docs\\My Vault\\비밀 폴더\\비밀 문서.PDF failed', { vaultRoot: 'C:\\Users\\kim\\Docs\\My Vault' }) // release-scan-allow
    expect(out).toBe('open <vault>/<file>.pdf failed')
  })
})
