import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createUpdaterConfig } from './write-updater-config.mjs'

test('base Tauri config keeps the updater plugin valid in development', async () => {
  const configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url)
  const config = JSON.parse(await readFile(configPath, 'utf8'))

  assert.deepEqual(config.plugins?.updater, {
    endpoints: [],
    pubkey: '',
  })
})

test('desktop bundle ships installer notices', async () => {
  const configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url)
  const config = JSON.parse(await readFile(configPath, 'utf8'))

  assert.ok(config.bundle.targets.includes('nsis'))
  assert.ok(config.bundle.resources.includes('../LICENSE'))
  assert.ok(config.bundle.resources.includes('../THIRD_PARTY_NOTICES.md'))
})

test('release workflow publishes explicit Windows installer formats', async () => {
  const workflowPath = new URL('../.github/workflows/release.yml', import.meta.url)
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /bundle\/nsis\/\*\.exe/)
  assert.match(workflow, /bundle\/msi\/\*\.msi/)
  assert.match(workflow, /bundle\/nsis\/\*-setup\.exe/)
  assert.match(workflow, /bundle\/\*\*\/\*\.sig/)
  assert.match(workflow, /latest\.json/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /npm run release:build[\s\S]*npm run verify:ocr-dist/)
  assert.match(workflow, /IWAE_REQUIRE_UPDATER:\s*['"]1['"]/)
  assert.match(workflow, /prerelease:\s*false/)
})

test('development release writes an inert override without credentials', () => {
  assert.deepEqual(createUpdaterConfig({}), {})
})

test('updatable release writes public configuration and updater artifacts only', () => {
  const config = createUpdaterConfig({
    IWAE_REQUIRE_UPDATER: '1',
    IWAE_UPDATER_ENDPOINT: 'https://updates.iwae.test/latest.json',
    IWAE_UPDATER_PUBLIC_KEY: 'public-key',
    TAURI_SIGNING_PRIVATE_KEY: 'private-secret',
  })

  assert.deepEqual(config, {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        endpoints: ['https://updates.iwae.test/latest.json'],
        pubkey: 'public-key',
        windows: { installMode: 'passive' },
      },
    },
  })
  assert.equal(JSON.stringify(config).includes('private-secret'), false)
})

test('updatable release rejects placeholder and insecure public configuration', () => {
  assert.throws(() => createUpdaterConfig({
    IWAE_REQUIRE_UPDATER: 'true',
    IWAE_UPDATER_ENDPOINT: 'http://example.com/latest.json',
    IWAE_UPDATER_PUBLIC_KEY: 'replace-me',
  }), /updater configuration is incomplete/i)
})
