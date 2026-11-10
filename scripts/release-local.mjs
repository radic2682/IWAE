// 이 PC 에서 Windows 릴리즈를 빌드하고 gh 로 올린다(Actions 분을 쓰지 않는다).
//
//   node scripts/release-local.mjs --dry-run            계획만 출력
//   node scripts/release-local.mjs                      빌드·검증·dist-release/v<버전>/ 정리까지
//   node scripts/release-local.mjs --publish            위에 더해 GitHub 릴리즈 생성(태그가 이미 push 되어 있어야 함)
//   --clobber          이미 있는 릴리즈에 파일을 덮어써 올린다
//   --mac-dir <폴더>   맥에서 빌드한 *.dmg / *.app.tar.gz(.sig) 를 함께 올린다
//
// 비밀 값은 저장소 밖 env 파일(기본 C:\Workspace\.iwae-release\release.env, IWAE_RELEASE_ENV 로 변경)에서 읽는다.
// 비밀 값은 어디에도 출력·기록하지 않는다. 태그를 만들거나 push 하지 않는다.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'radic2682/IWAE'
export const UPDATER_ENDPOINT = `https://github.com/${REPOSITORY}/releases/latest/download/latest.json`
export const DEFAULT_ENV_FILE = 'C:\\Workspace\\.iwae-release\\release.env'
export const SECRET_KEYS = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'IWAE_UPDATER_PUBLIC_KEY']

