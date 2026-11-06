/**
 * 노트·메모 글쓰기 칸의 표 편집: 표 넣기, Tab 으로 칸 옮기기(마지막 칸에서 Tab 이면 줄을 더한다),
 * 줄·칸 더하기와 빼기. contentEditable 안의 <table> 을 직접 고친다(브라우저에 표 편집 명령이 없다).
 */

function caretRange(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.startContainer) ? range : null
}

/** 커서가 있는 표 칸(td·th). 표 밖이면 null */
export function tableCellAt(editor: HTMLElement): HTMLTableCellElement | null {
  const range = caretRange(editor)
  let node: Node | null = range?.startContainer ?? null
  while (node !== null && node !== editor) {
    if (node instanceof HTMLTableCellElement) return node
    node = node.parentNode
  }
  return null
}

function placeCaret(cell: HTMLElement, atEnd = false) {
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(!atEnd)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function newCell(tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = document.createElement(tag)
  cell.appendChild(document.createElement('br'))
  return cell
}

/** 커서 자리에 rows×cols 표를 넣는다(첫 줄은 머리줄). 넣은 뒤 첫 칸에 커서 */
export function insertTable(editor: HTMLElement, rows = 3, cols = 3): void {
  editor.focus()
  const head = `<tr>${'<th><br></th>'.repeat(cols)}</tr>`
  const body = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`.repeat(Math.max(rows - 1, 1))
  const marker = `iwae-table-${Date.now().toString(36)}`
  document.execCommand('insertHTML', false, `<table data-new="${marker}"><thead>${head}</thead><tbody>${body}</tbody></table><div><br></div>`)
  const table = editor.querySelector<HTMLTableElement>(`table[data-new="${marker}"]`)
  table?.removeAttribute('data-new')
  const first = table?.querySelector<HTMLElement>('th, td')
  if (first !== null && first !== undefined) placeCaret(first)
}

function cellsInOrder(table: HTMLTableElement): HTMLTableCellElement[] {
  return [...table.rows].flatMap((row) => [...row.cells])
}

/** Tab: 다음(Shift 면 앞) 칸으로. 마지막 칸에서 Tab 이면 줄을 더하고 그 첫 칸으로. 표 밖이면 false */
export function moveTableCell(editor: HTMLElement, back: boolean): boolean {
  const cell = tableCellAt(editor)
  const table = cell?.closest('table')
  if (cell === null || table === null || table === undefined) return false
  const cells = cellsInOrder(table)
  const index = cells.indexOf(cell)
  const target = cells[index + (back ? -1 : 1)]
  if (target !== undefined) {
    placeCaret(target, true)
    return true
  }
  if (back) return true
  const row = addTableRow(editor)
  const first = row?.cells[0]
  if (first !== undefined) placeCaret(first)
  return true
}

/** 커서가 있는 줄 아래에 줄을 더한다 */
export function addTableRow(editor: HTMLElement): HTMLTableRowElement | null {
  const cell = tableCellAt(editor)
  const row = cell?.parentElement
  const table = cell?.closest('table')
  if (!(row instanceof HTMLTableRowElement) || table === null || table === undefined) return null
  const columns = Math.max(...[...table.rows].map((item) => [...item.cells].reduce((sum, td) => sum + td.colSpan, 0)), 1)
  const next = document.createElement('tr')
  for (let index = 0; index < columns; index++) next.appendChild(newCell('td'))
  // 머리줄 아래에 더하면 본문 첫 줄로
  if (row.parentElement?.tagName === 'THEAD') {
    const body = table.tBodies[0] ?? table.appendChild(document.createElement('tbody'))
    body.insertBefore(next, body.firstChild)
  } else {
    row.after(next)
  }
  return next
}

/** 커서가 있는 칸 오른쪽에 칸(열)을 더한다 */
export function addTableColumn(editor: HTMLElement): boolean {
  const cell = tableCellAt(editor)
  const table = cell?.closest('table')
  if (cell === null || table === null || table === undefined) return false
  const at = cell.cellIndex
  for (const row of [...table.rows]) {
    const reference = row.cells[at]
    const created = newCell(row.parentElement?.tagName === 'THEAD' ? 'th' : 'td')
    if (reference === undefined) row.appendChild(created)
    else reference.after(created)
  }
  return true
}

/** 커서가 있는 줄을 뺀다. 마지막 줄이면 표를 통째로 뺀다 */
export function deleteTableRow(editor: HTMLElement): boolean {
  const cell = tableCellAt(editor)
  const row = cell?.parentElement
  const table = cell?.closest('table')
  if (!(row instanceof HTMLTableRowElement) || table === null || table === undefined) return false
  const neighbour = (row.nextElementSibling ?? row.previousElementSibling) as HTMLTableRowElement | null
  if (table.rows.length <= 1) {
    table.remove()
    return true
  }
  row.remove()
  const target = neighbour?.cells[Math.min(cell!.cellIndex, (neighbour?.cells.length ?? 1) - 1)] ?? table.querySelector('td, th')
  if (target instanceof HTMLElement) placeCaret(target)
  return true
}

/** 커서가 있는 칸(열)을 뺀다. 마지막 열이면 표를 통째로 뺀다 */
export function deleteTableColumn(editor: HTMLElement): boolean {
  const cell = tableCellAt(editor)
  const table = cell?.closest('table')
  if (cell === null || table === null || table === undefined) return false
  const at = cell.cellIndex
  if (Math.max(...[...table.rows].map((row) => row.cells.length)) <= 1) {
    table.remove()
    return true
  }
  for (const row of [...table.rows]) row.cells[at]?.remove()
  const target = table.rows[0]?.cells[Math.max(at - 1, 0)]
  if (target !== undefined) placeCaret(target)
  return true
}
