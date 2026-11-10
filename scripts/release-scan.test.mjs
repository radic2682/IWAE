import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { denylistMatcher, parseDenylist, scanHistory, scanText } from './release-scan.mjs'

test('금지어 목록은 빈 줄과 주석을 뺀다', () => {
  assert.deepEqual(parseDenylist('# 회사\nacme\n\n  widgetco  # 예전 이름\n'), ['acme', 'widgetco'])
})

test('금지어는 낱말 경계로 대소문자 없이 찾는다', () => {
  const matcher = denylistMatcher(['acme'])
  assert.equal(scanText('made by ACME corp', matcher).length, 1)
  assert.equal(scanText('acmeville is fine', matcher).length, 0)
})

test('개인 폴더 경로와 이메일을 찾고 예시 주소는 둔다', () => {
  assert.equal(scanText(String.raw`open C:\Users\jane\notes`, null)[0]?.rule, '개인 폴더 경로') // release-scan-allow
  assert.equal(scanText('C:/Users/Public/x', null).length, 0)
  assert.equal(scanText('mail jane@corp.io', null)[0]?.rule, '이메일 jane@corp.io') // release-scan-allow
  assert.equal(scanText('user@example.com noreply@github.com', null).length, 0)
  assert.equal(scanText('mail jane@corp.io // release-scan-allow', null).length, 0)
})

test('이력 검사는 지워진 파일 내용·커밋 글·작성자 이메일까지 찾는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iwae-scan-history-'))
  try {
    const git = (...args) => execFileSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@users.noreply.github.com', ...args], { cwd: dir, stdio: 'pipe' })
    git('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'made by acme corp\n')
    git('add', '.')
    git('commit', '-q', '-m', 'first')
    git('rm', '-q', 'a.txt')
    writeFileSync(join(dir, 'b.txt'), 'clean\n')
    git('add', '.')
    git('commit', '-q', '-m', 'ACME cleanup')
    const result = scanHistory(dir, denylistMatcher(['acme']))
    assert.equal(result.commits, 2)
    assert.ok(result.hits.some((hit) => hit.where.endsWith('a.txt')), '지운 파일 내용')
    assert.ok(result.hits.some((hit) => hit.where.includes('글·작성자')), '커밋 글')
    assert.equal(scanHistory(dir, null).hits.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
