import { describe, expect, it } from 'vitest'
import { buildAssetFileName, buildChunkName, filterInitialModulePreloads } from './buildChunks'

describe('buildChunkName', () => {
  it.each([
    ['C:/app/node_modules/@xyflow/react/dist/index.js', 'canvas-vendor'],
    ['C:/app/node_modules/@phosphor-icons/react/dist/index.js', 'icons-vendor'],
    ['C:/app/node_modules/react-dom/client.js', 'react-vendor'],
  ])('분리 대상 %s를 %s 청크로 보낸다', (id, chunk) => {
    expect(buildChunkName(id)).toBe(chunk)
  })

  it('앱 코드와 작은 의존성은 Rollup 기본 분할에 맡긴다', () => {
    expect(buildChunkName('C:/app/src/app/App.tsx')).toBeUndefined()
    expect(buildChunkName('C:/app/node_modules/tiny-package/index.js')).toBeUndefined()
  })

  it('OCR dependencies stay in the dynamic import graph instead of hoisting helpers into startup', () => {
    expect(buildChunkName('C:/app/node_modules/@paddleocr/paddleocr-js/dist/index.js')).toBeUndefined()
    expect(buildChunkName('C:/app/node_modules/onnxruntime-web/dist/ort.js')).toBeUndefined()
    expect(buildChunkName('C:/app/node_modules/@techstark/opencv-js/dist/opencv.js')).toBeUndefined()
  })
})

describe('buildAssetFileName', () => {
  it('routes only the pinned JSEP WASM source to its stable OCR runtime path', () => {
    expect(buildAssetFileName({ name: 'ort-wasm-simd-threaded.jsep.wasm' }))
      .toBe('ocr-runtime/ort-wasm-simd-threaded.jsep.wasm')
    expect(buildAssetFileName({
      name: 'C:\\app\\node_modules\\onnxruntime-web\\dist\\ort-wasm-simd-threaded.jsep.wasm',
    })).toBe('ocr-runtime/ort-wasm-simd-threaded.jsep.wasm')
  })

  it('leaves unrelated assets on the bundler default path', () => {
    expect(buildAssetFileName({ name: 'logo.svg' })).toBeUndefined()
    expect(buildAssetFileName({ name: 'ort-wasm-simd-threaded.jsep.mjs' })).toBeUndefined()
  })
})

describe('filterInitialModulePreloads', () => {
  it('HTML entry preload에서 캔버스와 OCR 청크를 제외한다', () => {
    const dependencies = [
      'assets/react-vendor-a.js',
      'assets/canvas-vendor-a.js',
      'assets/ocr-vendor-b.js',
      'ocr-runtime/ort-wasm-simd-threaded.jsep.mjs',
      'assets/index-c.css',
    ]

    expect(filterInitialModulePreloads(dependencies, 'html')).toEqual([
      'assets/react-vendor-a.js',
      'assets/index-c.css',
    ])
    expect(filterInitialModulePreloads(dependencies, 'js')).toEqual(dependencies)
  })
})
