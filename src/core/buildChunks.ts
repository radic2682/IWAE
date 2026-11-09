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

const VENDOR_CHUNKS = ['react-vendor', 'icons-vendor', 'canvas-vendor'] as const

/**
 * Rolldown `codeSplitting` 묶음. 묶음은 잡힌 모듈의 의존성까지 끌고 가므로(그래야 묶음끼리 서로 부르는
 * 고리가 안 생긴다) 앞에 있는 묶음일수록 먼저 가져가게 한다. `manualChunks` 로는 순서를 못 정해
 * @xyflow 가 React 를 끌고 가 꺼 둔 캔버스 묶음이 시작할 때 실렸다.
 */
export function buildChunkGroups() {
  return VENDOR_CHUNKS.map((name, index) => ({
    name,
    test: (id: string) => buildChunkName(id) === name,
    priority: VENDOR_CHUNKS.length - index,
  }))
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
