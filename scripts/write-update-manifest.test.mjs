import assert from 'node:assert/strict'
import test from 'node:test'
import { createUpdateManifest } from './write-update-manifest.mjs'

test('creates a Tauri Windows manifest with inline signature and release asset URL', () => {
  assert.deepEqual(createUpdateManifest({
    version: '0.1.3',
    packageVersion: '0.1.3',
    tag: 'v0.1.3',
    repository: 'radic2682/IWAE',
    bundleName: 'IWAE_0.1.3_x64-setup.exe',
    signature: 'signed-content\n',
    notes: 'Safer updates',
    pubDate: '2026-10-01T00:00:00.000Z',
  }), {
    version: '0.1.3',
    notes: 'Safer updates',
    pub_date: '2026-10-01T00:00:00.000Z',
    platforms: {
      'windows-x86_64': {
        signature: 'signed-content',
        url: 'https://github.com/radic2682/IWAE/releases/download/v0.1.3/IWAE_0.1.3_x64-setup.exe',
      },
    },
  })
})

test('rejects version drift and missing updater signatures', () => {
  const input = {
    version: '0.1.3', packageVersion: '0.1.3', tag: 'v0.1.3', repository: 'radic2682/IWAE',
    bundleName: 'IWAE_0.1.3_x64-setup.exe', signature: 'signature', notes: '', pubDate: '2026-10-01T00:00:00.000Z',
  }
  assert.throws(() => createUpdateManifest({ ...input, tag: 'v0.1.4' }), /version/i)
  assert.throws(() => createUpdateManifest({ ...input, packageVersion: '0.1.4' }), /version/i)
  assert.throws(() => createUpdateManifest({ ...input, signature: '  ' }), /signature/i)
  assert.throws(() => createUpdateManifest({ ...input, bundleName: 'IWAE_0.1.3_x64_en-US.msi' }), /NSIS/i)
})
