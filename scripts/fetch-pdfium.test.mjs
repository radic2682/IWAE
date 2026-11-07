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
