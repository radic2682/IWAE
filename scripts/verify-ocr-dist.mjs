import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const JSEP_WASM = /^ort-wasm-simd-threaded\.jsep(?:-[^.]+)?\.wasm$/u
const STABLE_WASM = 'ocr-runtime/ort-wasm-simd-threaded.jsep.wasm'
const STABLE_MODULE = 'ocr-runtime/ort-wasm-simd-threaded.jsep.mjs'
const OCR_MODULE_PRELOAD = /<link\b(?=[^>]*\brel=["']modulepreload["'])(?=[^>]*\bhref=["'][^"']*(?:ocr-vendor|ocr-runtime\/)[^"']*["'])[^>]*>/iu
const MODULE_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>/giu
const STATIC_IMPORT = /(?:\bimport(?!\s*\()|\bexport)\s*(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/gu

function portable(path) {
  return path.split(sep).join('/')
}

async function listFilesInside(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = resolve(directory, entry.name)
      if (relative(root, path).startsWith(`..${sep}`)) continue
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(portable(relative(root, path)))
    }
  }
  await visit(root)
  return files
}

function inside(root, path) {
  const child = relative(root, path)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

function modulePath(root, importer, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null
  const resolved = specifier.startsWith('/')
    ? resolve(root, specifier.slice(1))
    : resolve(dirname(importer), specifier)
  return inside(root, resolved) ? resolved : null
}

async function initialStaticModules(root, index) {
  const pending = [...index.matchAll(MODULE_SCRIPT)]
    .map((match) => match[1])
    .filter(Boolean)
    .map((specifier) => modulePath(root, resolve(root, 'index.html'), specifier))
    .filter((path) => path !== null)
  const visited = new Set()

  while (pending.length > 0) {
    const path = pending.pop()
    if (path === undefined || visited.has(path)) continue
    visited.add(path)
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const imported = modulePath(root, path, match[1] ?? '')
      if (imported !== null && !visited.has(imported)) pending.push(imported)
    }
  }

  return [...visited].map((path) => portable(relative(root, path)))
}

export async function verifyOcrDistribution(distRoot) {
  const root = resolve(distRoot)
  const files = await listFilesInside(root)
  const wasmFiles = files.filter((path) => JSEP_WASM.test(path.split('/').at(-1) ?? ''))
  if (wasmFiles.length !== 1) {
    throw new Error(`OCR distribution must contain exactly one JSEP WASM; found ${wasmFiles.length}.`)
  }
  if (wasmFiles[0] !== STABLE_WASM) {
    throw new Error(`OCR JSEP WASM must use the stable path ${STABLE_WASM}.`)
  }
  if (!files.includes(STABLE_MODULE)) {
    throw new Error(`OCR runtime module is missing: ${STABLE_MODULE}.`)
  }
  const index = await readFile(resolve(root, 'index.html'), 'utf8')
  if (OCR_MODULE_PRELOAD.test(index)) {
    throw new Error('Initial HTML must not preload OCR vendor or runtime assets.')
  }
  const initialModules = await initialStaticModules(root, index)
  if (initialModules.some((path) => /(?:ocr-vendor|ocr-runtime\/)/iu.test(path))) {
    throw new Error('Initial entry scripts must not statically import OCR vendor or runtime assets.')
  }
}

async function main() {
  const distRoot = fileURLToPath(new URL('../dist', import.meta.url))
  await verifyOcrDistribution(distRoot)
  console.log('OCR distribution verified: one stable local JSEP WASM.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
