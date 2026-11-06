import { describe, expect, it } from 'vitest'
import { createDefaultTextBlockStyle, type CanvasDocumentV2 } from './canvasDocument'
import { executeCanvasCommand } from './canvasCommands'

function paragraph(id: string, x: number): CanvasDocumentV2['nodes'][number] {
  return {
    id,
    type: 'textBlock',
    position: { x, y: 0 },
    data: {
      block: {
        kind: 'paragraph',
        width: 280,
        height: 80,
        style: createDefaultTextBlockStyle(),
        text: id,
      },
    },
  }
}

const document: CanvasDocumentV2 = {
  version: 2,
  nodes: [paragraph('a', 0), paragraph('b', 320)],
  edges: [{ id: 'a-b', source: 'a', target: 'b', startMarker: 'none', endMarker: 'arrow' }],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('executeCanvasCommand', () => {
  it('선택한 블록과 연결된 선을 원자적으로 삭제한다', () => {
    const next = executeCanvasCommand(document, { type: 'delete-selection' }, {
      selectedNodeIds: ['a'],
      selectedEdgeIds: [],
    })

    expect(next.nodes.map(({ id }) => id)).toEqual(['b'])
    expect(next.edges).toEqual([])
  })

  it('현재 보이는 캔버스 위치에 기본 본문 블록을 추가한다', () => {
    const next = executeCanvasCommand({ ...document, nodes: [], edges: [] }, {
      type: 'add-block',
      preset: 'paragraph',
    }, {
      selectedNodeIds: [],
      selectedEdgeIds: [],
      insertionPoint: { x: -240, y: 360 },
    })

    expect(next.nodes[0]).toMatchObject({
      id: 'paragraph-0',
      position: { x: -240, y: 360 },
      data: { block: { kind: 'paragraph', width: 280, height: 80 } },
    })
  })

  it('블록과 내부 연결선을 복제하면서 양끝 화살표 설정을 보존한다', () => {
    const next = executeCanvasCommand(document, { type: 'duplicate-selection' }, {
      selectedNodeIds: ['a', 'b'],
      selectedEdgeIds: ['a-b'],
    })

    expect(next.nodes).toHaveLength(4)
    expect(next.edges).toContainEqual(expect.objectContaining({
      source: 'a-copy-1',
      target: 'b-copy-1',
      startMarker: 'none',
      endMarker: 'arrow',
    }))
  })

  it('선택한 선의 시작과 끝 마커를 독립적으로 바꾼다', () => {
    const next = executeCanvasCommand(document, {
      type: 'set-edge-markers',
      start: 'arrow',
      end: 'none',
    }, {
      selectedNodeIds: [],
      selectedEdgeIds: ['a-b'],
    })

    expect(next.edges[0]).toMatchObject({ startMarker: 'arrow', endMarker: 'none' })
  })
})
