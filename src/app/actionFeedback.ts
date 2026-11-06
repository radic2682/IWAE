export function announceAction(message: string): void {
  window.dispatchEvent(new CustomEvent<string>('iwae:action-feedback', { detail: message }))
}
