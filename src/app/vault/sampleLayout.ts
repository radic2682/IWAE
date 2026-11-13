/**
 * 예시를 방금 넣은 Vault 의 첫 배치 요청(한 번만 쓰고 버린다).
 * 예시 PDF 는 왼쪽 칸, 예시 노트는 그 오른쪽 칸에 같은 색 채널(기본 파랑)로 열어, 처음 사용 안내가 형광펜 · 메모 카드 · 연결선을 바로 가리킬 수 있게 한다.
 * 예시를 넣은 경우(seedSampleVaultInto 가 true)에만 걸리므로 쓰던 사람의 배치는 건드리지 않는다.
 */
export interface SampleLayoutRequest {
  /** 예시 PDF 의 docId */
  readonly docId: string
  /** 예시 노트의 Vault 상대 경로(노트 탭 id 와 같다) */
  readonly notePath: string
  /** PDF 를 열 때 보일 쪽(1부터): 첫 메모의 쪽이라 형광펜이 바로 보인다. 없으면 처음 쪽 */
  readonly page?: number
}

let pending: SampleLayoutRequest | null = null

export function requestSampleLayout(request: SampleLayoutRequest): void {
  pending = request
}

export function pendingSampleLayout(): SampleLayoutRequest | null {
  return pending
}

/** 요청을 꺼내며 비운다 */
export function takeSampleLayout(): SampleLayoutRequest | null {
  const request = pending
  pending = null
  return request
}

/** 요청대로 배치해도 되는가: 아무 칸에도 탭이 없는 빈 작업 공간일 때만 */
export function mayApplySampleLayout(openTabCount: number): boolean {
  return openTabCount === 0
}
