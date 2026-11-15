import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(), mkdir: vi.fn(), readTextFile: vi.fn(), readDir: vi.fn(), writeTextFile: vi.fn(),
  rename: vi.fn(), remove: vi.fn(), copyFile: vi.fn(), stat: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('C:/AppData/IWAE'),
  dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf('/'))),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replaceAll('//', '/')),
}))
vi.mock('./pdf', () => ({ openPdf: vi.fn() }))

import {
  VaultFileCorruptError,
  listVaultTree,
  readLibrary,
  readPdfBookmarks,
  readPdfHighlights,
  readPdfOverlays,
  readVaultIndex,
  readVaultMetadata,
  readVaultTreeOrder,
  setVaultFileNoticeHandler,
  writeLibrary,
  writePdfBookmarks,
  writePdfHighlights,
  writeVaultIndex,
  writeVaultMetadata,
  writeVaultTreeOrder,
  type VaultFileNotice,
} from './vault'

const vault = { root: 'C:/Vault' }
const entry = {
  docId: '0123456789ab', path: 'C:/Specs/a.pdf', sha256: 'f'.repeat(64), size: 1, pages: 2, title: 'A', addedAt: '2026-09-20T00:00:00.000Z',
}
const anchor = { docId: 'd', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 1, y: 1, w: 5, h: 5 }], charRange: [0, 3], quote: 'abc', prefix: '', suffix: '' }

/** only the `.iwae` files named here exist; each maps to its text */
function disk(files: Record<string, string>) {
  fsMocks.exists.mockImplementation(async (path: string) => Object.keys(files).some((name) => path === `C:/Vault/.iwae/${name}`) || path === 'C:/Vault/.iwae' || path === 'C:/Vault')
  fsMocks.readTextFile.mockImplementation(async (path: string) => {
    const name = path.replace('C:/Vault/.iwae/', '')
    if (files[name] === undefined) throw new Error(`no such file ${path}`)
    return files[name]
  })
}
const writtenTo = (name: string): string[] => fsMocks.writeTextFile.mock.calls.filter(([path]) => path === `C:/Vault/.iwae/${name}`).map(([, text]) => text as string)

describe('vault files: a damaged or newer non-essential file does not block opening', () => {
  const notices: VaultFileNotice[] = []
  beforeEach(() => {
    Object.values(fsMocks).forEach((mock) => mock.mockReset())
    invoke.mockReset()
    notices.length = 0
    setVaultFileNoticeHandler((notice) => notices.push(notice))
  })

  it('tree-order.json: wrong ids are dropped one by one, a newer version is read but never written back', async () => {
    disk({ 'tree-order.json': JSON.stringify({ version: 1, parents: { A: ['x', 7, 'y'], B: 'nope' } }) })
    await expect(readVaultTreeOrder(vault)).resolves.toEqual({ A: ['x', 'y'] })

    disk({ 'tree-order.json': JSON.stringify({ version: 2, parents: { A: ['x'] }, extra: true }) })
    await expect(readVaultTreeOrder(vault)).resolves.toEqual({ A: ['x'] })
    expect(notices).toEqual([{ kind: 'newer', name: 'tree-order.json' }])
    await writeVaultTreeOrder(vault, { A: ['x', 'z'] })
    expect(writtenTo('tree-order.json')).toEqual([])

    // once the file is a version it knows again, writes work
    disk({ 'tree-order.json': JSON.stringify({ version: 1, parents: {} }) })
    await readVaultTreeOrder(vault)
    await writeVaultTreeOrder(vault, { A: ['x'] })
    expect(writtenTo('tree-order.json')).toHaveLength(1)
  })

  it('tree-order.json that is empty or cut off is reported as a corrupt file (so it can be set aside), not a read failure', async () => {
    disk({ 'tree-order.json': '' })
    await expect(readVaultTreeOrder(vault)).rejects.toBeInstanceOf(VaultFileCorruptError)
  })

  it('metadata.json: empty or truncated is corrupt, newer is read leniently and not overwritten', async () => {
    disk({ 'metadata.json': '' })
    await expect(readVaultMetadata(vault)).rejects.toBeInstanceOf(VaultFileCorruptError)
    disk({ 'metadata.json': '{"version":1,"markdownThe' })
    await expect(readVaultMetadata(vault)).rejects.toBeInstanceOf(VaultFileCorruptError)

    disk({ 'metadata.json': JSON.stringify({ version: 3, markdownTheme: 'github', fileActivity: { a: { favorite: true, lastOpenedAt: null, pinnedColor: 'red' } }, newThing: 1 }) })
    const metadata = await readVaultMetadata(vault)
    expect(metadata.markdownTheme).toBe('github')
    expect(notices).toContainEqual({ kind: 'newer', name: 'metadata.json' })
    await writeVaultMetadata(vault, metadata)
    expect(writtenTo('metadata.json')).toEqual([])
  })

  it('metadata.json keeps unknown per-file fields (favourites) and unknown top-level fields through a rewrite', async () => {
    disk({ 'metadata.json': JSON.stringify({ version: 1, markdownTheme: 'light', fileActivity: { a: { favorite: true, lastOpenedAt: null, pinnedColor: 'red' } }, itemIcons: {}, newThing: { x: 1 } }) })
    const metadata = await readVaultMetadata(vault)
    await writeVaultMetadata(vault, { ...metadata, markdownTheme: 'github' })
    const out = JSON.parse(writtenTo('metadata.json')[0]!) as { newThing: unknown; fileActivity: Record<string, Record<string, unknown>> }
    expect(out.newThing).toEqual({ x: 1 })
    expect(out.fileActivity.a).toMatchObject({ favorite: true, pinnedColor: 'red' })
  })

  it('library.json: one bad entry is skipped and kept on disk when the list is saved again', async () => {
    const odd = { ...entry, docId: 'zzzzzzzzzzzz', attachmentPolicy: { kind: 'cloud-sync', folderPath: 'x' } }
    disk({ 'library.json': JSON.stringify({ version: 1, documents: { [entry.docId]: entry, [odd.docId]: odd } }) })
    const read = await readLibrary(vault)
    expect(read.map((item) => item.docId)).toEqual([entry.docId])
    await writeLibrary(vault, [{ ...entry, title: 'Renamed' }])
    const out = JSON.parse(writtenTo('library.json')[0]!) as { documents: Record<string, unknown> }
    expect(Object.keys(out.documents).sort()).toEqual([entry.docId, odd.docId].sort())
    expect(out.documents[odd.docId]).toEqual(odd)
  })

  it('library.json that cannot be parsed at all is a corrupt file', async () => {
    disk({ 'library.json': '' })
    await expect(readLibrary(vault)).rejects.toBeInstanceOf(VaultFileCorruptError)
  })

  it('index.json: a newer version is not rebuilt or overwritten, an unparsable one is announced', async () => {
    const newer = { version: 2, entries: [{ id: 'n1', kind: 'markdown', storage: 'vault', path: 'a.md', displayName: 'a', contentHash: null, size: null, modifiedAt: null, addedAt: 'x', missing: false, icon: 'star' }, { weird: true }] }
    disk({ 'index.json': JSON.stringify(newer) })
    await expect(readVaultIndex(vault)).resolves.toMatchObject({ entries: [{ id: 'n1' }] })
    expect(notices).toEqual([{ kind: 'newer', name: 'index.json' }])
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
    await writeVaultIndex(vault, { version: 1, entries: [] })
    expect(writtenTo('index.json')).toEqual([])

    notices.length = 0
    disk({ 'index.json': '' })
    await expect(readVaultIndex(vault)).resolves.toEqual({ version: 1, entries: [] })
    expect(notices).toEqual([{ kind: 'damaged', name: 'index.json' }])
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(expect.stringMatching(/diagnostics\/index-\d+\.json$/u), '')
  })

  it('an unparsable index.json plus an unreadable library.json still opens (rebuilt from the file list)', async () => {
    disk({ 'index.json': '{broken', 'library.json': '' })
    await expect(readVaultIndex(vault)).resolves.toEqual({ version: 1, entries: [] })
  })
})