/** KEY=VALUE 줄, # 주석, 빈 줄. 값 양끝의 짝 맞는 따옴표는 벗긴다. */
export function parseEnvFile(text) {
  const out = {}
  for (const rawLine of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

/**
 * 이미 설정된 process.env 값이 env 파일보다 우선한다. 개인 키는 값 또는 *_PATH 의 파일 내용.
 * 반환: { values: 빌드에 넘길 비밀 값, missing: 빠진 키 이름 }. 값 자체는 오류 메시지에 쓰지 않는다.
 */
export function resolveSecrets(fileEnv, processEnv, readKeyFile = (path) => readFileSync(path, 'utf8')) {
  const pick = (key) => {
    const fromProcess = processEnv[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
    return fileEnv[key] ?? ''
  }
  const values = {}
  const missing = []
  let privateKey = pick('TAURI_SIGNING_PRIVATE_KEY').trim()
  if (privateKey === '') {
    const keyPath = pick('TAURI_SIGNING_PRIVATE_KEY_PATH').trim()
    if (keyPath !== '') {
      try {
        privateKey = readKeyFile(keyPath).trim()
      } catch {
        missing.push('TAURI_SIGNING_PRIVATE_KEY_PATH (file not readable)')
      }
    }
  }
  if (privateKey !== '') values.TAURI_SIGNING_PRIVATE_KEY = privateKey
  else if (missing.length === 0) missing.push('TAURI_SIGNING_PRIVATE_KEY (or TAURI_SIGNING_PRIVATE_KEY_PATH)')
  // 비밀번호는 비어 있어도 된다
  values.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = pick('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
  const publicKey = pick('IWAE_UPDATER_PUBLIC_KEY').trim()
  if (publicKey !== '') values.IWAE_UPDATER_PUBLIC_KEY = publicKey
  else missing.push('IWAE_UPDATER_PUBLIC_KEY')
  return { values, missing }
}

export function parseArgs(argv) {
  const options = { dryRun: false, publish: false, clobber: false, macDir: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--publish') options.publish = true
    else if (arg === '--clobber') options.clobber = true
    else if (arg === '--mac-dir') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw new Error('--mac-dir needs a folder.')
      options.macDir = next
      i += 1
    } else if (arg.startsWith('--mac-dir=')) {
      options.macDir = arg.slice('--mac-dir='.length)
      if (options.macDir === '') throw new Error('--mac-dir needs a folder.')
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.clobber && !options.publish) throw new Error('--clobber only makes sense together with --publish.')
  return options
}

/** 워크플로와 같은 고정 환경 변수 */
export function fixedEnv() {
  return { IWAE_REQUIRE_UPDATER: '1', IWAE_UPDATER_ENDPOINT: UPDATER_ENDPOINT }
}

export function tagFor(version) {
  return `v${version}`
}

/** 파일 이름 목록에서 NSIS/MSI 산출물을 고른다. 폴더는 호출 쪽에서 붙인다. */
export function selectWindowsArtifacts(nsisNames, msiNames, version) {
  const exes = nsisNames.filter((name) => name.endsWith('-setup.exe') && name.includes(version))
  if (exes.length === 0) throw new Error(`NSIS -setup.exe for ${version} was not generated.`)
  if (exes.length > 1) throw new Error(`Several NSIS -setup.exe files match ${version}: ${exes.join(', ')}`)
  const exe = exes[0]
  if (!nsisNames.includes(`${exe}.sig`)) throw new Error(`NSIS updater signature was not generated for ${exe}.`)
  const msis = msiNames.filter((name) => name.endsWith('.msi') && name.includes(version))
  const result = { nsis: exe, nsisSig: `${exe}.sig`, msi: null, msiSig: null }
  if (msis.length > 0) {
    result.msi = msis[0]
    if (msiNames.includes(`${msis[0]}.sig`)) result.msiSig = `${msis[0]}.sig`
  }
  return result
}

export function selectMacArtifacts(names) {
  const dmgs = names.filter((name) => name.endsWith('.dmg'))
  const archives = names.filter((name) => name.endsWith('.app.tar.gz'))
  if (archives.length === 0) throw new Error('No *.app.tar.gz found in the mac folder.')
  if (archives.length > 1) throw new Error(`Several *.app.tar.gz files in the mac folder: ${archives.join(', ')}`)
  const archive = archives[0]
  if (!names.includes(`${archive}.sig`)) throw new Error(`Missing ${archive}.sig in the mac folder.`)
  return { dmgs, archive, archiveSig: `${archive}.sig` }
}

export function distDir(root, version) {
  return join(root, 'dist-release', tagFor(version))
}

/** 올릴 파일 이름(dist 폴더 기준), latest.json 은 마지막 */
export function uploadList({ windows, mac }) {
  const files = [windows.nsis, windows.nsisSig]
  if (windows.msi) files.push(windows.msi)
  if (windows.msiSig) files.push(windows.msiSig)
  if (mac) files.push(...mac.dmgs, mac.archive, mac.archiveSig)
  files.push('latest.json')
  return files
}

/** write-update-manifest.mjs 에 넘길 환경 변수 */
export function manifestEnv({ dir, windows, mac, tag, pubDate }) {
  return {
    IWAE_UPDATER_BUNDLE: join(dir, windows.nsis),
    IWAE_UPDATER_MAC_BUNDLE: mac ? join(dir, mac.archive) : '',
    IWAE_RELEASE_TAG: tag,
    GITHUB_REPOSITORY: REPOSITORY,
    IWAE_UPDATE_PUB_DATE: pubDate,
    IWAE_UPDATE_MANIFEST: join(dir, 'latest.json'),
  }
}

export function ghCreateArgs({ tag, dir, files }) {
  return ['release', 'create', tag, '--repo', REPOSITORY, '--verify-tag', '--title', tag, '--generate-notes', '--latest',
    ...files.map((name) => join(dir, name))]
}

export function ghUploadArgs({ tag, dir, files }) {
  return ['release', 'upload', tag, '--repo', REPOSITORY, '--clobber', ...files.map((name) => join(dir, name))]
}

export function buildSteps({ publish, clobber, hasMac }) {
  const steps = [
    'npm run test:release-scripts',
    'npm test',
    'npm run release:build',
    'npm run verify:ocr-dist',
    'check NSIS -setup.exe and .sig',
    'collect files into dist-release/v<version>/',
    'write latest.json',
  ]
  if (publish) steps.push(clobber ? 'gh release upload --clobber (create if missing)' : 'gh release create (fails if it already exists)')
  else steps.push('(no --publish: stop before uploading)')
  if (!hasMac) steps.push('note: Windows-only release')
  return steps
}

export const WINDOWS_ONLY_NOTE = 'Note: Windows-only release (no --mac-dir), so latest.json has no macOS entry and Mac users will not get this update.'

// ---- 실행부 ----

function run(command, args, { env = process.env, cwd } = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' && command === 'npm' })
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${command} ${args.join(' ')}`)
}

function capture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir) : []
}

function loadSecrets() {
  const envFile = process.env.IWAE_RELEASE_ENV?.trim() || DEFAULT_ENV_FILE
  const fileFound = existsSync(envFile)
  const fileEnv = fileFound ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
  const { values, missing } = resolveSecrets(fileEnv, process.env)
  return { envFile, fileFound, values, missing }
}

function secretsProblem(secrets) {
  if (secrets.missing.length === 0) return null
  if (!secrets.fileFound) {
    return `Secrets file not found: ${secrets.envFile}\n    Create it with KEY=VALUE lines for: ${SECRET_KEYS.join(', ')}\n    (TAURI_SIGNING_PRIVATE_KEY_PATH may replace the private key; the password may be empty.)`
  }
  return `Missing secrets in ${secrets.envFile}: ${secrets.missing.join(', ')}`
}

function preflight(root) {
  const problems = []
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const tag = tagFor(version)
  if (capture('git', ['status', '--porcelain'], root) !== '') problems.push('Working tree is not clean. Commit or stash your changes first.')
  let head = ''
  try { head = capture('git', ['rev-parse', 'HEAD'], root) } catch { /* no commits */ }
  let tagCommit = ''
  try { tagCommit = capture('git', ['rev-list', '-n', '1', tag], root) } catch { /* tag missing */ }
  if (tagCommit === '') {
    problems.push(`Tag ${tag} does not exist locally. Create and push it yourself (this script never does):\n    git tag ${tag}\n    git push origin ${tag}`)
  } else if (tagCommit !== head) {
    problems.push(`Tag ${tag} does not point at HEAD (tag ${tagCommit.slice(0, 7)}, HEAD ${head.slice(0, 7)}). Move or recreate the tag deliberately.`)
  }
  return { version, tag, problems }
}

function ensurePdfium(root) {
  const dll = join(root, 'src-tauri', 'binaries', 'pdfium.dll')
  if (existsSync(dll)) return 'present'
  run('node', [join(root, 'scripts', 'fetch-pdfium.mjs')], { cwd: root })
  if (!existsSync(dll)) throw new Error('PDFium fetch finished but src-tauri/binaries/pdfium.dll is missing.')
  return 'fetched'
}

function tagPushed(root, tag) {
  return capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], root) !== ''
}

function releaseExists(root, tag) {
  return spawnSync('gh', ['release', 'view', tag, '--repo', REPOSITORY], { cwd: root, stdio: 'ignore' }).status === 0
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const options = parseArgs(process.argv.slice(2))
  const secrets = loadSecrets()
  const { version, tag, problems } = preflight(root)
  const dir = distDir(root, version)
  const macDir = options.macDir === null ? null : resolve(options.macDir)
  const secretIssue = secretsProblem(secrets)
  if (secretIssue !== null) problems.unshift(secretIssue)

  if (options.dryRun) {
    console.log(`IWAE local release plan for ${tag}`)
    console.log(`  env file: ${secrets.envFile} (${secrets.fileFound ? 'found' : 'MISSING'})`)
    const has = (key) => !secrets.missing.some((m) => m.startsWith(key))
    console.log(`  TAURI_SIGNING_PRIVATE_KEY: ${has('TAURI_SIGNING_PRIVATE_KEY') ? 'yes' : 'no'}`)
    console.log(`  IWAE_UPDATER_PUBLIC_KEY: ${has('IWAE_UPDATER_PUBLIC_KEY') ? 'yes' : 'no'}`)
    console.log(`  pdfium.dll: ${existsSync(join(root, 'src-tauri', 'binaries', 'pdfium.dll')) ? 'present' : 'will be fetched'}`)
    console.log(`  output: ${dir}`)
    console.log(`  mac dir: ${macDir ?? '(none)'}`)
    console.log('  steps:')
    buildSteps({ publish: options.publish, clobber: options.clobber, hasMac: macDir !== null }).forEach((step, i) => console.log(`    ${i + 1}. ${step}`))
    if (problems.length > 0) {
      console.error('\nProblems that would stop a real run:')
      problems.forEach((p) => console.error(`- ${p}`))
      process.exitCode = 1
    }
    return
  }

  if (problems.length > 0) throw new Error(problems.join('\n'))

  const macSel = macDir === null ? null : selectMacArtifacts(listDir(macDir))
  if (options.publish) {
    if (!tagPushed(root, tag)) throw new Error(`Tag ${tag} is not on origin. Push it yourself first:\n    git push origin ${tag}`)
    if (releaseExists(root, tag) && !options.clobber) throw new Error(`Release ${tag} already exists. Use --clobber to overwrite its files.`)
  }

  console.log(`Releasing ${tag} (pdfium.dll ${ensurePdfium(root)})`)
  const env = { ...process.env, ...secrets.values, ...fixedEnv() }
  run('npm', ['run', 'test:release-scripts'], { env, cwd: root })
  run('npm', ['test'], { env, cwd: root })
  run('npm', ['run', 'release:build'], { env, cwd: root })
  run('npm', ['run', 'verify:ocr-dist'], { env, cwd: root })

  const bundle = join(root, 'src-tauri', 'target', 'release', 'bundle')
  const windows = selectWindowsArtifacts(listDir(join(bundle, 'nsis')), listDir(join(bundle, 'msi')), version)

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(bundle, 'nsis', windows.nsis), join(dir, windows.nsis))
  copyFileSync(join(bundle, 'nsis', windows.nsisSig), join(dir, windows.nsisSig))
  if (windows.msi) copyFileSync(join(bundle, 'msi', windows.msi), join(dir, windows.msi))
  if (windows.msiSig) copyFileSync(join(bundle, 'msi', windows.msiSig), join(dir, windows.msiSig))
  if (macSel) for (const name of [...macSel.dmgs, macSel.archive, macSel.archiveSig]) copyFileSync(join(macDir, name), join(dir, basename(name)))
  else console.log(`\n${WINDOWS_ONLY_NOTE}`)

  const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  run('node', [join(root, 'scripts', 'write-update-manifest.mjs')], {
    env: { ...process.env, ...manifestEnv({ dir, windows, mac: macSel, tag, pubDate }) },
    cwd: root,
  })

  const files = uploadList({ windows, mac: macSel })
  console.log(`\nPrepared ${dir}:\n${files.map((f) => `  ${f}`).join('\n')}`)
  if (!options.publish) {
    console.log('\nNot published (no --publish).')
    return
  }
  if (releaseExists(root, tag)) run('gh', ghUploadArgs({ tag, dir, files }), { cwd: root })
  else run('gh', ghCreateArgs({ tag, dir, files }), { cwd: root })
  console.log(`\nPublished https://github.com/${REPOSITORY}/releases/tag/${tag}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
