// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }))
vi.mock('@tauri-apps/api/event', () => ({ emit: async () => undefined, listen: async () => () => undefined }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (path: string) => files.has(path),
  readTextFile: async (path: string) => files.get(path) ?? '',
  rename: async (from: string, to: string) => { files.set(to, files.get(from) ?? ''); files.delete(from) },
}))

const vault = { root: 'C:/V' } as never

beforeEach(() => {
  files.clear()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
})

describe('renaming a note keeps what the app knows about its content', () => {
  it('the renamed note is not seen as changed by another program', async () => {
    const { adoptMemoNoteText, inspectMemoNote, renameMemoNote } = await import('./memoNotes')
    files.set('C:/V/Notes/a.iwnote', '{"v":1}')
    adoptMemoNoteText(vault, 'Notes/a.iwnote', '{"v":1}')
    await renameMemoNote(vault, 'Notes/a.iwnote', 'Notes/b.iwnote')
    expect((await inspectMemoNote(vault, 'Notes/b.iwnote')).state).toBe('same')
  })

  it('every note in a renamed folder stays known', async () => {
    const { adoptMemoNoteText, inspectMemoNote, renameMemoNoteFolder } = await import('./memoNotes')
    files.set('C:/V/Notes/old/a.iwnote', '{"v":2}')
    adoptMemoNoteText(vault, 'Notes/old/a.iwnote', '{"v":2}')
    await renameMemoNoteFolder(vault, 'Notes/old', 'Notes/new', ['Notes/old/a.iwnote'])
    files.set('C:/V/Notes/new/a.iwnote', '{"v":2}')
    expect((await inspectMemoNote(vault, 'Notes/new/a.iwnote')).state).toBe('same')
  })
})
