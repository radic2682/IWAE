import { pageTextIndex } from '../../bridge/pdf'
import {
  listVaultTree,
  readLibrary,
  readPdfHighlights,
  registerUnlistedVaultPdfs,
  writePdfHighlights,
  writeVaultRelativeText,
  type VaultHandle,
} from '../../bridge/vault'
import { isDesktop } from '../../bridge/window'
import { seedSampleVault, type SampleManifest } from './sampleVault'
import { getLocale, t } from '../../i18n'

const ASSET_BASE = '/sample-vault/'

async function fetchAsset(file: string): Promise<ArrayBuffer> {
  const response = await fetch(`${ASSET_BASE}${file}`)
  if (!response.ok) throw new Error(t('예시 파일을 읽지 못했습니다: {file}', { file }))
  return response.arrayBuffer()
}

/** 빈 Vault 에 예시를 넣는다(데스크톱만). 넣었으면 true */
export async function seedSampleVaultInto(vault: VaultHandle): Promise<boolean> {
  if (!isDesktop()) return false
  // 예시는 화면 언어에 맞춘다(영어면 영어 설명서·노트)
  const manifestFile = getLocale() === 'en' ? 'manifest.en.json' : 'manifest.json'
  const manifest = JSON.parse(new TextDecoder().decode(await fetchAsset(manifestFile))) as SampleManifest
  return seedSampleVault({
    isEmpty: async () => (await listVaultTree(vault)).every((entry) => entry.path.replaceAll('\\', '/').split('/').some((part) => part.startsWith('..'))),
    fetchAsset,
    writeBinary: async (relativePath, data) => {
      const { join } = await import('@tauri-apps/api/path')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(await join(vault.root, ...relativePath.split('/')), data)
    },
    writeText: (relativePath, text) => writeVaultRelativeText(vault, relativePath, text),
    registerPdf: async (relativePath) => {
      await registerUnlistedVaultPdfs(vault)
      const name = relativePath.replaceAll('\\', '/').toLocaleLowerCase()
      const entry = (await readLibrary(vault)).find((item) => item.path.replaceAll('\\', '/').toLocaleLowerCase().endsWith(`/${name}`))
      return entry?.docId ?? null
    },
    pageText: pageTextIndex,
    readHighlights: () => readPdfHighlights(vault),
    writeHighlights: (highlights) => writePdfHighlights(vault, highlights),
  }, manifest)
}
