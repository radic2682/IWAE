import { aiActivityBegin, aiActivityEnd } from './aiActivityStore'
import { runAiChange } from './aiChangeLog'
import { stateOps } from './appState'
import { bookmarkOps } from './bookmarks'
import { libraryOps } from './library'
import { memoOps, currentHighlights } from './memoTools'
import { navigationOps } from './navigation'
import { noteAdapter } from './noteAdapter'
import { noteOps } from './noteTools'
import { pdfToolOps } from './pdfTools'
import { sourceOps } from './sourceTools'
import { translateOps } from './translate'
import { workspaceCommandOps } from './workspaceCommand'
import type { ChangeNote, McpDeps, OpContext, OpDef } from './types'

/**
 * 웹뷰가 처리하는 MCP op 표. Rust 의 app_tools::webview_ops() 와 이름·성격이 같아야 한다(index.test.ts 가 맞춰 본다).
 * 이 표에 없는 op 는 처리하지 않는다 — 같은 이벤트를 듣는 다른 다리(캔버스)가 받게 둔다.
 */
export const OPS: Readonly<Record<string, OpDef>> = {
  ...memoOps,
  ...noteOps,
  ...sourceOps,
  ...stateOps,
  ...navigationOps,
  ...workspaceCommandOps,
  ...bookmarkOps,
  ...libraryOps,
  ...translateOps,
  ...pdfToolOps,
}

/** `mcp_webview_ops` 로 알릴 이름들 */
export function registeredOps(): string[] {
  return Object.keys(OPS)
}

export function isMcpOp(op: string): boolean {
  return Object.hasOwn(OPS, op)
}

function targetHint(args: Record<string, unknown>): string {
  return typeof args.title === 'string' ? args.title : typeof args.note_title === 'string' ? args.note_title : ''
}

/**
 * 요청 하나를 처리한다. 쓰기·파괴 op 는 되돌리기 묶음 하나 + AI 변경 기록 하나로 감싼다.
 * ui op 는 되돌리기 없이 활동 알약만 켠다. 읽기는 그냥 돈다.
 */
export async function handleMcpOp(op: string, args: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
  if (!isMcpOp(op)) throw new Error(`unsupported op: ${op}`)
  const def = OPS[op]!
  const notes = noteAdapter(deps.notes)
  const make = (change: ChangeNote): OpContext => ({ deps, notes, change, highlights: () => currentHighlights(deps) })
  if (def.cls === 'read') {
    // 읽기는 아무것도 바꾸지 않는다: 알약만 켜고 0개 변경으로 끝낸다
    aiActivityBegin(targetHint(args))
    try {
      return await def.run(args, make({ target: '', count: 0, summary: '' }))
    } finally {
      aiActivityEnd(0)
    }
  }
  // 되돌리기는 AI 변경이 아니다: 묶음을 새로 만들지 않고 알약만 켠다
  if (def.cls === 'ui' || op === 'ai_undo') {
    aiActivityBegin(targetHint(args))
    const change: ChangeNote = { target: '', count: 0, summary: '' }
    try {
      return await def.run(args, make(change))
    } finally {
      aiActivityEnd(0, change.target)
    }
  }
  return runAiChange(op, (change) => def.run(args, make(change)), targetHint(args))
}
