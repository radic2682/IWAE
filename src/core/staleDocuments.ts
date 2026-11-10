/**
 * 다른 창이 쪽 편집·PDF 도구로 PDF 파일을 바꾸면(문서 id 는 그대로, 해시·쪽 수만 달라진다) 이 창이 열어 둔 문서의
 * 메타·쪽 그림은 예전 파일 것이다. 목록(library.json)의 해시가 열린 문서의 해시와 다르면 다시 열어야 한다.
 * attempted 에는 이미 다시 연 「문서:해시」 열쇠를 넣어, 파일이 밖에서 바뀌어 목록과 영영 안 맞는 문서를 되풀이해 열지 않는다.
 */
export interface OpenedDocumentHash {
  readonly docId: string
  readonly sha256: string
}

export interface LibraryDocumentHash {
  readonly docId: string
  readonly sha256: string
  readonly path: string
}

export function findStaleDocuments(
  opened: readonly OpenedDocumentHash[],
  library: readonly LibraryDocumentHash[],
  attempted: ReadonlySet<string>,
): { readonly docId: string; readonly path: string; readonly key: string }[] {
  const stale: { docId: string; path: string; key: string }[] = []
  for (const doc of opened) {
    const entry = library.find((candidate) => candidate.docId === doc.docId)
    if (entry === undefined || entry.sha256 === doc.sha256) continue
    const key = `${doc.docId}:${entry.sha256}`
    if (attempted.has(key)) continue
    stale.push({ docId: doc.docId, path: entry.path, key })
  }
  return stale
}
