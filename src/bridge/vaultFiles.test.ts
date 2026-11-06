import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertReferenceToCopy,
  createVaultFolder,
  duplicateVaultEntry,
  moveVaultEntry,
  renameVaultEntry,
  renameVaultFolder,
  trashVaultEntry,
  trashVaultFolder,
} from './vaultFiles'
import { readLibrary, readVaultIndex, writeLibrary, writeVaultIndex } from './vault'

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  copyFile: vi.fn(),
  remove: vi.fn(),
  readDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf('/'))),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replaceAll('//', '/')),
}))
vi.mock('./vault', () => ({
  readLibrary: vi.fn(),
  readVaultIndex: vi.fn(),
  writeLibrary: vi.fn(),
  writeVaultIndex: vi.fn(),
}))

const vault = { root: 'C:/Vault' }
const reference = {
  id: 'pdf-ref', kind: 'pdf' as const, storage: 'reference' as const, path: 'D:/Docs/spec.pdf', displayName: 'Spec',
  contentHash: 'a'.repeat(64), size: 100, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
}
const stored = {
  ...reference,
  id: 'note-1', kind: 'canvas' as const, storage: 'vault' as const, path: 'Notes/a.canvas', displayName: 'A',
}

describe('vault file operations', () => {
  beforeEach(() => {
    Object.values(fsMocks).forEach((mock) => mock.mockReset())
    vi.mocked(readVaultIndex).mockReset()
    vi.mocked(readLibrary).mockReset()
    vi.mocked(writeLibrary).mockReset()
    vi.mocked(writeVaultIndex).mockReset()
    vi.mocked(readLibrary).mockResolvedValue([])
    fsMocks.exists.mockResolvedValue(false)
  })

  it('renames an external reference alias without touching its source filename', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })

    await expect(renameVaultEntry(vault, reference.id, 'Protocol', 'display')).resolves.toMatchObject({
      id: reference.id,
      path: reference.path,
      displayName: 'Protocol',
    })

    expect(fsMocks.rename).not.toHaveBeenCalled()
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, expect.objectContaining({
      entries: [expect.objectContaining({ id: reference.id, path: reference.path, displayName: 'Protocol' })],
    }))
  })

  it('renames a vault file while preserving its stable id', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })

    await expect(renameVaultEntry(vault, stored.id, 'renamed.canvas', 'original')).resolves.toMatchObject({
      id: stored.id,
      path: 'Notes/renamed.canvas',
    })
    expect(fsMocks.rename).toHaveBeenCalledWith(
      'C:/Vault/Notes/a.canvas',
      'C:/Vault/Notes/renamed.canvas',
    )
  })

  it('moves a vault file without changing its id and rejects path escape', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })

    await expect(moveVaultEntry(vault, stored.id, 'Archive')).resolves.toMatchObject({
      id: stored.id,
      path: 'Archive/a.canvas',
    })
    await expect(moveVaultEntry(vault, stored.id, '../Outside')).rejects.toThrow('경로')
  })

  it('이동 후 인덱스 저장이 실패하면 원래 위치로 되돌린다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))

    await expect(moveVaultEntry(vault, stored.id, 'Archive')).rejects.toThrow('index write failed')

    expect(fsMocks.rename).toHaveBeenNthCalledWith(1, 'C:/Vault/Notes/a.canvas', 'C:/Vault/Archive/a.canvas')
    expect(fsMocks.rename).toHaveBeenNthCalledWith(2, 'C:/Vault/Archive/a.canvas', 'C:/Vault/Notes/a.canvas')
  })

  it('파일 위치 롤백이 실패해도 PDF Library 메타데이터는 원본으로 복구한다', async () => {
    const storedPdf = { ...stored, id: 'pdf-copy', kind: 'pdf' as const, path: 'Specs/a.pdf' }
    const libraryEntry = {
      docId: storedPdf.id, path: 'C:/Vault/Specs/a.pdf', sha256: storedPdf.contentHash!, size: 100,
      pages: 12, title: 'A', addedAt: storedPdf.addedAt, folderPath: 'Specs',
      attachmentPolicy: { kind: 'copy-current-folder' as const, folderPath: 'Specs' },
    }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [storedPdf] })
    vi.mocked(readLibrary).mockResolvedValue([libraryEntry])
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))
    fsMocks.rename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('file locked'))

    await expect(moveVaultEntry(vault, storedPdf.id, 'Archive')).rejects.toThrow('원상 복구하지 못했습니다')

    expect(writeLibrary).toHaveBeenLastCalledWith(vault, [libraryEntry])
  })

  it('원본 이름 변경 후 인덱스 저장이 실패하면 파일명을 복구한다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))

    await expect(renameVaultEntry(vault, stored.id, 'renamed.canvas', 'original')).rejects.toThrow('index write failed')

    expect(fsMocks.rename).toHaveBeenNthCalledWith(1, 'C:/Vault/Notes/a.canvas', 'C:/Vault/Notes/renamed.canvas')
    expect(fsMocks.rename).toHaveBeenNthCalledWith(2, 'C:/Vault/Notes/renamed.canvas', 'C:/Vault/Notes/a.canvas')
  })

  it('Vault 상대 경로 안에만 새 폴더를 만든다', async () => {
    await expect(createVaultFolder(vault, 'Specs', 'Protocol')).resolves.toBe('Specs/Protocol')
    expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/Specs/Protocol', { recursive: false })

    await expect(createVaultFolder(vault, '../Outside', 'Bad')).rejects.toThrow('경로')
    await expect(createVaultFolder(vault, '', 'CON')).rejects.toThrow('이름')
  })

  it('removes a reference without deleting or moving the external source', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })

    await trashVaultEntry(vault, reference.id)

    expect(fsMocks.rename).not.toHaveBeenCalled()
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, { version: 1, entries: [] })
  })

  it('preserves the complete index entry when moving a vault file to trash', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, entries: [] }))

    await trashVaultEntry(vault, stored.id)

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      expect.stringContaining(`"indexEntry": ${JSON.stringify(stored, null, 2).replaceAll('\n', '\n      ')}`),
    )
  })

  it('휴지통 이동 후 인덱스 저장이 실패하면 파일과 휴지통 목록을 복구한다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))

    await expect(trashVaultEntry(vault, stored.id)).rejects.toThrow('index write failed')

    expect(fsMocks.rename).toHaveBeenNthCalledWith(1, 'C:/Vault/Notes/a.canvas', 'C:/Vault/.iwae/trash/note-1-a.canvas')
    expect(fsMocks.rename).toHaveBeenNthCalledWith(2, 'C:/Vault/.iwae/trash/note-1-a.canvas', 'C:/Vault/Notes/a.canvas')
    expect(fsMocks.writeTextFile).toHaveBeenLastCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`,
    )
  })

  it('휴지통 파일 이동 자체가 실패해도 미리 쓴 휴지통 목록을 복구한다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    fsMocks.rename.mockRejectedValueOnce(new Error('file locked'))

    await expect(trashVaultEntry(vault, stored.id)).rejects.toThrow('file locked')

    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(2)
    expect(fsMocks.writeTextFile).toHaveBeenLastCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`,
    )
  })

  it('Vault PDF 이동 후 Library의 실제 경로와 폴더도 함께 갱신한다', async () => {
    const storedPdf = { ...stored, id: 'pdf-copy', kind: 'pdf' as const, path: 'Specs/a.pdf' }
    const libraryEntry = {
      docId: storedPdf.id, path: 'C:/Vault/Specs/a.pdf', sha256: storedPdf.contentHash!, size: 100,
      pages: 12, title: 'A', addedAt: storedPdf.addedAt, folderPath: 'Specs',
      attachmentPolicy: { kind: 'copy-current-folder' as const, folderPath: 'Specs' },
    }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [storedPdf] })
    vi.mocked(readLibrary).mockResolvedValue([libraryEntry])

    await moveVaultEntry(vault, storedPdf.id, 'Archive')

    expect(writeLibrary).toHaveBeenCalledWith(vault, [expect.objectContaining({
      docId: storedPdf.id,
      path: 'C:/Vault/Archive/a.pdf',
      folderPath: 'Archive',
    })])
  })

  it('참조 PDF는 원본 파일을 건드리지 않고 Library 폴더 위치만 옮긴다', async () => {
    const libraryEntry = {
      docId: reference.id, path: reference.path, sha256: reference.contentHash!, size: 100,
      pages: 12, title: 'Spec', addedAt: reference.addedAt,
      attachmentPolicy: { kind: 'reference' as const },
    }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })
    vi.mocked(readLibrary).mockResolvedValue([libraryEntry])

    await expect(moveVaultEntry(vault, reference.id, 'Papers')).resolves.toMatchObject({ path: reference.path })

    expect(fsMocks.rename).not.toHaveBeenCalled()
    expect(writeVaultIndex).not.toHaveBeenCalled()
    expect(writeLibrary).toHaveBeenCalledWith(vault, [{ ...libraryEntry, folderPath: 'Papers' }])
    await expect(moveVaultEntry(vault, reference.id, '../Outside')).rejects.toThrow('경로')
  })

  it('참조 Markdown은 여전히 Vault 폴더로 옮기지 않는다', async () => {
    const markdown = { ...reference, id: 'md-ref', kind: 'markdown' as const, path: 'D:/Docs/memo.md' }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [markdown] })
    await expect(moveVaultEntry(vault, markdown.id, 'Papers')).rejects.toThrow('외부 참조')
  })

  it('PDF 참조를 Vault 복사본으로 전환하면 Library 정책과 경로도 바꾼다', async () => {
    const libraryEntry = {
      docId: reference.id, path: reference.path, sha256: reference.contentHash!, size: 100,
      pages: 12, title: 'Spec', addedAt: reference.addedAt,
      attachmentPolicy: { kind: 'reference' as const },
    }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })
    vi.mocked(readLibrary).mockResolvedValue([libraryEntry])

    await convertReferenceToCopy(vault, reference.id, 'Imported')

    expect(writeLibrary).toHaveBeenCalledWith(vault, [expect.objectContaining({
      path: 'C:/Vault/Imported/spec.pdf',
      folderPath: 'Imported',
      attachmentPolicy: { kind: 'copy-another-folder', folderPath: 'Imported' },
    })])
  })

  it('PDF 복제는 stable id가 다른 Library 항목도 함께 만든다', async () => {
    const libraryEntry = {
      docId: reference.id, path: reference.path, sha256: reference.contentHash!, size: 100,
      pages: 12, title: 'Spec', addedAt: reference.addedAt,
      attachmentPolicy: { kind: 'reference' as const },
    }
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })
    vi.mocked(readLibrary).mockResolvedValue([libraryEntry])

    const duplicated = await duplicateVaultEntry(vault, reference.id, 'Copies')

    expect(writeLibrary).toHaveBeenCalledWith(vault, [
      libraryEntry,
      expect.objectContaining({
        docId: duplicated.id,
        path: 'C:/Vault/Copies/spec copy.pdf',
        folderPath: 'Copies',
      }),
    ])
  })

  it('복제 후 인덱스 저장이 실패하면 생성한 파일을 제거한다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [stored] })
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))

    await expect(duplicateVaultEntry(vault, stored.id, 'Copies')).rejects.toThrow('index write failed')

    expect(fsMocks.remove).toHaveBeenCalledWith('C:/Vault/Copies/a copy.canvas')
  })

  it('참조 복사 후 인덱스 저장이 실패하면 생성한 파일을 제거한다', async () => {
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [reference] })
    vi.mocked(writeVaultIndex).mockRejectedValueOnce(new Error('index write failed'))

    await expect(convertReferenceToCopy(vault, reference.id, 'Imported')).rejects.toThrow('index write failed')

    expect(fsMocks.remove).toHaveBeenCalledWith('C:/Vault/Imported/spec.pdf')
  })
})

