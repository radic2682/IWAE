// 새 Vault 예시로 넣는 「IWAE 사용 설명서」 PDF 를 docs/manual/iwae-manual.html 에서 만든다.
// Chromium 계열 브라우저(Edge·Chrome)의 headless 인쇄를 쓴다. 글꼴은 Noto Sans KR(OFL, 포함 허용)을 쓴다.
//
//   node scripts/build-sample-manual.mjs [브라우저 경로]
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
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
for (const [source, output] of MANUALS) {
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
    pathToFileURL(source).href,
  ], { stdio: 'inherit' })
  console.log(`${output} (${statSync(output).size} bytes)`)
}
