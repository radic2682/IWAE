import { OCR_WASM_FILE, OCR_WASM_PUBLIC_PATH } from './ocrRuntimeAssets.js'

export function buildAssetFileName(assetInfo: { name?: string }): string | undefined {
  const normalized = assetInfo.name?.replaceAll('\\', '/')
  return normalized?.split('/').at(-1) === OCR_WASM_FILE ? OCR_WASM_PUBLIC_PATH : undefined
}

export function buildChunkName(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/').toLowerCase()
  if (!normalized.includes('/node_modules/')) return undefined
  if (normalized.includes('/@xyflow/')) return 'canvas-vendor'
  if (normalized.includes('/@phosphor-icons/')) return 'icons-vendor'
  if (
    normalized.includes('/react/')
    || normalized.includes('/react-dom/')
    || normalized.includes('/scheduler/')
  ) return 'react-vendor'
  return undefined
}

export function filterInitialModulePreloads(
  dependencies: readonly string[],
  hostType: 'html' | 'js',
): string[] {
  if (hostType !== 'html') return [...dependencies]
  return dependencies.filter((dependency) => {
    const normalized = dependency.replaceAll('\\', '/').toLowerCase()
    return !normalized.includes('canvas-vendor')
      && !normalized.includes('ocr-vendor')
      && !normalized.includes('ocr-runtime/')
  })
}
