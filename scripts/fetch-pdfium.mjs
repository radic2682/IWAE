// 지금 OS·CPU 에 맞는 PDFium 을 받아 src-tauri/binaries/ 에 둔다(CI 와 같은 bblanchon/pdfium-binaries).
//
//   node scripts/fetch-pdfium.mjs              지금 기계에 맞는 것
//   node scripts/fetch-pdfium.mjs --universal  macOS 에서 Apple Silicon·Intel 둘 다 되는 것(배포용)
//   node scripts/fetch-pdfium.mjs --licenses   받은 묶음의 LICENSE·licenses/ 를 src-tauri/licenses/pdfium-licenses.txt 로 다시 만든다
//
// 받은 라이브러리는 저장소에 넣지 않는다(.gitignore 의 src-tauri/binaries/).
//
// 공급망: `releases/latest` 가 아니라 아래 태그로 **고정**하고, 받은 묶음의 SHA-256 이 PDFIUM_SHA256 과 다르면 아무것도 두지 않고 멈춘다.
// 올릴 때는 PDFIUM_TAG 와 해시를 함께 바꾼다(해시는 `gh release view <태그> -R bblanchon/pdfium-binaries --json assets` 의 digest 와
// 직접 받아 `sha256sum` 한 값이 같은지 확인한다). 지금 번들하는 pdfium.dll 은 157.0.8086.0(= chromium/8086).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PDFIUM_TAG = 'chromium/8086'
const RELEASE = `https://github.com/bblanchon/pdfium-binaries/releases/download/${encodeURIComponent(PDFIUM_TAG)}`

/** 묶음(.tgz)마다 SHA-256. PDFIUM_TAG 와 함께 바꾼다 */
export const PDFIUM_SHA256 = {
  'pdfium-win-x64.tgz': '1fd8af952832dbb0eb16d9249f68fe09e5f5ebf7c3dd9f6066ea2720cc28487d',
  'pdfium-win-arm64.tgz': '1799b8034e6d64946fec0ae79f3edfc8ba58ccd80c70a46194803b1eba408344',
  'pdfium-mac-arm64.tgz': 'e98679e052c07edbb5a627980902abb823d4b3f35744d877bd21668bd9fc13ab',
  'pdfium-mac-x64.tgz': '933a85a138f6027243c56bff8676375c33ceeb767401389415ffc44d689ca85d',
  'pdfium-mac-univ.tgz': 'ceb8dff448db2a2b15ac52e1360427edc3461f2b51cb4579b1462f1a931087d5',
  'pdfium-linux-x64.tgz': '588577cf52dabc1a444988bac841920df54cc2f141801424de97ab04f4fbb935',
}

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

/** 받은 바이트의 SHA-256 이 고정해 둔 값과 같아야 한다. 고정해 둔 값이 없는 묶음도 거절한다 */
export function verifyChecksum(archive, bytes, expected = PDFIUM_SHA256) {
  const want = expected[archive]
  if (want === undefined) throw new Error(`${archive} 의 SHA-256 을 고정해 두지 않았습니다(scripts/fetch-pdfium.mjs 의 PDFIUM_SHA256)`)
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== want) throw new Error(`${archive} 의 SHA-256 이 맞지 않습니다: 기대 ${want}, 받은 것 ${got}. 받은 파일은 쓰지 않습니다`)
  return got
}

/** 묶음 안의 LICENSE 와 licenses/*.txt 를 한 파일로 묶는다(설치 파일에 같이 넣는 고지) */
export function collectLicenses(extracted) {
  const parts = [
    `PDFium (https://pdfium.googlesource.com/pdfium/) binaries from https://github.com/bblanchon/pdfium-binaries, release ${PDFIUM_TAG}.`,
    'The upstream archive carries the licenses below; they are reproduced unchanged.',
  ]
  const add = (title, file) => parts.push(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n\n${readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd()}\n`)
  add('pdfium-binaries (LICENSE)', join(extracted, 'LICENSE'))
  const dir = join(extracted, 'licenses')
  const files = readdirSync(dir).sort((a, b) => (a === 'pdfium.txt' ? -1 : b === 'pdfium.txt' ? 1 : a.localeCompare(b)))
  for (const name of files) add(`licenses/${name}`, join(dir, name))
  return `${parts.join('\n')}\n`
}

async function main() {
  const universal = process.argv.includes('--universal')
  const licensesOnly = process.argv.includes('--licenses')
  const asset = pdfiumAsset(process.platform, process.arch, universal)
  const work = mkdtempSync(join(tmpdir(), 'iwae-pdfium-'))
  try {
    const url = `${RELEASE}/${asset.archive}`
    console.log(`받는 중: ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`받지 못했습니다(${response.status}): ${url}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = verifyChecksum(asset.archive, bytes)
    console.log(`SHA-256 확인: ${digest}`)
    const archive = join(work, asset.archive)
    writeFileSync(archive, bytes)
    // 상대 경로 + cwd: 'C:' 를 원격 호스트로 읽는 GNU tar(Git Bash)에서도 되게
    execFileSync('tar', ['-xzf', asset.archive], { cwd: work, stdio: 'inherit' })
    if (licensesOnly) {
      const out = fileURLToPath(new URL('../src-tauri/licenses/pdfium-licenses.txt', import.meta.url))
      mkdirSync(join(out, '..'), { recursive: true })
      writeFileSync(out, collectLicenses(work))
      console.log(`${out} (${statSync(out).size} bytes)`)
      return
    }
    const outDir = fileURLToPath(new URL('../src-tauri/binaries', import.meta.url))
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
