export type Lang = 'ko' | 'en'

const table = {
  install: ['설치', 'Install'],
  update: ['업데이트', 'Update'],
  reinstall: ['다시 설치', 'Reinstall'],
  olderNote: ['설치된 버전 {v}보다 낮은 버전입니다.', 'Older than the installed {v}.'],
  version: ['버전 {v}', 'Version {v}'],
  changeLocation: ['설치 위치 바꾸기', 'Change location'],
  change: ['바꾸기', 'Change'],
  appOpen: ['IWAE가 켜져 있습니다', 'IWAE is open'],
  appOpenSub: ['저장할 것이 있으면 저장해 주세요.', 'Save anything you need first.'],
  closeAndInstall: ['닫고 설치', 'Close and install'],
  closeAndUninstall: ['닫고 지우기', 'Close and uninstall'],
  appStuck: ['IWAE가 닫히지 않았습니다', "IWAE didn't close"],
  forceClose: ['강제로 닫기', 'Force close'],
  cancel: ['취소', 'Cancel'],
  installing: ['설치하고 있습니다 {p}%', 'Installing {p}%'],
  installed: ['설치했습니다', 'Installed'],
  openApp: ['IWAE 열기', 'Open IWAE'],
  failed: ['설치하지 못했습니다', "Couldn't install"],
  failedSub: ['기록에 원인을 남겼습니다.', 'The cause is in the log.'],
  retry: ['다시 시도', 'Try again'],
  showLog: ['기록 보기', 'Show log'],
  close: ['닫기', 'Close'],
  uninstallTitle: ['IWAE를 지웁니다', 'Uninstall IWAE'],
  uninstallSub: ['Vault와 설정은 남겨 둡니다.', 'Your vaults and settings stay.'],
  uninstall: ['지우기', 'Uninstall'],
  uninstalling: ['지우고 있습니다', 'Uninstalling'],
  uninstalled: ['지웠습니다', 'Uninstalled'],
  uninstallFailed: ['지우지 못했습니다', "Couldn't uninstall"],
  langKo: ['한국어', '한국어'],
  langEn: ['English', 'English'],
} as const

export type CopyKey = keyof typeof table

export function t(lang: Lang, key: CopyKey, vars: Record<string, string | number> = {}): string {
  const s: string = table[key][lang === 'ko' ? 0 : 1]
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
