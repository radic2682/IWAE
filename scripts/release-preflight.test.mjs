import assert from 'node:assert/strict'
import test from 'node:test'
import { validateReleaseConfiguration } from './release-preflight.mjs'

const config = { app: { security: { csp: "default-src 'self'" } } }

test('development mode needs no external signing or updater credentials', () => {
  assert.deepEqual(validateReleaseConfiguration({ env: {}, config }), [])
})

test('required Windows signing accepts a thumbprint or external signer', () => {
  assert.deepEqual(validateReleaseConfiguration({
    env: {}, config, requireSigning: true,
  }), ['IWAE_WINDOWS_CERTIFICATE_THUMBPRINT or IWAE_EXTERNAL_SIGNING_COMMAND'])
  assert.deepEqual(validateReleaseConfiguration({
    env: { IWAE_WINDOWS_CERTIFICATE_THUMBPRINT: 'thumbprint' }, config, requireSigning: true,
  }), [])
  assert.deepEqual(validateReleaseConfiguration({
    env: { IWAE_EXTERNAL_SIGNING_COMMAND: 'sign externally' }, config, requireSigning: true,
  }), [])
})

test('required updater rejects placeholders, HTTP, and missing key material', () => {
  assert.deepEqual(validateReleaseConfiguration({
    env: {
      IWAE_UPDATER_ENDPOINT: 'http://example.com/latest.json',
      IWAE_UPDATER_PUBLIC_KEY: 'replace-me',
    },
    config,
    requireUpdater: true,
  }), [
    'IWAE_UPDATER_ENDPOINT (real HTTPS URL)',
    'IWAE_UPDATER_PUBLIC_KEY',
    'TAURI_SIGNING_PRIVATE_KEY',
  ])
})

test('valid updater prerequisites pass and errors never echo secrets', () => {
  const secret = 'private-secret-value'
  assert.deepEqual(validateReleaseConfiguration({
    env: {
      IWAE_UPDATER_ENDPOINT: 'https://updates.iwae.example/latest.json',
      IWAE_UPDATER_PUBLIC_KEY: 'public-key-value',
      TAURI_SIGNING_PRIVATE_KEY: secret,
    },
    config,
    requireUpdater: true,
  }), [])

  const errors = validateReleaseConfiguration({
    env: { TAURI_SIGNING_PRIVATE_KEY: secret }, config, requireUpdater: true,
  })
  assert.equal(errors.join('\n').includes(secret), false)
})
