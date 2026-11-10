import { comboCaps } from '../core/shortcutRegistry'

/** 키 조합을 키 칸(⌘ ⇧ F …)으로 그린다. 키가 없으면 「없음」 */
export function KeyCaps({ combo, empty }: { readonly combo: string | null; readonly empty: string }) {
  const caps = combo === null ? [] : comboCaps(combo)
  if (caps.length === 0) return <span className="keycaps keycaps-empty">{empty}</span>
  return (
    <span className="keycaps">
      {caps.map((cap, index) => <kbd key={`${cap}-${index}`} className="keycap">{cap}</kbd>)}
    </span>
  )
}
