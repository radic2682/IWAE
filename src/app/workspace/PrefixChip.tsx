import type { PrefixPhase } from './usePrefixMode'
import '../../ui/prefix-chip.css'

/**
 * 접두키 대기 표시: 접두키를 누르고 다음 키를 기다리는 동안(또는 「화면을 닫을까요?」 y/n 을 기다리는 동안)에만 상단바 바로 아래 가운데에 작은 칩으로 보인다.
 * 알림 영역(role=status)은 평소(idle)에도 그려져 있고 글만 바뀐다 — 없던 영역이 글과 함께 새로 생기면 스크린 리더가 읽지 못하기 때문이다.
 * 평소에는 글이 비고 투명하다(절대 위치라 자리를 차지하지 않으므로 아무것도 밀리지 않고, 움직임 없이 바로 나타났다 사라진다).
 * 눌러지지 않는다(pointer-events: none): 접두키가 입력기에 막히면 명령 팔레트(Ctrl+K)에 「:」 로 시작해 같은 명령을 친다.
 */
export function PrefixChip({ phase, prefixText, confirmText }: {
  readonly phase: PrefixPhase
  /** 지금 접두키 표기(`Ctrl+B` · `⌃B`) */
  readonly prefixText: string
  /** phase 가 confirm 일 때 보일 글(「화면을 닫을까요? y/n」) */
  readonly confirmText: string
}) {
  return (
    <div className="prefix-chip" role="status" aria-live="polite" data-phase={phase}>
      {phase === 'confirm' ? confirmText : phase === 'prefix' ? `${prefixText} …` : ''}
    </div>
  )
}
