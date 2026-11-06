import { createDefaultTextBlockStyle, type CanvasDocumentV2 } from './canvasDocument'

export function createInitialCanvasDocument(title: string): CanvasDocumentV2 {
  return {
    version: 2,
    nodes: [{
      id: 'note-title',
      position: { x: 80, y: 80 },
      data: {
        block: {
          kind: 'title',
          width: 320,
          height: 100,
          style: createDefaultTextBlockStyle('h4'),
          text: title,
        },
      },
      className: 'note-canvas-node',
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}
