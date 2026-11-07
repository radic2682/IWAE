// 지금 OS·CPU 에 맞는 PDFium 을 받아 src-tauri/binaries/ 에 둔다(CI 와 같은 bblanchon/pdfium-binaries).
//
//   node scripts/fetch-pdfium.mjs              지금 기계에 맞는 것
//   node scripts/fetch-pdfium.mjs --universal  macOS 에서 Apple Silicon·Intel 둘 다 되는 것(배포용)
//
// 받은 라이브러리는 저장소에 넣지 않는다(.gitignore 의 src-tauri/binaries/).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = 'https://github.com/bblanchon/pdfium-binaries/releases/latest/download'

/** 플랫폼별 받을 묶음과 그 안의 라이브러리 경로, 둘 이름 */
export function pdfiumAsset(platform, arch, universal = false) {
  if (platform === 'win32' && arch === 'x64') return { archive: 'pdfium-win-x64.tgz', inside: 'bin/pdfium.dll', name: 'pdfium.dll' }
  if (platform === 'win32' && arch === 'arm64') return { archive: 'pdfium-win-arm64.tgz', inside: 'bin/pdfium.dll', name: 'pdfium.dll' }
  if (platform === 'darwin') {
    const archive = universal ? 'pdfium-mac-univ.tgz' : arch === 'arm64' ? 'pdfium-mac-arm64.tgz' : 'pdfium-mac-x64.tgz'
    return { archive, inside: 'lib/libpdfium.dylib', name: 'libpdfium.dylib' }
  }
  if (platform === 'linux' && arch === 'x64') return { archive: 'pdfium-linux-x64.tgz', inside: 'lib/libpdfium.so', name: 'libpdfium.so' }
  throw new Error(`이 플랫폼용 PDFium 은 정해 두지 않았습니다: ${platform}-${arch}`)
}

async function main() {
  const universal = process.argv.includes('--universal')
  const asset = pdfiumAsset(process.platform, process.arch, universal)
  const work = mkdtempSync(join(tmpdir(), 'iwae-pdfium-'))
  try {
    const url = `${RELEASE}/${asset.archive}`
    console.log(`받는 중: ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`받지 못했습니다(${response.status}): ${url}`)
    const archive = join(work, asset.archive)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    execFileSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' })
    const outDir = fileURLToPath(new URL('../src-tauri/binaries/', import.meta.url))
    mkdirSync(outDir, { recursive: true })
    const target = join(outDir, asset.name)
    copyFileSync(join(work, asset.inside), target)
    console.log(`${target} (${statSync(target).size} bytes)`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
