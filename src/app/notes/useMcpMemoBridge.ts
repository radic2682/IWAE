import { useEffect, useRef } from 'react'
import { currentWindowLabel, isDesktop } from '../../bridge/window'
import { isMcpOp, handleMcpOp, registeredOps } from '../mcp'
import { resetAiChangeLog } from '../mcp/aiChangeLog'
import type { McpDeps } from '../mcp/types'

/** MCP 요청 하나(Rust webview_call.rs 의 `mcp-webview-request`) */
interface WebviewRequest {
  readonly requestId: number | string
  readonly op: string
  readonly args?: Record<string, unknown>
  /** read | write | destructive | ui */
  readonly class?: string
}

export type McpMemoBridgeDeps = McpDeps

/** 시험·바깥에서 부르는 이름 그대로 둔다. 실제 일은 mcp/ 의 표가 한다 */
export const handleMcpMemoRequest = handleMcpOp

/** 이 다리가 맡는 이름 공간. 표에 없는 op 가 오면 「모른다」고 바로 답한다(캔버스 op 는 다른 다리가 받는다) */
const OWN_PREFIXES = ['memo_', 'note_', 'source_'] as const

/** 이 요청을 이 다리가 답해야 하는가: 표에 있거나, 우리 이름 공간인데 표에 없을 때 */
export function ownsOp(op: string): boolean {
  return isMcpOp(op) || OWN_PREFIXES.some((prefix) => op.startsWith(prefix))
}

/**
 * MCP 도구의 웹뷰 쪽 문. 요청을 mcp/ 의 op 표로 보내고 답한다.
 * 창이 시작될 때마다(요청 리스너를 단 뒤에) 처리할 수 있는 op 이름을 Rust 에 알린다 — 모르는 op 는 시간 제한 없이 바로 실패한다.
 * 데스크톱 앱의 메인 창에서만 돈다(요청은 메인 창이 받는다).
 */
export function useMcpMemoBridge(deps: McpDeps): void {
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!isDesktop() || currentWindowLabel() !== 'main') return
    let alive = true
    let unlisten: (() => void) | null = null
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const { invoke } = await import('@tauri-apps/api/core')
      const stop = await listen<WebviewRequest>('mcp-webview-request', (event) => {
        const { requestId, op, args } = event.payload
        if (!ownsOp(op)) return
        const reply = (ok: boolean, result: unknown, error: string | null) => invoke('mcp_webview_reply', { requestId, ok, result, error })
        void handleMcpOp(op, args ?? {}, depsRef.current)
          .then((result) => reply(true, typeof result === 'object' && result !== null && !Array.isArray(result) ? result : { result }, null))
          .catch((cause: unknown) => reply(false, null, cause instanceof Error ? cause.message : String(cause)))
      })
      if (!alive) {
        stop()
        return
      }
      unlisten = stop
      resetAiChangeLog()
      await invoke('mcp_webview_ops', { ops: registeredOps() }).catch(() => undefined)
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])
}
