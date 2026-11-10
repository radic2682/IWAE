import { useEffect, useState } from 'react'

export function ActionToast() {
  // 사라지는 동안에도 마지막 글이 남아 있어야 상자가 빈 채 쪼그라들지 않는다(보이는 것만 visible 이 정한다)
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let timeout = 0
    const show = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail)
      setVisible(true)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => setVisible(false), 2800)
    }
    window.addEventListener('iwae:action-feedback', show)
    return () => {
      window.removeEventListener('iwae:action-feedback', show)
      window.clearTimeout(timeout)
    }
  }, [])
  return <div className={`app-action-toast${visible && message ? ' app-action-toast-visible' : ''}`} role="status" aria-live="polite">{message}</div>
}
