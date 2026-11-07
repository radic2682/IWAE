import { basename, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

function required(value, label) {
  const normalized = value?.trim() ?? ''
  if (normalized === '') throw new Error(`Missing ${label}.`)
  return normalized
}

function normalizedVersion(value) {
  return required(value, 'version').replace(/^v/u, '')
}

export function createUpdateManifest({
  version,
  packageVersion,
  tag,
  repository,
  bundleName,
  signature,
  macBundleName,
  macSignature,
  notes,
  pubDate,
}) {
  const releaseVersion = normalizedVersion(version)
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(releaseVersion)) {
    throw new Error('Release version must be valid SemVer.')
  }
  if (normalizedVersion(packageVersion) !== releaseVersion || normalizedVersion(tag) !== releaseVersion) {
    throw new Error('Release, package, and tag versions must match.')
  }
  const repo = required(repository, 'GitHub repository')
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repo)) throw new Error('GitHub repository must use owner/name format.')
  const asset = required(bundleName, 'NSIS updater bundle')
  // Tauri v2 updater artifacts sign the NSIS installer itself; .nsis.zip only exists in v1Compatible mode.
  if (!asset.endsWith('-setup.exe')) throw new Error('Updater bundle must be the NSIS -setup.exe installer.')
  const inlineSignature = required(signature, 'updater signature')
  const publishedAt = required(pubDate, 'publication date')
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error('Publication date must be RFC 3339 compatible.')
  const releaseTag = required(tag, 'release tag')
  const assetUrl = (name) => `https://github.com/${repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(name)}`
  const platforms = {
    'windows-x86_64': { signature: inlineSignature, url: assetUrl(asset) },
  }
  // macOS: 하나의 universal .app.tar.gz 가 Apple Silicon·Intel 둘 다 맡는다
  if ((macBundleName?.trim() ?? '') !== '') {
    const macAsset = macBundleName.trim()
    if (!macAsset.endsWith('.app.tar.gz')) throw new Error('macOS updater bundle must be the .app.tar.gz archive.')
    const mac = { signature: required(macSignature, 'macOS updater signature'), url: assetUrl(macAsset) }
    platforms['darwin-aarch64'] = mac
    platforms['darwin-x86_64'] = mac
  }

  return {
    version: releaseVersion,
    notes: notes?.trim() ?? '',
    pub_date: publishedAt,
    platforms,
  }
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const bundlePath = required(process.env.IWAE_UPDATER_BUNDLE, 'IWAE_UPDATER_BUNDLE')
  const signaturePath = process.env.IWAE_UPDATER_SIGNATURE?.trim() || `${bundlePath}.sig`
  const macBundlePath = process.env.IWAE_UPDATER_MAC_BUNDLE?.trim() ?? ''
  const outputPath = resolve(process.env.IWAE_UPDATE_MANIFEST?.trim() || resolve(root, 'latest.json'))
  const manifest = createUpdateManifest({
    version: packageMetadata.version,
    packageVersion: packageMetadata.version,
    tag: required(process.env.IWAE_RELEASE_TAG, 'IWAE_RELEASE_TAG'),
    repository: required(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
    bundleName: basename(bundlePath),
    signature: await readFile(signaturePath, 'utf8'),
    ...(macBundlePath === '' ? {} : {
      macBundleName: basename(macBundlePath),
      macSignature: await readFile(`${macBundlePath}.sig`, 'utf8'),
    }),
    notes: process.env.IWAE_UPDATE_NOTES ?? 'IWAE stability and feature update.',
    pubDate: process.env.IWAE_UPDATE_PUB_DATE ?? new Date().toISOString(),
  })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Updater manifest written to ${outputPath}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
