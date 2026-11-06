export const OCR_WASM_MODULE_FILE = 'ort-wasm-simd-threaded.jsep.mjs'
export const OCR_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm'
export const OCR_RUNTIME_FILES = [OCR_WASM_MODULE_FILE, OCR_WASM_FILE] as const
export const OCR_EMITTED_RUNTIME_FILES = [OCR_WASM_MODULE_FILE] as const
export const OCR_WASM_PUBLIC_DIRECTORY = 'ocr-runtime'
export const OCR_WASM_PUBLIC_PATH = `${OCR_WASM_PUBLIC_DIRECTORY}/${OCR_WASM_FILE}`

export function ocrWasmBaseUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${OCR_WASM_PUBLIC_DIRECTORY}/`
}
