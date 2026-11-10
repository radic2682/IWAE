// 새 Vault 예시로 넣는 「IWAE 사용 설명서」 PDF 를 docs/manual/iwae-manual.html 에서 만든다.
// Chromium 계열 브라우저(Edge·Chrome)의 headless 인쇄를 쓴다(제목은 PDF 목차로 들어간다). 글꼴은 Noto Sans KR(OFL, 포함 허용)을 쓴다.
//
//   node scripts/build-sample-manual.mjs [브라우저 경로]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 한국어·영어 두 판
const MANUALS = [
  ['../docs/manual/iwae-manual.html', '../public/sample-vault/iwae-manual.pdf'],
  ['../docs/manual/iwae-manual.en.html', '../public/sample-vault/iwae-manual.en.pdf'],
].map(([from, to]) => [fileURLToPath(new URL(from, import.meta.url)), fileURLToPath(new URL(to, import.meta.url))])
const candidates = [
  process.argv[2],
  process.env.IWAE_CHROMIUM,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter((value) => typeof value === 'string' && value !== '')
const browser = candidates.find((path) => existsSync(path))
if (browser === undefined) {
  console.error('Edge 또는 Chrome 을 찾지 못했습니다. 경로를 인자로 주세요.')
  process.exit(1)
}
// headless 브라우저는 인쇄가 끝나기 전에 먼저 돌아올 수 있어, 파일이 새로 쓰이고 크기가 멈출 때까지 기다린다.
async function waitForFile(path, since) {
  let lastSize = -1
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(500)
    if (!existsSync(path)) continue
    const stats = statSync(path)
    if (stats.mtimeMs >= since && stats.size > 0 && stats.size === lastSize) return stats.size
    lastSize = stats.mtimeMs >= since ? stats.size : -1
  }
  throw new Error(`PDF 가 만들어지지 않았습니다: ${path}`)
}

// 브라우저가 대상 파일을 직접 바꿔 쓰지 못하는 경우(앱이 그 PDF 를 열어 둔 때)가 있어, 임시 폴더에 만든 뒤 복사한다.
const scratch = mkdtempSync(join(tmpdir(), 'iwae-manual-'))
for (const [source, finalOutput] of MANUALS) {
  const output = join(scratch, `${MANUALS.findIndex((item) => item[1] === finalOutput)}.pdf`)
  const startedAt = Date.now() - 1000
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--generate-pdf-document-outline',
    `--print-to-pdf=${output}`,
    pathToFileURL(source).href,
  ], { stdio: 'inherit' })
  const size = await waitForFile(output, startedAt)
  copyFileSync(output, finalOutput)
  console.log(`${finalOutput} (${size} bytes)`)
}
