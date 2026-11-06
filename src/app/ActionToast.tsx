import { useEffect, useState } from 'react'

export function ActionToast() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let timeout = 0
    const show = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => setMessage(''), 2800)
    }
    window.addEventListener('iwae:action-feedback', show)
    return () => {
      window.removeEventListener('iwae:action-feedback', show)
      window.clearTimeout(timeout)
    }
  }, [])
  return <div className={`app-action-toast${message ? ' app-action-toast-visible' : ''}`} role="status" aria-live="polite">{message}</div>
}
