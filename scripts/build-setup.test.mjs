import assert from 'node:assert/strict'
import test from 'node:test'
import { installedFiles, payloadManifest, setupOutputName } from './build-setup.mjs'

test('installedFiles maps tauri resources to install-dir paths and adds app.exe', () => {
  const files = installedFiles(['binaries/pdfium.dll', '../LICENSE', '../THIRD_PARTY_NOTICES.md', 'licenses/pdfium-licenses.txt'])
  assert.deepEqual(files.map((f) => f.rel), [
    'binaries/pdfium.dll', '_up_/LICENSE', '_up_/THIRD_PARTY_NOTICES.md', 'licenses/pdfium-licenses.txt', 'app.exe',
  ])
  assert.equal(files.at(-1).src, 'target/release/app.exe')
  assert.equal(files[1].src, '../LICENSE')
})

test('payloadManifest pairs each rel with its size', () => {
  const files = [{ rel: 'app.exe', src: 'a' }, { rel: '_up_/LICENSE', src: 'b' }]
  assert.deepEqual(payloadManifest(files, (src) => (src === 'a' ? 10 : 3)), [
    { rel: 'app.exe', size: 10 }, { rel: '_up_/LICENSE', size: 3 },
  ])
})

test('setupOutputName follows the NSIS naming', () => {
  assert.equal(setupOutputName('0.2.7'), 'IWAE_0.2.7_x64-setup.exe')
})
