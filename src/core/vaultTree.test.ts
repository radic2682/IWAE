import { describe, expect, it } from 'vitest'
import {
  buildLegacyWorkspaceTree,
  buildNotebookTree,
  buildVaultWorkspaceTree,
  placeInTreeOrder,
  projectVaultTree,
  renameFolderInTreeOrder,
  reorderVaultTreeNode,
} from './vaultTree'
import type { VaultIndexEntry } from './vaultIndex'

describe('노트 폴더는 PDF 트리에서 뺀다', () => {
  const tree = (names: string[], file: string) => buildNotebookTree([
    ...names.map((path) => ({ path, isDirectory: true })),
    ...names.map((path) => ({ path: `${path}/${file}`, isDirectory: false })),
  ]).map((group) => group.name)

  it('「노트」 폴더는 통째로 빼고, 「Notes」는 노트 파일만 든 폴더일 때만 뺀다', () => {
    expect(tree(['노트', 'PDF'], 'A.canvas')).toEqual(['PDF'])
    expect(tree(['Notes', 'PDF'], 'A.iwnote')).toEqual(['PDF'])
    // 「Notes」에 다른 파일이 있으면 사용자의 문서 폴더이니 그대로 둔다
    expect(tree(['Notes', 'PDF'], 'A.canvas')).toEqual(['Notes', 'PDF'])
    // 둘 다 있으면 「노트」가 노트 폴더이고 「Notes」는 보통 폴더
    expect(tree(['노트', 'Notes'], 'A.canvas')).toEqual(['Notes'])
  })
})

describe('buildNotebookTree', () => {
  it('중첩 폴더의 canvas 파일을 최상위 Notebook 아래에 접는다', () => {
    expect(buildNotebookTree([
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/Bus', isDirectory: true },
      { path: 'HTTP/Bus/HEADERS.canvas', isDirectory: false },
      { path: 'HTTP/OPTIONS.canvas', isDirectory: false },
      { path: 'Systems', isDirectory: true },
      { path: 'Systems/Paging.canvas', isDirectory: false },
    ])).toEqual([
      {
        name: 'HTTP',
        notes: [
          { path: 'HTTP/Bus/HEADERS.canvas', title: 'HEADERS' },
          { path: 'HTTP/OPTIONS.canvas', title: 'OPTIONS' },
        ],
      },
      { name: 'Systems', notes: [{ path: 'Systems/Paging.canvas', title: 'Paging' }] },
    ])
  })

  it('.iwae와 assets 아래는 깊이에 관계없이 제외한다', () => {
    expect(buildNotebookTree([
      { path: '.iwae', isDirectory: true },
      { path: '.iwae/cache/hidden.canvas', isDirectory: false },
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/assets', isDirectory: true },
      { path: 'HTTP/assets/capture.canvas', isDirectory: false },
      { path: 'HTTP/visible.canvas', isDirectory: false },
    ])).toEqual([
      { name: 'HTTP', notes: [{ path: 'HTTP/visible.canvas', title: 'visible' }] },
    ])
  })

  it('canvas가 아닌 파일과 vault 루트의 canvas는 Notebook으로 만들지 않는다', () => {
    expect(buildNotebookTree([
      { path: 'loose.canvas', isDirectory: false },
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/spec.pdf', isDirectory: false },
      { path: 'HTTP/readme.md', isDirectory: false },
    ])).toEqual([{ name: 'HTTP', notes: [] }])
  })

  it('빈 최상위 폴더도 Notebook으로 남긴다', () => {
    expect(buildNotebookTree([{ path: 'Empty', isDirectory: true }])).toEqual([
      { name: 'Empty', notes: [] },
    ])
  })

  it('Windows 경로 구분자도 같은 트리로 정규화한다', () => {
    expect(buildNotebookTree([
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP\\CACHING.canvas', isDirectory: false },
    ])).toEqual([
      { name: 'HTTP', notes: [{ path: 'HTTP/CACHING.canvas', title: 'CACHING' }] },
    ])
  })
})

