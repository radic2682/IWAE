import { describe, expect, it } from 'vitest'
import { emptyCanvasDoc, serializeCanvasDoc } from './canvasSerialize'

describe('canvasSerialize', () => {
  it('빈 캔버스를 안정적인 pretty JSON으로 쓴다', () => {
    expect(serializeCanvasDoc(emptyCanvasDoc())).toBe(
      '{\n' +
      '  "edges": [],\n' +
      '  "nodes": [],\n' +
      '  "version": 2,\n' +
      '  "viewport": {\n' +
      '    "x": 0,\n' +
      '    "y": 0,\n' +
      '    "zoom": 1\n' +
      '  }\n' +
      '}\n',
    )
    expect(serializeCanvasDoc(emptyCanvasDoc())).toBe(serializeCanvasDoc(emptyCanvasDoc()))
  })

  it('최상위 키와 nodes/edges를 id 순서로 정렬한다', () => {
    expect(serializeCanvasDoc({
      nodes: [{ id: 'z', type: 'text' }, { type: 'text', id: 'a' }],
      version: 2,
      edges: [{ id: 'edge-z' }, { id: 'edge-a' }],
    })).toBe(
      '{\n' +
      '  "edges": [\n' +
      '    {\n      "id": "edge-a"\n    },\n' +
      '    {\n      "id": "edge-z"\n    }\n' +
      '  ],\n' +
      '  "nodes": [\n' +
      '    {\n      "id": "a",\n      "type": "text"\n    },\n' +
      '    {\n      "id": "z",\n      "type": "text"\n    }\n' +
      '  ],\n' +
      '  "version": 2\n' +
      '}\n',
    )
  })
})
