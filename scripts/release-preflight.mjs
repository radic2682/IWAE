import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

function enabled(value) {
  return /^(?:1|true|yes|on)$/iu.test(value ?? '')
}

function realValue(value) {
  const normalized = value?.trim() ?? ''
  return normalized !== '' && !/(?:replace[-_ ]?me|placeholder|example[-_ ]?key|changeme)/iu.test(normalized)
}

function realHttpsEndpoint(value) {
  if (!realValue(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== 'example.com'
  } catch {
    return false
  }
}

export function validateReleaseConfiguration({
  env,
  config,
  requireSigning = enabled(env.IWAE_REQUIRE_WINDOWS_SIGNING),
  requireUpdater = enabled(env.IWAE_REQUIRE_UPDATER),
}) {
  const errors = []
  if (config?.app?.security?.csp == null) errors.push('app.security.csp')

  if (
    requireSigning
    && !realValue(env.IWAE_WINDOWS_CERTIFICATE_THUMBPRINT)
    && !realValue(env.IWAE_EXTERNAL_SIGNING_COMMAND)
  ) {
    errors.push('IWAE_WINDOWS_CERTIFICATE_THUMBPRINT or IWAE_EXTERNAL_SIGNING_COMMAND')
  }

  if (requireUpdater) {
    if (!realHttpsEndpoint(env.IWAE_UPDATER_ENDPOINT)) {
      errors.push('IWAE_UPDATER_ENDPOINT (real HTTPS URL)')
    }
    if (!realValue(env.IWAE_UPDATER_PUBLIC_KEY)) errors.push('IWAE_UPDATER_PUBLIC_KEY')
    if (!realValue(env.TAURI_SIGNING_PRIVATE_KEY)) errors.push('TAURI_SIGNING_PRIVATE_KEY')
  }

  return errors
}

async function main() {
  const configUrl = new URL('../src-tauri/tauri.conf.json', import.meta.url)
  const config = JSON.parse(await readFile(configUrl, 'utf8'))
  const errors = validateReleaseConfiguration({ env: process.env, config })
  if (errors.length > 0) {
    console.error(`Release preflight failed. Missing or invalid: ${errors.join(', ')}`)
    process.exitCode = 1
    return
  }
  console.log('Release preflight passed.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
