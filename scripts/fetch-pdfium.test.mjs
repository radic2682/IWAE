import assert from 'node:assert/strict'
import test from 'node:test'
import { pdfiumAsset } from './fetch-pdfium.mjs'

test('Windows gets pdfium.dll from the win archive', () => {
  assert.deepEqual(pdfiumAsset('win32', 'x64'), { archive: 'pdfium-win-x64.tgz', inside: 'bin/pdfium.dll', name: 'pdfium.dll' })
})

test('macOS gets libpdfium.dylib for the running CPU, or the universal build', () => {
  assert.equal(pdfiumAsset('darwin', 'arm64').archive, 'pdfium-mac-arm64.tgz')
  assert.equal(pdfiumAsset('darwin', 'x64').archive, 'pdfium-mac-x64.tgz')
  assert.equal(pdfiumAsset('darwin', 'arm64', true).archive, 'pdfium-mac-univ.tgz')
  assert.equal(pdfiumAsset('darwin', 'arm64').name, 'libpdfium.dylib')
})

test('unknown platforms are refused instead of guessed', () => {
  assert.throws(() => pdfiumAsset('freebsd', 'x64'))
})

test('the release is pinned to a tag, never to "latest"', async () => {
  const { PDFIUM_TAG } = await import('./fetch-pdfium.mjs')
  assert.match(PDFIUM_TAG, /^chromium\/\d+$/)
})

test('every downloadable archive has a pinned SHA-256', async () => {
  const { PDFIUM_SHA256 } = await import('./fetch-pdfium.mjs')
  for (const [platform, arch, universal] of [['win32', 'x64'], ['win32', 'arm64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64', true], ['linux', 'x64']]) {
    const { archive } = pdfiumAsset(platform, arch, universal)
    assert.match(PDFIUM_SHA256[archive], /^[0-9a-f]{64}$/, archive)
  }
})

test('a download whose SHA-256 differs is refused, and so is an archive with no pinned value', async () => {
  const { verifyChecksum } = await import('./fetch-pdfium.mjs')
  const { createHash } = await import('node:crypto')
  const bytes = Buffer.from('pdfium bytes')
  const good = createHash('sha256').update(bytes).digest('hex')
  assert.equal(verifyChecksum('a.tgz', bytes, { 'a.tgz': good }), good)
  assert.throws(() => verifyChecksum('a.tgz', Buffer.from('tampered'), { 'a.tgz': good }), /맞지 않습니다/)
  assert.throws(() => verifyChecksum('b.tgz', bytes, { 'a.tgz': good }), /고정해 두지 않았습니다/)
})
