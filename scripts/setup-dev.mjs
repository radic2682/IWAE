// Runs `tauri dev` for the setup app in demo mode. The tauri CLI picks the
// project from its cwd, so we start it inside setup/ (works from cmd and bash).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

const child = spawn(process.execPath, [cli, 'dev', '--', '--', '--demo'], {
  cwd: resolve(root, 'setup'),
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 1))
