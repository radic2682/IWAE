import { writeFile } from 'node:fs/promises'
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

export function createUpdaterConfig(env) {
  if (!enabled(env.IWAE_REQUIRE_UPDATER)) return {}
  if (!realHttpsEndpoint(env.IWAE_UPDATER_ENDPOINT) || !realValue(env.IWAE_UPDATER_PUBLIC_KEY)) {
    throw new Error('Updater configuration is incomplete. Run npm run release:check for required values.')
  }
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        endpoints: [env.IWAE_UPDATER_ENDPOINT.trim()],
        pubkey: env.IWAE_UPDATER_PUBLIC_KEY.trim(),
        windows: { installMode: 'passive' },
      },
    },
  }
}

async function main() {
  const output = fileURLToPath(new URL('../src-tauri/tauri.updater.conf.json', import.meta.url))
  const config = createUpdaterConfig(process.env)
  await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(`Updater build override written (${Object.keys(config).length === 0 ? 'inactive' : 'active'}).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
