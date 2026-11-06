import { useEffect, useState, type CSSProperties } from 'react'
import { readAppUsage, type AppUsage } from '../bridge/usage'
import { t } from '../i18n'

const POLL_MS = 2000

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  // 1000MB 부터는 GB 로(「1019MB」처럼 네 자리가 되지 않게)
  if (mb >= 1000) return `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)}GB`
  return `${Math.round(mb)}MB`
}

export function formatPercent(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}

/**
 * PDF 하단 막대 오른쪽 끝의 작은 CPU·메모리 표시. IWAE(웹뷰 포함)가 지금 쓰는 양이고, 마우스를 올리면 시스템 전체도 보인다.
 * 2초마다 재고, 창이 가려져 있으면 쉰다. 데스크톱 앱이 아니면(재지 못하면) 아무것도 그리지 않는다.
 */
export function UsageMeter({ style, read = readAppUsage }: {
  readonly style?: CSSProperties
  readonly read?: () => Promise<AppUsage | null>
}) {
  const [usage, setUsage] = useState<AppUsage | null>(null)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const tick = async () => {
      if (!document.hidden) {
        try {
          const next = await read()
          if (alive) setUsage(next)
        } catch {
          // 한 번 못 재도 다음에 다시 잰다
        }
      }
      if (alive) timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [read])

  if (usage === null) return null
  const systemMemory = usage.systemMemoryTotal > 0
    ? t('메모리 {used} / {total} ({percent}%)', { used: formatBytes(usage.systemMemoryUsed), total: formatBytes(usage.systemMemoryTotal), percent: Math.round((usage.systemMemoryUsed / usage.systemMemoryTotal) * 100) })
    : ''
  const title = t('IWAE(화면 그리기 포함) CPU {cpu} · 메모리 {memory}\n시스템 전체 CPU {systemCpu} · {systemMemory}', { cpu: formatPercent(usage.appCpu), memory: formatBytes(usage.appMemory), systemCpu: formatPercent(usage.systemCpu), systemMemory })
  return (
    <div className="pdf-usage-meter" role="status" aria-label={title} title={title} style={style}>
      <span><span className="pdf-usage-label">CPU </span><b>{formatPercent(usage.appCpu)}</b></span>
      <span><span className="pdf-usage-label">RAM </span><b>{formatBytes(usage.appMemory)}</b></span>
    </div>
  )
}
