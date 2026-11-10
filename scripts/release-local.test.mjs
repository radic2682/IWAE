import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  REPOSITORY, UPDATER_ENDPOINT, buildSteps, distDir, fixedEnv, ghCreateArgs, ghUploadArgs, manifestEnv,
  parseArgs, parseEnvFile, resolveSecrets, selectMacArtifacts, selectWindowsArtifacts, uploadList,
} from './release-local.mjs'

test('parses KEY=VALUE lines, comments, quotes and CRLF', () => {
  const parsed = parseEnvFile('\uFEFF# comment\r\nA=1\r\n\r\nexport B = "two words" \nC=\nD=\'x\'\nnot a line\nE=a=b\n')
  assert.deepEqual(parsed, { A: '1', B: 'two words', C: '', D: 'x', E: 'a=b' })
})

test('process env wins over the env file and empty values fall through', () => {
  const { values, missing } = resolveSecrets(
    { TAURI_SIGNING_PRIVATE_KEY: 'file-key', IWAE_UPDATER_PUBLIC_KEY: 'file-pub', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'file-pw' },
    { TAURI_SIGNING_PRIVATE_KEY: 'proc-key', IWAE_UPDATER_PUBLIC_KEY: '' },
  )
  assert.deepEqual(missing, [])
  assert.equal(values.TAURI_SIGNING_PRIVATE_KEY, 'proc-key')
  assert.equal(values.IWAE_UPDATER_PUBLIC_KEY, 'file-pub')
  assert.equal(values.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, 'file-pw')
})

test('private key can come from a key file and the password may be empty', () => {
  const { values, missing } = resolveSecrets(
    { TAURI_SIGNING_PRIVATE_KEY_PATH: 'C:\\k\\key', IWAE_UPDATER_PUBLIC_KEY: 'pub' }, {}, (path) => `content of ${path}\n`,
  )
  assert.deepEqual(missing, [])
  assert.equal(values.TAURI_SIGNING_PRIVATE_KEY, 'content of C:\\k\\key')
  assert.equal(values.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, '')
})

test('missing secrets are reported by name only', () => {
  const { missing } = resolveSecrets({ TAURI_SIGNING_PRIVATE_KEY: 'super-secret-value' }, {})
  assert.deepEqual(missing, ['IWAE_UPDATER_PUBLIC_KEY'])
  const none = resolveSecrets({}, {})
  assert.equal(none.missing.length, 2)
  assert.match(none.missing[0], /TAURI_SIGNING_PRIVATE_KEY/u)
  const unreadable = resolveSecrets({ TAURI_SIGNING_PRIVATE_KEY_PATH: 'nope', IWAE_UPDATER_PUBLIC_KEY: 'p' }, {}, () => { throw new Error('ENOENT secret/path') })
  assert.equal(unreadable.missing.length, 1)
  assert.doesNotMatch(unreadable.missing[0], /ENOENT/u)
})

test('parses arguments and rejects bad combinations', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, publish: false, clobber: false, macDir: null })
  assert.deepEqual(parseArgs(['--dry-run', '--publish', '--clobber', '--mac-dir', 'D:\\mac']),
    { dryRun: true, publish: true, clobber: true, macDir: 'D:\\mac' })
  assert.equal(parseArgs(['--mac-dir=/tmp/m']).macDir, '/tmp/m')
  assert.throws(() => parseArgs(['--mac-dir']), /folder/u)
  assert.throws(() => parseArgs(['--mac-dir', '--publish']), /folder/u)
  assert.throws(() => parseArgs(['--clobber']), /--publish/u)
  assert.throws(() => parseArgs(['--nope']), /Unknown/u)
})

test('fixed env matches the workflow', () => {
  assert.deepEqual(fixedEnv(), { IWAE_REQUIRE_UPDATER: '1', IWAE_UPDATER_ENDPOINT: 'https://github.com/radic2682/IWAE/releases/latest/download/latest.json' })
  assert.equal(UPDATER_ENDPOINT, fixedEnv().IWAE_UPDATER_ENDPOINT)
})

