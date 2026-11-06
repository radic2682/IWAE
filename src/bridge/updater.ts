import { isDesktop } from './window'

export interface UpdateProgress {
  readonly downloaded: number
  readonly total: number | null
}

export type NativeDownloadEvent = {
  readonly event: 'Started'
  readonly data: { readonly contentLength?: number }
} | {
  readonly event: 'Progress'
  readonly data: { readonly chunkLength: number }
} | {
  readonly event: 'Finished'
}

export interface NativeUpdate {
  readonly currentVersion: string
  readonly version: string
  readonly date?: string
  readonly body?: string
  download(onEvent?: (event: NativeDownloadEvent) => void): Promise<void>
  install(): Promise<void>
  close(): Promise<void>
}

export interface UpdatePackage {
  readonly currentVersion: string
  readonly version: string
  readonly date: string | null
  readonly body: string
  download(onProgress: (progress: UpdateProgress) => void): Promise<void>
  installAndRelaunch(): Promise<void>
  close(): Promise<void>
}

export interface UpdaterClient {
  check(): Promise<UpdatePackage | null>
}

interface UpdaterDependencies {
  check(): Promise<NativeUpdate | null>
  relaunch(): Promise<void>
}

export function createUpdaterClient(dependencies: UpdaterDependencies): UpdaterClient {
  return {
    async check() {
      const native = await dependencies.check()
      if (native === null) return null
      return {
        currentVersion: native.currentVersion,
        version: native.version,
        date: native.date ?? null,
        body: native.body ?? '',
        async download(onProgress) {
          let downloaded = 0
          let total: number | null = null
          await native.download((event) => {
            if (event.event === 'Started') {
              total = event.data.contentLength ?? null
              onProgress({ downloaded, total })
            } else if (event.event === 'Progress') {
              downloaded += event.data.chunkLength
              onProgress({ downloaded, total })
            } else {
              if (total !== null) downloaded = total
              onProgress({ downloaded, total })
            }
          })
        },
        async installAndRelaunch() {
          await native.install()
          await dependencies.relaunch()
        },
        close: () => native.close(),
      }
    },
  }
}

export const updaterClient: UpdaterClient = createUpdaterClient({
  async check() {
    if (!isDesktop()) return null
    const updater = await import('@tauri-apps/plugin-updater')
    return updater.check({ timeout: 15_000 })
  },
  async relaunch() {
    if (!isDesktop()) return
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  },
})
