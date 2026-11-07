import { useState } from 'react'
import { LaunchSplash, launchVariant } from './LaunchSplash'

/** 켤 때 한 번만 여는 장면을 띄우고, 끝나면 치운다(움직임 줄이기면 띄우지 않는다) */
export function LaunchSplashHost() {
  const [variant] = useState(launchVariant)
  const [shown, setShown] = useState(variant !== null)
  if (!shown || variant === null) return null
  return <LaunchSplash variant={variant} onDone={() => setShown(false)} />
}
