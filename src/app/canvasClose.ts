export type CanvasFlush = (noteId?: string) => Promise<void>

export async function runAfterCanvasFlush(
  noteId: string | undefined,
  flush: CanvasFlush,
  action: () => void,
): Promise<void> {
  await flush(noteId)
  action()
}
