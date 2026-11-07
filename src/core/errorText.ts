import { t } from '../i18n'

/**
 * 던져진 것을 사람이 읽을 한 줄로 바꾼다.
 *
 * `catch (err)` 의 `err` 는 `unknown` 이다 — `Error` 라는 보장이 없고, 실제로
 * 문자열을 던지는 코드가 세상에 있다. 그냥 `String(err)` 로 찍으면 객체가
 * `[object Object]` 가 되어 화면에 아무 정보도 안 남는다.
 *
 * 같은 세 줄이 VaultPicker·App·bridge 세 군데에 각각 있었다. 지금은 셋이
 * 같지만 다음에 한쪽만 고쳐지는 것이 이런 중복이 무너지는 방식이라, 규칙을
 * 아무것도 모르는 core 에 한 벌만 둔다.
 *
 * 운영체제 오류(Rust 의 `... (os error 32)`)는 흔한 것만 쉬운 말로 바꾼다.
 * 사용자가 할 일을 알 수 있게: 다른 앱이 쥐고 있다 / 권한이 없다 / 공간이 없다.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return friendlyOsError(raw) ?? raw
}

/** 흔한 운영체제 오류 번호 → 쉬운 말. 모르는 번호면 null(원문 그대로) */
export function friendlyOsError(message: string): string | null {
  const match = /\(os error (\d+)\)/.exec(message)
  if (match === null) return null
  switch (Number(match[1])) {
    case 32: // Windows: 다른 프로세스가 사용 중
    case 33:
      return t('다른 앱이 이 파일을 쓰고 있습니다. 그 앱에서 파일을 닫은 뒤 다시 해 보세요')
    case 5: // Windows: 접근 거부
    case 13: // macOS·Linux: Permission denied
    case 1:
      return t('이 위치에 쓸 권한이 없습니다. 다른 폴더를 고르거나 권한을 확인해 보세요')
    case 2: // 파일 없음
    case 3: // Windows: 경로 없음
      return t('파일이나 폴더를 찾을 수 없습니다. 옮겨졌거나 지워졌을 수 있습니다')
    case 112: // Windows: 디스크 공간 부족
    case 28: // macOS·Linux: No space left on device
      return t('디스크 공간이 모자랍니다. 공간을 비운 뒤 다시 해 보세요')
    case 80: // Windows: 파일 있음
    case 183:
    case 17: // macOS·Linux: File exists
      return t('같은 이름의 파일이 이미 있습니다')
    default:
      return null
  }
}