describe('buildVaultWorkspaceTree', () => {
  it('중첩 폴더 안에 PDF와 노트를 함께 넣고 입력 순서와 무관하게 정렬한다', () => {
    const entries = [
      { path: 'Specs/Bus/HEADERS.canvas', isDirectory: false },
      { path: 'Specs/Bus', isDirectory: true },
      { path: 'Specs', isDirectory: true },
    ]
    const library = [{
      docId: 'doc-http',
      title: 'HTTP Basics',
      pages: 1017,
      folderPath: 'Specs/Bus',
    }]

    expect(buildVaultWorkspaceTree(entries, library)).toEqual([
      {
        id: 'folder:Specs',
        kind: 'folder',
        name: 'Specs',
        path: 'Specs',
        children: [
          {
            id: 'folder:Specs/Bus',
            kind: 'folder',
            name: 'Bus',
            path: 'Specs/Bus',
            children: [
              {
                id: 'note:Specs/Bus/HEADERS.canvas',
                kind: 'note',
                name: 'HEADERS',
                path: 'Specs/Bus/HEADERS.canvas',
              },
              {
                id: 'pdf:doc-http',
                kind: 'pdf',
                name: 'HTTP Basics',
                doc: library[0],
                folderPath: 'Specs/Bus',
              },
            ],
          },
        ],
      },
    ])
  })

  it('저장된 형제 순서를 적용하고 재정렬 결과를 결정적으로 반환한다', () => {
    const tree = buildVaultWorkspaceTree(
      [{ path: 'Specs', isDirectory: true }],
      [
        { docId: 'a', title: 'Alpha', pages: 1, folderPath: 'Specs' },
        { docId: 'b', title: 'Beta', pages: 1, folderPath: 'Specs' },
      ],
      { Specs: ['pdf:b', 'pdf:a'] },
    )

    expect(tree[0]?.kind === 'folder' ? tree[0].children.map((node) => node.id) : []).toEqual([
      'pdf:b',
      'pdf:a',
    ])
    expect(reorderVaultTreeNode(tree, {
      parentPath: 'Specs',
      nodeId: 'pdf:a',
      targetNodeId: 'pdf:b',
      position: 'before',
    })[0]).toMatchObject({
      children: [{ id: 'pdf:a' }, { id: 'pdf:b' }],
    })
  })

  it('기존 평면 Library와 Notebook fixture도 폴더 트리로 변환한다', () => {
    expect(buildLegacyWorkspaceTree(
      [{ docId: 'doc-a', title: 'Spec', pages: 12 }],
      [{ name: 'HTTP', notes: [{ path: 'HTTP/OPTIONS.canvas', title: 'OPTIONS' }] }],
    )).toMatchObject([
      { id: 'folder:Library', children: [{ id: 'pdf:doc-a' }] },
      {
        id: 'folder:Notebooks',
        children: [{ id: 'folder:Notebooks/HTTP', children: [{ id: 'note:HTTP/OPTIONS.canvas' }] }],
      },
    ])
  })

  it('명시 순서가 없으면 이름과 관계없이 폴더를 문서보다 먼저 둔다', () => {
    expect(buildVaultWorkspaceTree(
      [{ path: 'Zulu', isDirectory: true }],
      [{ docId: 'a', title: 'Alpha', pages: 1 }],
    ).map((node) => node.id)).toEqual(['folder:Zulu', 'pdf:a'])
  })

  it('Markdown 파일을 편집 가능한 캔버스와 다른 읽기 문서로 분류한다', () => {
    expect(buildVaultWorkspaceTree([
      { path: 'Notes', isDirectory: true },
      { path: 'Notes/Overview.md', isDirectory: false },
      { path: 'Notes/Sketch.canvas', isDirectory: false },
    ], [])).toMatchObject([{
      id: 'folder:Notes',
      children: [
        { id: 'markdown:Notes/Overview.md', kind: 'markdown', name: 'Overview' },
        { id: 'note:Notes/Sketch.canvas', kind: 'note', name: 'Sketch' },
      ],
    }])
  })

  it('긴 .markdown 확장자도 정확한 표시 이름의 읽기 문서로 분류한다', () => {
    expect(buildVaultWorkspaceTree([
      { path: 'Notes/Architecture.markdown', isDirectory: false },
    ], [])).toMatchObject([{
      id: 'folder:Notes',
      children: [{
        id: 'markdown:Notes/Architecture.markdown',
        kind: 'markdown',
        name: 'Architecture',
        storage: 'vault',
        indexId: 'Notes/Architecture.markdown',
      }],
    }])
  })

  it('vault 밖의 indexed Markdown reference도 안정 ID와 표시 이름으로 투영한다', () => {
    const reference: VaultIndexEntry = {
      id: '8cc94e6f-13da-4fd3-87a8-4e61bcb82239',
      kind: 'markdown',
      storage: 'reference',
      path: 'C:/External/Design.md',
      displayName: '외부 설계',
      contentHash: null,
      size: 100,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }

    expect(buildVaultWorkspaceTree([], [], {}, new Map(), [reference])).toMatchObject([{
      id: `markdown:${reference.id}`,
      kind: 'markdown',
      name: '외부 설계',
      path: reference.path,
      storage: 'reference',
      indexId: reference.id,
    }])
  })

  it('vault 소유 Markdown은 인덱스에도 있어도 한 번만 표시한다', () => {
    const indexed: VaultIndexEntry = {
      id: 'vault-markdown-id',
      kind: 'markdown',
      storage: 'vault',
      path: 'Notes/Overview.md',
      displayName: '설계 개요',
      contentHash: null,
      size: 100,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }

    const tree = buildVaultWorkspaceTree([
      { path: 'Notes', isDirectory: true },
      { path: 'Notes/Overview.md', isDirectory: false },
    ], [], {}, new Map([[indexed.path, indexed.displayName]]), [indexed])
    const folder = tree[0]

    expect(folder?.kind === 'folder' ? folder.children : []).toHaveLength(1)
  })

  it('캔버스와 Markdown의 저장된 표시 이름을 파일명 대신 사용한다', () => {
    const aliases = new Map([
      ['Notes/Overview.md', '설계 개요'],
      ['Notes/Sketch.canvas', '아이디어 보드'],
    ])

    expect(buildVaultWorkspaceTree([
      { path: 'Notes', isDirectory: true },
      { path: 'Notes/Overview.md', isDirectory: false },
      { path: 'Notes/Sketch.canvas', isDirectory: false },
    ], [], {}, aliases)).toMatchObject([{
      children: [
        { kind: 'markdown', name: '설계 개요' },
        { kind: 'note', name: '아이디어 보드' },
      ],
    }])
  })

  it('하나의 vault 트리를 PDF 문서와 노트 전용 트리로 투영한다', () => {
    const tree = buildVaultWorkspaceTree([
      { path: 'Specs', isDirectory: true },
      { path: 'Specs/Canvas.canvas', isDirectory: false },
      { path: 'Specs/Readme.md', isDirectory: false },
    ], [{ docId: 'pdf-a', title: 'Spec PDF', pages: 2, folderPath: 'Specs' }])

    const projected = projectVaultTree(tree)

    expect(projected.documents).toMatchObject([{
      id: 'folder:Specs',
      children: [
        { id: 'markdown:Specs/Readme.md' },
        { id: 'pdf:pdf-a' },
      ],
    }])
    expect(projected.notes).toMatchObject([{
      id: 'folder:Specs',
      children: [{ id: 'note:Specs/Canvas.canvas' }],
    }])
  })

  it('드롭 대상을 기준으로 형제를 여러 칸 옮긴다', () => {
    const tree = buildVaultWorkspaceTree([], [
      { docId: 'a', title: 'Alpha', pages: 1 },
      { docId: 'b', title: 'Beta', pages: 1 },
      { docId: 'c', title: 'Gamma', pages: 1 },
    ])

    expect(reorderVaultTreeNode(tree, {
      parentPath: '',
      nodeId: 'pdf:c',
      targetNodeId: 'pdf:a',
      position: 'before',
    }).map((node) => node.id)).toEqual(['pdf:c', 'pdf:a', 'pdf:b'])
  })
})

