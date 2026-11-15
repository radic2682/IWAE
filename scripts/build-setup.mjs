// Builds the IWAE setup window and signs it for release (run after `tauri build`, which makes the NSIS exe).
//
//   1. npm run setup:ui
//   2. build iwae-setup without the payload -> stage/uninstall-ui.exe
//   3. write stage/manifest.json (files the NSIS installer puts in the install dir, with sizes)
//   4. build iwae-setup with --features payload (embeds the NSIS exe, uninstall-ui.exe, manifest)
//   5. copy it to src-tauri/target/release/bundle/setup/IWAE_<v>_x64-setup.exe
//   6. tauri signer sign -> <exe>.sig (key and password come from the environment; never logged)
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tauri.conf bundle.resources -> files the NSIS installer writes. A "../x" resource lands in "_up_/x". */
export function installedFiles(resources) {
  const files = resources.map((src) => ({ rel: src.replace(/^(\.\.\/)+/u, (m) => '_up_/'.repeat(m.length / 3)), src }))
  files.push({ rel: 'app.exe', src: 'target/release/app.exe' })
  return files
}

export function payloadManifest(files, statSize) {
  return files.map(({ rel, src }) => ({ rel, size: statSize(src) }))
}

export function setupOutputName(version) {
  return `IWAE_${version}_x64-setup.exe`
}

// ---- runner ----

function run(command, args, { env = process.env, cwd } = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' && command === 'npm' })
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${command} ${args.join(' ')}`)
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const mainTauri = join(root, 'src-tauri')
  const setupDir = join(root, 'setup')
  const targetDir = join(setupDir, 'src-tauri', 'target')
  const cli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

  const nsisExe = join(mainTauri, 'target', 'release', 'bundle', 'nsis', setupOutputName(version))
  if (!existsSync(nsisExe)) throw new Error(`NSIS installer for ${version} is missing: ${nsisExe}\nRun the main tauri build first.`)

  const resources = JSON.parse(readFileSync(join(mainTauri, 'tauri.conf.json'), 'utf8')).bundle.resources
  const files = installedFiles(resources)
  for (const { src } of files) {
    if (!existsSync(join(mainTauri, src))) throw new Error(`Installed file is missing: ${join(mainTauri, src)}`)
  }

  const env = { ...process.env, CARGO_TARGET_DIR: targetDir }
  const builtExe = join(targetDir, 'release', 'iwae-setup.exe')
  const stage = join(targetDir, 'stage')
  mkdirSync(stage, { recursive: true })

  run('npm', ['run', 'setup:ui'], { env, cwd: root })

  // The tauri CLI picks the project from its cwd, so run it inside setup/.
  run(process.execPath, [cli, 'build', '--no-bundle'], { env, cwd: setupDir })
  const uninstallUi = join(stage, 'uninstall-ui.exe')
  copyFileSync(builtExe, uninstallUi)

  const manifest = join(stage, 'manifest.json')
  writeFileSync(manifest, JSON.stringify(payloadManifest(files, (src) => statSync(join(mainTauri, src)).size)))

  const payloadEnv = { ...env, IWAE_SETUP_NSIS: nsisExe, IWAE_SETUP_UNINSTALL_UI: uninstallUi, IWAE_SETUP_MANIFEST: manifest }
  run(process.execPath, [cli, 'build', '--no-bundle', '--features', 'payload'], { env: payloadEnv, cwd: setupDir })

  const outDir = join(mainTauri, 'target', 'release', 'bundle', 'setup')
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, setupOutputName(version))
  copyFileSync(builtExe, out)

  // Key and password are read from the inherited environment by the signer.
  run(process.execPath, [cli, 'signer', 'sign', out], { env, cwd: root })
  if (!existsSync(`${out}.sig`)) throw new Error(`Signature was not produced: ${out}.sig`)
  console.log(`\nSetup window ready: ${out}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
