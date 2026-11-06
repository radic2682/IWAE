// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { dropZoneAt } from './dropZone'

function at(html: string, selector: string) {
  document.body.innerHTML = html
  const target = document.querySelector(selector)!
  const root = { elementFromPoint: () => target } as unknown as Document
  return dropZoneAt({ x: 1, y: 1 }, root)
}

describe('dropZoneAt', () => {
  it('PDF 자리면 열기, 왼쪽 바면 가져오기(폴더 위면 그 폴더)', () => {
    expect(at('<div class="panes"><div class="pane"><i id="t"></i></div></div>', '#t')).toEqual({ kind: 'reader' })
    expect(at('<aside class="sidebar"><li data-internal-drop="tree-node" data-kind="folder" data-path="02_EDSFF"><span id="t"></span></li></aside>', '#t'))
      .toEqual({ kind: 'vault', folderPath: '02_EDSFF' })
    expect(at('<aside class="sidebar"><li data-internal-drop="tree-node" data-kind="pdf" data-parent-path="99_Etc"><span id="t"></span></li></aside>', '#t'))
      .toEqual({ kind: 'vault', folderPath: '99_Etc' })
    expect(at('<aside class="sidebar"><p id="t"></p></aside>', '#t')).toEqual({ kind: 'vault', folderPath: null })
  })

  it('펼친 라이브러리: 폴더 줄이면 그 폴더, 폴더를 보고 있는 표면 그 폴더', () => {
    expect(at('<nav class="sidebar-inner"><div data-library-folder="논문/2026"><span id="t"></span></div></nav>', '#t'))
      .toEqual({ kind: 'vault', folderPath: '논문/2026' })
    expect(at('<nav class="sidebar-inner"><section data-drop-folder="논문"><div class="library-row"><i id="t"></i></div></section></nav>', '#t'))
      .toEqual({ kind: 'vault', folderPath: '논문' })
    expect(at('<nav class="sidebar-inner"><section class="library-items"><i id="t"></i></section></nav>', '#t'))
      .toEqual({ kind: 'vault', folderPath: null })
  })

  it('트리 줄 위아래 끝이면 그 줄 앞·뒤, 폴더 줄 가운데면 그 폴더 안에 놓을 자리를 준다', () => {
    document.body.innerHTML = `<aside class="sidebar"><ul>
      <li id="pdf" data-internal-drop="tree-node" data-kind="pdf" data-node-id="pdf:a1" data-parent-path="99_Etc"><div class="side-tree-row"><span id="p"></span></div></li>
      <li id="fold" data-internal-drop="tree-node" data-kind="folder" data-node-id="folder:02_EDSFF" data-path="02_EDSFF" data-parent-path=""><div class="side-tree-row"><span id="f"></span></div></li>
    </ul></aside>`
    for (const row of document.querySelectorAll<HTMLElement>('.side-tree-row')) {
      row.getBoundingClientRect = () => ({ top: 100, bottom: 120, height: 20, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) })
    }
    const zoneOver = (selector: string, y: number) => dropZoneAt({ x: 10, y }, { elementFromPoint: () => document.querySelector(selector) } as unknown as Document)
    expect(zoneOver('#p', 102)).toEqual({ kind: 'vault', folderPath: '99_Etc', place: { nodeId: 'pdf:a1', position: 'before' } })
    expect(zoneOver('#p', 118)).toEqual({ kind: 'vault', folderPath: '99_Etc', place: { nodeId: 'pdf:a1', position: 'after' } })
    expect(zoneOver('#f', 110)).toEqual({ kind: 'vault', folderPath: '02_EDSFF', place: { nodeId: 'folder:02_EDSFF', position: 'inside' } })
    expect(zoneOver('#f', 101)).toEqual({ kind: 'vault', folderPath: '', place: { nodeId: 'folder:02_EDSFF', position: 'before' } })
    // PDF 줄 가운데: 그 문서의 새 판으로 겹치기
    expect(zoneOver('#p', 110)).toEqual({ kind: 'vault', folderPath: '99_Etc', place: { nodeId: 'pdf:a1', position: 'inside' }, stackOnDocId: 'a1' })
  })
})
