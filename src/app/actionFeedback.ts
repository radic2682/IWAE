const groups = new WeakMap<Event, string>()

/**
 * 짧은 알림을 띄운다. group 이 같은 알림이 이미 떠 있으면 새로 쌓지 않고 그 글만 바꾼다
 * (배율을 여러 번 바꿀 때 110% · 120% · 130% 가 줄줄이 쌓이지 않게)
 */
export function announceAction(message: string, group?: string): void {
  const event = new CustomEvent<string>('iwae:action-feedback', { detail: message })
  if (group !== undefined) groups.set(event, group)
  window.dispatchEvent(event)
}

export function feedbackGroupOf(event: Event): string | undefined {
  return groups.get(event)
}