describe('folder operations', () => {
  const inside = { ...stored, id: 'note-in', path: 'Specs/HTTP/a.canvas' }
  const sibling = { ...stored, id: 'note-out', path: 'Specs2/b.canvas' }
  const pdf = { ...stored, id: 'pdf-in', kind: 'pdf' as const, path: 'Specs/spec.pdf' }
  const libraryPdf = {
    docId: 'pdf-in', path: 'C:/Vault/Specs/spec.pdf', sha256: 'a'.repeat(64), size: 1, pages: 2, title: 'Spec', addedAt: '2026-09-27T00:00:00.000Z',
    folderPath: 'Specs', attachmentPolicy: { kind: 'copy-current-folder' as const, folderPath: 'Specs' },
  }
  const libraryRef = { ...libraryPdf, docId: 'pdf-ref', path: 'D:/Docs/ref.pdf', folderPath: 'Specs/HTTP', attachmentPolicy: { kind: 'reference' as const } }
  const otherPdf = { ...libraryPdf, docId: 'pdf-other', path: 'C:/Vault/Specs2/x.pdf', folderPath: 'Specs2' }

  beforeEach(() => {
    Object.values(fsMocks).forEach((mock) => mock.mockReset())
    vi.mocked(writeLibrary).mockReset()
    vi.mocked(writeVaultIndex).mockReset()
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [inside, sibling, pdf] })
    vi.mocked(readLibrary).mockResolvedValue([libraryPdf, libraryRef, otherPdf])
    fsMocks.exists.mockImplementation(async (path: string) => path === 'C:/Vault/Specs')
  })

  it('폴더를 휴지통으로 옮기고 안의 항목만 목록에서 뺀다', async () => {
    const removed = await trashVaultFolder(vault, 'Specs')

    expect(new Set(removed)).toEqual(new Set(['note-in', 'pdf-in', 'pdf-ref']))
    const [source, target] = fsMocks.rename.mock.calls[0] as [string, string]
    expect(source).toBe('C:/Vault/Specs')
    expect(target).toMatch(/^C:\/Vault\/\.iwae\/trash\/.+-Specs$/u)
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, { version: 1, entries: [sibling] })
    expect(writeLibrary).toHaveBeenCalledWith(vault, [otherPdf])
    const trashJson = JSON.parse(fsMocks.writeTextFile.mock.calls[0]![1] as string) as { entries: Record<string, unknown>[] }
    expect(trashJson.entries[0]).toMatchObject({ kind: 'folder', originalPath: 'Specs' })
    expect(trashJson.entries[0]!.indexEntries).toHaveLength(2)
    expect(trashJson.entries[0]!.libraryEntries).toHaveLength(2)
  })

  it('폴더째 옮기지 못하면 파일을 하나씩 옮기고 빈 폴더를 지운다', async () => {
    fsMocks.rename.mockRejectedValueOnce(new Error('directory has open file'))
    fsMocks.readDir.mockImplementation(async (path: string) => path === 'C:/Vault/Specs'
      ? [{ name: 'spec.pdf', isDirectory: false }, { name: 'HTTP', isDirectory: true }]
      : [{ name: 'a.canvas', isDirectory: false }])

    await trashVaultFolder(vault, 'Specs')

    const [, target] = fsMocks.rename.mock.calls[0] as [string, string]
    expect(fsMocks.rename).toHaveBeenCalledWith('C:/Vault/Specs/spec.pdf', `${target}/spec.pdf`)
    expect(fsMocks.rename).toHaveBeenCalledWith('C:/Vault/Specs/HTTP/a.canvas', `${target}/HTTP/a.canvas`)
    expect(fsMocks.remove).toHaveBeenNthCalledWith(1, 'C:/Vault/Specs/HTTP')
    expect(fsMocks.remove).toHaveBeenNthCalledWith(2, 'C:/Vault/Specs')
    expect(fsMocks.remove.mock.calls.every((call) => call.length === 1)).toBe(true)
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, { version: 1, entries: [sibling] })
  })

  it('폴더를 옮기지 못하면 휴지통 목록을 되돌리고 색인은 건드리지 않는다', async () => {
    fsMocks.rename.mockRejectedValue(new Error('folder locked'))
    fsMocks.readDir.mockResolvedValue([{ name: 'spec.pdf', isDirectory: false }])
    fsMocks.remove.mockResolvedValue(undefined)

    await expect(trashVaultFolder(vault, 'Specs')).rejects.toThrow('folder locked')

    expect(writeVaultIndex).not.toHaveBeenCalled()
    expect(fsMocks.writeTextFile).toHaveBeenLastCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`,
    )
  })

  it('Vault 루트는 지우지 않는다', async () => {
    await expect(trashVaultFolder(vault, '')).rejects.toThrow('루트')
    expect(fsMocks.rename).not.toHaveBeenCalled()
  })

  it('폴더 이름을 바꾸면 아래 항목의 경로와 정리 위치가 따라간다', async () => {
    await expect(renameVaultFolder(vault, 'Specs', 'Standards')).resolves.toBe('Standards')

    expect(fsMocks.rename).toHaveBeenCalledWith('C:/Vault/Specs', 'C:/Vault/Standards')
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, {
      version: 1,
      entries: [{ ...inside, path: 'Standards/HTTP/a.canvas' }, sibling, { ...pdf, path: 'Standards/spec.pdf' }],
    })
    expect(writeLibrary).toHaveBeenCalledWith(vault, [
      { ...libraryPdf, path: 'C:/Vault/Standards/spec.pdf', folderPath: 'Standards', attachmentPolicy: { kind: 'copy-current-folder', folderPath: 'Standards' } },
      { ...libraryRef, folderPath: 'Standards/HTTP' },
      otherPdf,
    ])
  })
})

describe('cleanEntryName', () => {
  it('끝의 마침표·공백은 Windows 탐색기처럼 떼어 낸다', async () => {
    const { cleanEntryName } = await import('./vaultFiles')
    expect(cleanEntryName('01_Structure_Cons.')).toBe('01_Structure_Cons')
    expect(cleanEntryName('  자료 . ')).toBe('자료')
  })

  it('못 쓰는 이름은 이유를 말한다', async () => {
    const { cleanEntryName } = await import('./vaultFiles')
    expect(() => cleanEntryName('a:b')).toThrow(/':'/u)
    expect(() => cleanEntryName('CON')).toThrow(/예약/u)
    expect(() => cleanEntryName(' . ')).toThrow(/입력/u)
  })
})
