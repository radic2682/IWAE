import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { decodePng, encodeBmp, generateInstallerAssets, readBmpInfo } from './generate-installer-assets.mjs'

test('generates deterministic 24-bit NSIS header and sidebar bitmaps', async () => {
  const first = await mkdtemp(join(tmpdir(), 'iwae-installer-a-'))
  const second = await mkdtemp(join(tmpdir(), 'iwae-installer-b-'))
  try {
    await generateInstallerAssets(first)
    await generateInstallerAssets(second)

    const firstHeader = await readFile(join(first, 'header.bmp'))
    const secondHeader = await readFile(join(second, 'header.bmp'))
    const sidebar = await readFile(join(first, 'sidebar.bmp'))
    assert.deepEqual(readBmpInfo(firstHeader), { width: 150, height: 57, bitsPerPixel: 24 })
    assert.deepEqual(readBmpInfo(sidebar), { width: 164, height: 314, bitsPerPixel: 24 })
    assert.deepEqual(firstHeader, secondHeader)
  } finally {
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  }
})

test('tauri NSIS configuration is branded, bilingual, and current-user safe', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  assert.deepEqual(config.bundle.windows.nsis.languages, ['English', 'Korean'])
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true)
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser')
  assert.equal(config.bundle.windows.nsis.headerImage, 'installer/header.bmp')
  assert.equal(config.bundle.windows.nsis.sidebarImage, 'installer/sidebar.bmp')
  assert.equal(config.bundle.windows.nsis.installerHooks, 'installer/installer-hooks.nsh')

  const hooks = await readFile(new URL('../src-tauri/installer/installer-hooks.nsh', import.meta.url), 'utf8')
  assert.match(hooks, /Vaults and settings are preserved/u)
  assert.match(hooks, /installer-language/u)
})

test('PNG decoder round-trips into a 24-bit BMP', async () => {
  const { deflateSync } = await import('node:zlib')
  const chunk = (type, body) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length)
    return Buffer.concat([length, Buffer.from(type, 'ascii'), body, Buffer.alloc(4)])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.from([0, 255, 0, 0, 0, 0, 255])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  const image = decodePng(png)
  assert.deepEqual([image.width, image.height, ...image.pixels], [2, 1, 255, 0, 0, 0, 0, 255])
  assert.deepEqual(readBmpInfo(encodeBmp(image)), { width: 2, height: 1, bitsPerPixel: 24 })
})
