import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyOcrDistribution } from './verify-ocr-dist.mjs'

async function fixture() {
  return mkdtemp(join(tmpdir(), 'iwae-ocr-dist-'))
}

async function writeRuntime(root) {
  const runtime = join(root, 'ocr-runtime')
  const assets = join(root, 'assets')
  await mkdir(runtime, { recursive: true })
  await mkdir(assets, { recursive: true })
  await writeFile(join(runtime, 'ort-wasm-simd-threaded.jsep.wasm'), 'wasm')
  await writeFile(join(runtime, 'ort-wasm-simd-threaded.jsep.mjs'), 'loader')
  await writeFile(join(assets, 'index.js'), 'console.log("boot");')
  await writeFile(join(root, 'index.html'), '<script type="module" src="/assets/index.js"></script>')
}

test('accepts exactly one stable JSEP WASM and its module companion', async () => {
  const root = await fixture()
  try {
    await writeRuntime(root)
    await assert.doesNotReject(verifyOcrDistribution(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects missing and duplicate JSEP WASM output', async () => {
  const missing = await fixture()
  const duplicate = await fixture()
  try {
    await assert.rejects(verifyOcrDistribution(missing), /exactly one/u)
    await writeRuntime(duplicate)
    await mkdir(join(duplicate, 'assets'), { recursive: true })
    await writeFile(join(duplicate, 'assets', 'ort-wasm-simd-threaded.jsep-deadbeef.wasm'), 'duplicate')
    await assert.rejects(verifyOcrDistribution(duplicate), /exactly one/u)
  } finally {
    await rm(missing, { recursive: true, force: true })
    await rm(duplicate, { recursive: true, force: true })
  }
})

test('rejects a lone JSEP WASM outside the stable runtime path', async () => {
  const root = await fixture()
  try {
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'ort-wasm-simd-threaded.jsep-deadbeef.wasm'), 'wasm')
    await assert.rejects(verifyOcrDistribution(root), /stable path/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects initial HTML that preloads the lazy OCR vendor', async () => {
  const root = await fixture()
  try {
    await writeRuntime(root)
    await writeFile(
      join(root, 'index.html'),
      '<link rel="modulepreload" href="/assets/ocr-vendor-deadbeef.js">',
    )
    await assert.rejects(verifyOcrDistribution(root), /must not preload OCR/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an entry script that statically imports the lazy OCR vendor', async () => {
  const root = await fixture()
  try {
    await writeRuntime(root)
    await writeFile(
      join(root, 'assets', 'index.js'),
      'import{ocr as o}from"./ocr-vendor-deadbeef.js";console.log(o);',
    )
    await writeFile(join(root, 'assets', 'ocr-vendor-deadbeef.js'), 'export const ocr = true;')

    await assert.rejects(verifyOcrDistribution(root), /statically import OCR/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
