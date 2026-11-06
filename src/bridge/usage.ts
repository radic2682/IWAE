import { isDesktop } from './window'

/** IWAE(웹뷰 포함)와 시스템의 CPU·메모리. Rust usage.rs 의 AppUsage */
export interface AppUsage {
  /** 컴퓨터 전체(모든 코어)를 100 으로 한 % */
  readonly appCpu: number
  /** 전용 메모리(바이트) */
  readonly appMemory: number
  readonly systemCpu: number
  readonly systemMemoryUsed: number
  readonly systemMemoryTotal: number
}

/** 데스크톱 앱에서만 잰다(브라우저 미리보기·Windows 밖에서는 null) */
export async function readAppUsage(): Promise<AppUsage | null> {
  if (!isDesktop()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<AppUsage | null>('app_usage')
}
