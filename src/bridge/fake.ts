/**
 * M1 전용 가짜 데이터. 스펙 §7.3 에 따라 바깥 세계를 만지는 코드는
 * bridge/ 안에만 둔다 — M3 에서 이 파일이 실제 vault 읽기로 바뀌어도
 * app/ 은 한 줄도 안 바뀌어야 한다.
 *
 * 그 약속을 지키려면 지금부터 비동기여야 한다. M3 의 실제 구현은
 * `invoke('load_library')` 이고 invoke 는 Promise 를 돌려준다. 여기서
 * 동기 함수를 내놓으면 app/ 이 모듈 스코프 상수로 받아 쓰게 되고,
 * M3 에서 그 상수를 state + effect 로 바꾸는 순간 "app/ 은 한 줄도 안
 * 바뀐다"는 말이 거짓이 된다. 값이 아니라 동기/비동기 경계가 이 이음매의
 * 실체이므로, 가짜 데이터일 때 미리 그 모양으로 맞춰 둔다.
 *
 * 이름을 실제 문서로 쓴 이유: 레이아웃을 확정하는 것이 M1 의 목표인데
 * "Document 1" 같은 더미로는 긴 제목이 탭에서 어떻게 잘리는지 알 수 없다.
 */

import type { LibraryDoc, NotebookGroup } from '../core/vaultTree'

export type { LibraryDoc, NotebookGroup, NotebookNote } from '../core/vaultTree'

export async function loadLibrary(): Promise<LibraryDoc[]> {
  return [
    { docId: 'ab12cd34ef56', title: 'HTTP Semantics Guide v1.1', pages: 1017 },
    { docId: '77aa11bb22cc', title: 'Rust Programming Handbook', pages: 758 },
    { docId: '99ff88ee77dd', title: 'Team Onboarding Guide (Rev C)', pages: 84 },
    { docId: '5511aa99cc33', title: 'Compilers Textbook 5.0', pages: 1299 },
  ]
}

export async function loadNotebooks(): Promise<NotebookGroup[]> {
  return [
    {
      name: 'HTTP',
      notes: [
        { path: 'HTTP/OPTIONS.canvas', title: 'OPTIONS' },
        { path: 'HTTP/HEADERS.canvas', title: 'HEADERS' },
        { path: 'HTTP/METHODS.canvas', title: 'METHODS' },
        { path: 'HTTP/CACHING.canvas', title: 'CACHING' },
      ],
    },
    {
      name: 'Systems',
      notes: [{ path: 'Systems/Paging-Notes.canvas', title: 'Paging Notes' }],
    },
  ]
}
