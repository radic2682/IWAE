import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../i18n'
import { mayApplySampleLayout, pendingSampleLayout, takeSampleLayout } from './sampleLayout'
import type { SampleManifest, SampleVaultIo } from './sampleVault'

const seed = vi.hoisted(() => ({ run: vi.fn<(io: SampleVaultIo, manifest: SampleManifest) => Promise<boolean>>() }))

vi.mock('./sampleVault', () => ({ seedSampleVault: seed.run }))
vi.mock('../../bridge/window', () => ({ isDesktop: () => true }))
vi.mock('../../bridge/pdf', () => ({ pageTextIndex: vi.fn() }))
vi.mock('../../bridge/vault', () => ({
  listVaultTree: vi.fn(async () => []),
  readLibrary: vi.fn(async () => [{ docId: 'doc-sample', path: 'C:/v/IWAE 사용 설명서.pdf' }]),
  readPdfHighlights: vi.fn(async () => []),
  registerUnlistedVaultPdfs: vi.fn(async () => []),
  writePdfHighlights: vi.fn(async () => undefined),
  writeVaultRelativeText: vi.fn(async () => undefined),
}))

import { seedSampleVaultInto } from './sampleVaultDesktop'

const manifest: SampleManifest = {
  pdf: { file: 'manual.pdf', name: 'IWAE 사용 설명서.pdf' },
  markdown: { file: 'example.md', name: 'Markdown 예시.md' },
  note: {
    title: 'IWAE 둘러보기',
    blocks: [
      { kind: 'section', title: '시작' },
      { kind: 'memo', page: 3, quote: 'q', note: 'n' },
      { kind: 'memo', page: 4, quote: 'q', note: 'n' },
    ],
  },
}

beforeEach(() => {
  setLocale('ko')
  takeSampleLayout()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(String(url).endsWith('.json') ? JSON.stringify(manifest) : 'x').buffer,
  })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  seed.run.mockReset()
  takeSampleLayout()
})

describe('예시 첫 배치 요청', () => {
  it('예시를 넣었을 때만 PDF · 노트 · 첫 메모 쪽을 담은 요청을 남긴다', async () => {
    seed.run.mockImplementation(async (io) => {
      await io.registerPdf(manifest.pdf.name)
      return true
    })
    await expect(seedSampleVaultInto({ root: 'C:/v' })).resolves.toBe(true)
    expect(pendingSampleLayout()).toEqual({ docId: 'doc-sample', notePath: '노트/IWAE 둘러보기.iwnote', page: 3 })
  })

  it('Vault 가 비어 있지 않아 예시를 넣지 않았으면(쓰던 사람) 요청이 없다', async () => {
    seed.run.mockResolvedValue(false)
    await expect(seedSampleVaultInto({ root: 'C:/v' })).resolves.toBe(false)
    expect(pendingSampleLayout()).toBeNull()
  })

  it('예시 PDF 를 목록에 올리지 못했으면 열 문서가 없으니 요청하지 않는다', async () => {
    const lib = await import('../../bridge/vault')
    vi.mocked(lib.readLibrary).mockResolvedValueOnce([])
    seed.run.mockImplementation(async (io) => {
      await io.registerPdf(manifest.pdf.name)
      return true
    })
    await seedSampleVaultInto({ root: 'C:/v' })
    expect(pendingSampleLayout()).toBeNull()
  })

  it('요청은 한 번만 꺼낼 수 있다', async () => {
    seed.run.mockImplementation(async (io) => {
      await io.registerPdf(manifest.pdf.name)
      return true
    })
    await seedSampleVaultInto({ root: 'C:/v' })
    expect(takeSampleLayout()?.docId).toBe('doc-sample')
    expect(takeSampleLayout()).toBeNull()
  })

  it('이미 열린 탭이 있으면 배치하지 않는다', () => {
    expect(mayApplySampleLayout(0)).toBe(true)
    expect(mayApplySampleLayout(1)).toBe(false)
  })
})