describe('placeInTreeOrder · renameFolderInTreeOrder', () => {
  const order = { '': ['folder:A', 'pdf:x', 'folder:B'], A: ['note:A/n.canvas', 'pdf:y'], B: [] }

  it('다른 폴더의 항목 앞에 놓으면 원래 부모에서 빼고 그 자리에 넣는다', () => {
    const next = placeInTreeOrder(order, {
      nodeId: 'pdf:x', fromParent: '', toParent: 'A', targetNodeId: 'pdf:y', position: 'before',
    })
    expect(next['']).toEqual(['folder:A', 'folder:B'])
    expect(next.A).toEqual(['note:A/n.canvas', 'pdf:x', 'pdf:y'])
  })

  it('폴더 안(inside)이면 맨 끝, 옮기며 id 가 바뀌면 새 id 로 넣는다', () => {
    const next = placeInTreeOrder(order, {
      nodeId: 'note:A/n.canvas', fromParent: 'A', toParent: '', targetNodeId: 'folder:A', position: 'after',
    }, 'note:n.canvas')
    expect(next['']).toEqual(['folder:A', 'note:n.canvas', 'pdf:x', 'folder:B'])
    expect(next.A).toEqual(['pdf:y'])
    const inside = placeInTreeOrder(order, { nodeId: 'pdf:x', fromParent: '', toParent: 'B', targetNodeId: null, position: 'inside' })
    expect(inside.B).toEqual(['pdf:x'])
  })

  it('폴더 경로가 바뀌면 그 폴더와 하위의 순서 키·id 를 따라 옮긴다(PDF id 는 그대로)', () => {
    const next = renameFolderInTreeOrder({ '': ['folder:A'], A: ['folder:A/C', 'note:A/n.canvas', 'pdf:y'], 'A/C': ['pdf:z'] }, 'A', 'Z/A')
    expect(next).toEqual({ '': ['folder:Z/A'], 'Z/A': ['folder:Z/A/C', 'note:Z/A/n.canvas', 'pdf:y'], 'Z/A/C': ['pdf:z'] })
  })
})