test('selects Windows artifacts and requires the NSIS signature', () => {
  const sel = selectWindowsArtifacts(['IWAE_0.1.9_x64-setup.exe', 'IWAE_0.1.9_x64-setup.exe.sig'], ['IWAE_0.1.9_x64_en-US.msi', 'IWAE_0.1.9_x64_en-US.msi.sig'], '0.1.9')
  assert.deepEqual(sel, { nsis: 'IWAE_0.1.9_x64-setup.exe', nsisSig: 'IWAE_0.1.9_x64-setup.exe.sig', msi: 'IWAE_0.1.9_x64_en-US.msi', msiSig: 'IWAE_0.1.9_x64_en-US.msi.sig' })
  assert.throws(() => selectWindowsArtifacts(['IWAE_0.1.9_x64-setup.exe'], [], '0.1.9'), /signature/u)
  assert.throws(() => selectWindowsArtifacts(['IWAE_0.1.8_x64-setup.exe', 'IWAE_0.1.8_x64-setup.exe.sig'], [], '0.1.9'), /not generated/u)
  assert.equal(selectWindowsArtifacts(['a_0.1.9-setup.exe', 'a_0.1.9-setup.exe.sig'], [], '0.1.9').msi, null)
})

test('selects mac artifacts', () => {
  const sel = selectMacArtifacts(['IWAE_0.1.9_universal.dmg', 'IWAE_0.1.9_universal.app.tar.gz', 'IWAE_0.1.9_universal.app.tar.gz.sig', 'notes.txt'])
  assert.deepEqual(sel, { dmgs: ['IWAE_0.1.9_universal.dmg'], archive: 'IWAE_0.1.9_universal.app.tar.gz', archiveSig: 'IWAE_0.1.9_universal.app.tar.gz.sig' })
  assert.throws(() => selectMacArtifacts(['x.dmg']), /app\.tar\.gz/u)
  assert.throws(() => selectMacArtifacts(['x.app.tar.gz']), /\.sig/u)
  assert.throws(() => selectMacArtifacts(['a.app.tar.gz', 'b.app.tar.gz']), /Several/u)
})

test('lists upload files with latest.json last and builds manifest env', () => {
  const windows = { nsis: 'a-setup.exe', nsisSig: 'a-setup.exe.sig', msi: 'a.msi', msiSig: null }
  const mac = { dmgs: ['m.dmg'], archive: 'm.app.tar.gz', archiveSig: 'm.app.tar.gz.sig' }
  assert.deepEqual(uploadList({ windows, mac: null }), ['a-setup.exe', 'a-setup.exe.sig', 'a.msi', 'latest.json'])
  assert.deepEqual(uploadList({ windows, mac }), ['a-setup.exe', 'a-setup.exe.sig', 'a.msi', 'm.dmg', 'm.app.tar.gz', 'm.app.tar.gz.sig', 'latest.json'])
  const dir = distDir('C:\\r', '0.1.9')
  assert.equal(dir, join('C:\\r', 'dist-release', 'v0.1.9'))
  assert.deepEqual(manifestEnv({ dir, windows, mac: null, tag: 'v0.1.9', pubDate: '2026-11-10T00:00:00Z' }), {
    IWAE_UPDATER_BUNDLE: join(dir, 'a-setup.exe'),
    IWAE_UPDATER_MAC_BUNDLE: '',
    IWAE_RELEASE_TAG: 'v0.1.9',
    GITHUB_REPOSITORY: REPOSITORY,
    IWAE_UPDATE_PUB_DATE: '2026-11-10T00:00:00Z',
    IWAE_UPDATE_MANIFEST: join(dir, 'latest.json'),
  })
  assert.equal(manifestEnv({ dir, windows, mac, tag: 'v0.1.9', pubDate: 'x' }).IWAE_UPDATER_MAC_BUNDLE, join(dir, 'm.app.tar.gz'))
})

test('builds gh arguments', () => {
  const create = ghCreateArgs({ tag: 'v0.1.9', dir: 'D', files: ['a', 'latest.json'] })
  assert.deepEqual(create.slice(0, 11), ['release', 'create', 'v0.1.9', '--repo', 'radic2682/IWAE', '--verify-tag', '--title', 'v0.1.9', '--generate-notes', '--latest', join('D', 'a')])
  assert.equal(create.at(-1), join('D', 'latest.json'))
  assert.deepEqual(ghUploadArgs({ tag: 'v0.1.9', dir: 'D', files: ['a'] }), ['release', 'upload', 'v0.1.9', '--repo', 'radic2682/IWAE', '--clobber', join('D', 'a')])
})

test('plan mentions publishing and the Windows-only note', () => {
  assert.ok(buildSteps({ publish: false, clobber: false, hasMac: false }).some((s) => /Windows-only/u.test(s)))
  assert.ok(buildSteps({ publish: true, clobber: true, hasMac: true }).some((s) => /upload --clobber/u.test(s)))
})