describe('vault files: unknown data in highlights, bookmarks and overlays is not deleted', () => {
  beforeEach(() => {
    Object.values(fsMocks).forEach((mock) => mock.mockReset())
    setVaultFileNoticeHandler(() => undefined)
  })

  it('highlights: an unexpected item is skipped and written back, unknown fields survive, a newer file is not overwritten', async () => {
    const good = { id: 'h1', anchor, color: 'yellow', futureField: { a: 1 } }
    const odd = { id: 'h2', anchor: { ...anchor, coordSpace: 'something-new' }, color: 'yellow' }
    disk({ 'highlights.json': JSON.stringify({ version: 1, highlights: [good, odd] }) })
    const read = await readPdfHighlights(vault)
    expect(read.map((item) => item.id)).toEqual(['h1'])
    await writePdfHighlights(vault, read)
    const out = JSON.parse(writtenTo('highlights.json')[0]!) as { highlights: Record<string, unknown>[] }
    expect(out.highlights).toContainEqual(expect.objectContaining({ id: 'h1', futureField: { a: 1 } }))
    expect(out.highlights).toContainEqual(odd)

    fsMocks.writeTextFile.mockReset()
    disk({ 'highlights.json': JSON.stringify({ version: 2, highlights: [good] }) })
    await expect(readPdfHighlights(vault)).resolves.toHaveLength(1)
    await writePdfHighlights(vault, [])
    expect(writtenTo('highlights.json')).toEqual([])
  })

  it('bookmarks: one bad bookmark does not hide the rest and is written back; unknown fields survive', async () => {
    const good = { id: 'd:1', docId: 'd', page: 1, title: 'one', createdAt: 'x', color: 'blue' }
    const bad = { id: 'd:x', docId: 'd', page: 'nope', title: 'two', createdAt: 'x' }
    disk({ 'bookmarks.json': JSON.stringify({ version: 1, bookmarks: [good, bad] }) })
    const read = await readPdfBookmarks(vault)
    expect(read).toHaveLength(1)
    await writePdfBookmarks(vault, read)
    const out = JSON.parse(writtenTo('bookmarks.json')[0]!) as { bookmarks: unknown[] }
    expect(out.bookmarks).toContainEqual(expect.objectContaining({ id: 'd:1', color: 'blue' }))
    expect(out.bookmarks).toContainEqual(bad)
  })

  it('overlays: a newer file is read but flagged read-only, unknown kinds are carried', async () => {
    const stamp = { id: 's', kind: 'stamp', page: 0 }
    disk({ 'pdf-overlays.json': JSON.stringify({ version: 2, overlays: { doc: [stamp] } }) })
    const file = await readPdfOverlays(vault)
    expect(file.kept).toEqual({ doc: [stamp] })
  })
})

describe('vault tree listing', () => {
  beforeEach(() => { Object.values(fsMocks).forEach((mock) => mock.mockReset()) })

  it('does not list atomic-write temp and backup files', async () => {
    fsMocks.readDir.mockResolvedValue([
      { name: 'a.md', isDirectory: false },
      { name: '.iwae-1f2e3d.tmp', isDirectory: false },
      { name: '.iwae-1f2e3d.bak', isDirectory: false },
    ])
    await expect(listVaultTree(vault)).resolves.toEqual([{ path: 'a.md', isDirectory: false }])
  })
})
