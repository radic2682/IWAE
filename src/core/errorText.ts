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
 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
