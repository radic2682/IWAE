import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isDesktopBuild, pruneBrowserPreviewAssets } from './desktopBuildPrune'

const made: string[] = []
function fakeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iwae-dist-'))
  made.push(dir)
  mkdirSync(join(dir, 'dev-pdf'))
  writeFileSync(join(dir, 'dev-pdf', 'page-1.png'), 'x')
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('desktop build prune', () => {
  it('removes the browser-preview samples in a tauri build only', () => {
    const desktop = fakeDist()
    expect(pruneBrowserPreviewAssets(desktop, { TAURI_ENV_PLATFORM: 'windows' })).toBe(true)
    expect(existsSync(join(desktop, 'dev-pdf'))).toBe(false)
    expect(existsSync(join(desktop, 'index.html'))).toBe(true)

    const web = fakeDist()
    expect(pruneBrowserPreviewAssets(web, {})).toBe(false)
    expect(pruneBrowserPreviewAssets(web, { TAURI_ENV_PLATFORM: '' })).toBe(false)
    expect(existsSync(join(web, 'dev-pdf', 'page-1.png'))).toBe(true)
  })

  it('does not fail when the folder is already gone', () => {
    const dir = fakeDist()
    rmSync(join(dir, 'dev-pdf'), { recursive: true })
    expect(() => pruneBrowserPreviewAssets(dir, { TAURI_ENV_PLATFORM: 'windows' })).not.toThrow()
    expect(isDesktopBuild({ TAURI_ENV_PLATFORM: 'linux' })).toBe(true)
  })
})
