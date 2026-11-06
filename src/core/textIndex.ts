/**
 * 페이지 텍스트 인덱스의 모양. Rust 쪽 `PageTextIndex`(src-tauri/src/pdf/engine.rs)가
 * `#[serde(...)]` 없이 그대로 직렬화되므로 이름이 하나하나 맞는다. 여기엔 타입만 둔다 —
 * 이 파일을 읽는 쪽은 앵커(anchor.ts)와 히트 테스트뿐이고, 둘 다 데이터를 받아 데이터를
 * 돌려주는 순수 계산이다(스펙 §7: core 는 아무것도 모른다).
 *
 * # 인덱스 약속 — 이 모듈 전체가 여기 기댄다
 *
 * `text` 는 `chars[i].c` 를 순서대로 이어 붙인 것이고, `i` 는 그 글자의 `text` 안
 * **UTF-16 코드 단위 오프셋**이다. 따라서 `text.slice(a, b)` 와 `chars.slice(a, b)` 가
 * 언제나 같은 구간을 가리킨다. 스펙 §5.3 의 1단계가 `text.slice(...) === quote` 하나로
 * 끝나는 것도, 앵커의 `charRange` 로 상자를 되찾을 수 있는 것도 이 약속 덕분이다.
 *
 * Rust 가 BMP 밖 글자를 `U+FFFD` 하나로 바꿔 넣어 이 약속을 강제한다. 그쪽 셈법은
 * 스칼라라서, 강제하지 않으면 BMP 밖 글자 하나 뒤의 모든 앵커가 조용히 한 칸씩 밀린다.
 */

/**
 * 글자 하나와 그 상자. 좌표는 PDFium 페이지 좌표(points)이고 `y` 는 상자의 **위쪽**,
 * 아래로 증가한다. 회전(`/Rotate`)과 y 뒤집기는 Rust 가 이미 적용했으므로 이 숫자는
 * 사용자가 실제로 클릭하는 렌더 이미지와 같은 공간에 있다(스펙 §5.1: 변환을 하지 않는
 * 것이 최선의 변환이다 — 줌 배율이나 렌더 해상도는 여기 섞이지 않는다).
 */
export interface CharBox {
  readonly c: string
  readonly x: number
  readonly y: number
  /**
   * 폭과 높이. 언제나 0 이상이고, **0 이 흔하다.** PDFium 이 줄 끝에 끼워 넣는 생성
   * `\r\n` 의 상자가 한 점으로 눌려 있기 때문이다(실측: 한 페이지 6,880자 중 929자).
   * 면적이 없는 글자는 화면에 아무것도 차지하지 않으므로 rects 를 만들 때 건너뛴다.
   */
  readonly w: number
  readonly h: number
}

/** 페이지 하나의 전체 텍스트와 글자별 상자. 위의 인덱스 약속이 이 둘을 묶는다. */
export interface PageTextIndex {
  readonly text: string
  readonly chars: readonly CharBox[]
}
