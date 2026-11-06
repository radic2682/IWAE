// 배포 전 검사: 저장소에 올라갈 파일에 개인·회사 정보가 들어 있지 않은지 본다.
//
// - 금지어 목록은 저장소 밖(또는 git 이 무시하는) 파일에 둔다. 목록 자체가 지울 정보라서다.
//   기본: <저장소>/.release-denylist.txt (한 줄에 하나, # 은 주석). 다른 곳이면 IWAE_RELEASE_DENYLIST=<경로>
// - 금지어 목록과 상관없이 늘 찾는 것: 개인 폴더 경로(C:\Users\<이름>), 이메일 주소(example.com·noreply 제외)
// - 검사 대상: 인자로 준 폴더(배포용으로 새로 만든 사본) 안의 파일, 없으면 이 저장소의 git 추적 파일
//
//   node scripts/release-scan.mjs            # 이 저장소
//   node scripts/release-scan.mjs D:/iwae-public
import { execFileSync } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.tmp', 'gen'])
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|pdf|ttf|otf|woff2?|wasm|dll|exe|zip|gz|onnx|bin|sqlite)$/iu
const ALLOWED_EMAIL = /@(?:example\.(?:com|org|net)|[\w.-]*\.(?:example|test|invalid|localhost)|users\.noreply\.github\.com)$|^noreply@/iu

/** 금지어 목록 글 → 낱말들(빈 줄·주석 뺌) */
export function parseDenylist(text) {
  return text.split(/\r?\n/u).map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line !== '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 낱말 경계로(앞뒤가 영숫자가 아닐 때) 대소문자 없이 찾는다 */
export function denylistMatcher(words) {
  if (words.length === 0) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
}

/** 한 파일의 글에서 걸리는 줄들: { line, rule, text } */
export function scanText(text, matcher) {
  const hits = []
  const lines = text.split(/\r?\n/u)
  lines.forEach((content, index) => {
    const line = index + 1
    // 일부러 넣은 예시(이 검사기의 시험 등)는 그 줄에 release-scan-allow 를 단다
    if (content.includes('release-scan-allow')) return
    const word = matcher?.exec(content)
    if (word) hits.push({ line, rule: `금지어 "${word[0]}"`, text: content.trim() })
    const userPath = /[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<|\$|%|you\b|me\b|name\b)[^\\/\s'"`]+/iu.exec(content)
    if (userPath) hits.push({ line, rule: '개인 폴더 경로', text: content.trim() })
    for (const email of content.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu)) {
      if (!ALLOWED_EMAIL.test(email[0]) && !/^[\w.+-]+@\d/u.test(email[0]) && /\.[a-z]{2,}$/iu.test(email[0])) {
        hits.push({ line, rule: `이메일 ${email[0]}`, text: content.trim() })
      }
    }
  })
  return hits
}

async function walk(root, dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)))
    }
  }
  return out
}

function gitFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((name) => name !== '')
}

async function main() {
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const target = process.argv[2] === undefined ? repoRoot : resolve(process.argv[2])
  const denylistPath = process.env.IWAE_RELEASE_DENYLIST ?? join(repoRoot, '.release-denylist.txt')
  const words = existsSync(denylistPath) ? parseDenylist(await readFile(denylistPath, 'utf8')) : []
  if (words.length === 0) console.warn(`금지어 목록이 없습니다(${denylistPath}). 경로·이메일만 검사합니다.`)
  const matcher = denylistMatcher(words)
  const files = process.argv[2] === undefined ? gitFiles(target) : await walk(target)
  const denylistName = relative(target, denylistPath).replaceAll('\\', '/')
  let count = 0
  for (const file of files) {
    const name = file.replaceAll('\\', '/')
    if (BINARY.test(name) || name === denylistName) continue
    const path = join(target, file)
    if (!existsSync(path) || (await stat(path)).size > 5_000_000) continue
    const hits = scanText(await readFile(path, 'utf8'), matcher)
    for (const hit of hits) {
      count += 1
      console.log(`${name}:${hit.line}  [${hit.rule}]  ${hit.text.slice(0, 160)}`)
    }
  }
  if (count > 0) {
    console.error(`\n배포 검사 실패: ${count} 곳. 위 줄을 고친 뒤 다시 돌리세요.`)
    process.exitCode = 1
    return
  }
  console.log(`배포 검사 통과 (${files.length} 파일, 금지어 ${words.length} 개).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
