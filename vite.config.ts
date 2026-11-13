import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  buildAssetFileName,
  buildChunkGroups,
  filterInitialModulePreloads,
} from './src/core/buildChunks.ts'
import {
  OCR_EMITTED_RUNTIME_FILES,
  OCR_RUNTIME_FILES,
  OCR_WASM_PUBLIC_DIRECTORY,
} from './src/core/ocrRuntimeAssets.ts'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const ocrRuntimeDirectory = resolve(projectRoot, 'node_modules', 'onnxruntime-web', 'dist')

function localOcrWasm(): Plugin {
  const sources = new Map<string, Buffer>()
  const loadSource = (fileName: string) => {
    const cached = sources.get(fileName)
    if (cached !== undefined) return cached
    const source = readFileSync(resolve(ocrRuntimeDirectory, fileName))
    sources.set(fileName, source)
    return source
  }

  return {
    name: 'iwae-local-ocr-wasm',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const prefix = `/${OCR_WASM_PUBLIC_DIRECTORY}/`
        if (!pathname.startsWith(prefix)) {
          next()
          return
        }
        const fileName = pathname.slice(prefix.length)
        if (!OCR_RUNTIME_FILES.includes(fileName as typeof OCR_RUNTIME_FILES[number])) {
          next()
          return
        }
        const source = loadSource(fileName)
        response.statusCode = 200
        response.setHeader('Content-Type', fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        response.setHeader('Content-Length', source.byteLength)
        response.end(source)
      })
    },
    generateBundle() {
      for (const fileName of OCR_EMITTED_RUNTIME_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${OCR_WASM_PUBLIC_DIRECTORY}/${fileName}`,
          source: loadSource(fileName),
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), localOcrWasm()],
  // Tauri 가 콘솔을 쓰므로 Vite 가 화면을 지우면 로그가 섞여 사라진다.
  clearScreen: false,
  // tauri.conf.json 의 devUrl 과 반드시 같아야 한다. 포트가 밀리면
  // Tauri 창이 빈 화면으로 뜬다 — strictPort 로 조용한 실패를 막는다.
  // 5173 은 이 머신에서 다른 프로젝트(verilog_viz)가 이미 점유하고 있어
  // 5174 로 옮겼다 — 값 자체가 아니라 vite 와 tauri.conf.json 의 devUrl 이
  // 일치해야 한다는 제약이 핵심이다.
  // src-tauri/target 의 빌드 산출물은 cargo 가 잠근 채 쓰므로 감시하면 EBUSY 로 죽는다.
  server: { port: 5174, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/dist-release/**'] } },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, dependencies, context) =>
        filterInitialModulePreloads(dependencies, context.hostType),
    },
    rollupOptions: {
      output: {
        codeSplitting: { groups: buildChunkGroups() },
        assetFileNames: (assetInfo) => buildAssetFileName(assetInfo) ?? 'assets/[name]-[hash][extname]',
      },
    },
  },
})
