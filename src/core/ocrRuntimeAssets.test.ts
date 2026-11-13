import { describe, expect, it } from 'vitest'
import {
  OCR_EMITTED_RUNTIME_FILES,
  OCR_RUNTIME_FILES,
  OCR_WASM_FILE,
  OCR_WASM_PUBLIC_PATH,
  ocrWasmBaseUrl,
} from './ocrRuntimeAssets'

describe('OCR runtime assets', () => {
  it('uses the worker-compatible ONNX runtime file name', () => {
    expect(OCR_WASM_FILE).toBe('ort-wasm-simd-threaded.jsep.wasm')
    expect(OCR_WASM_PUBLIC_PATH).toBe('ocr-runtime/ort-wasm-simd-threaded.jsep.wasm')
    expect(OCR_RUNTIME_FILES).toEqual([
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
    ])
    expect(OCR_EMITTED_RUNTIME_FILES).toEqual(['ort-wasm-simd-threaded.jsep.mjs'])
  })

  it.each([
    ['/', '/ocr-runtime/'],
    ['.', './ocr-runtime/'],
    ['/iwae/', '/iwae/ocr-runtime/'],
  ])('resolves the OCR WASM base beneath %s', (baseUrl, expected) => {
    expect(ocrWasmBaseUrl(baseUrl)).toBe(expected)
  })
})
