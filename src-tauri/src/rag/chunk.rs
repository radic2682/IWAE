//! 페이지 본문을 검색 단위로 자른다.
//!
//! 오프셋은 원래 페이지 본문의 UTF-16 코드 단위다 — 웹뷰의 `PageTextIndex` 와 같은
//! 약속이라, 검색 결과의 `charStart..charEnd` 를 그대로 `buildAnchor` 에 넘길 수 있다.

/// 한 조각의 목표 길이(글자). 임베딩 모델 입력과 FTS 결과의 읽을 만한 길이 사이의 타협이다.
pub const CHUNK_CHARS: usize = 900;
/// 앞 조각과 겹치는 길이. 문장이 조각 경계에서 잘려도 어느 한쪽에는 온전히 남는다.
pub const CHUNK_OVERLAP: usize = 150;
/// 끝을 문장·줄 경계로 당길 때 뒤로 살펴보는 범위.
const BOUNDARY_LOOKBACK: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// 원래 본문에서의 시작(UTF-16, 포함).
    pub start: usize,
    /// 원래 본문에서의 끝(UTF-16, 미포함).
    pub end: usize,
    /// 공백을 한 칸으로 줄인 본문. 검색·임베딩에 쓴다.
    pub text: String,
}

fn is_sentence_end(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '。' | '！' | '？' | '\n')
}

/// 공백 덩어리를 한 칸으로 줄이고 양끝을 다듬는다.
pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn chunk_page(text: &str) -> Vec<Chunk> {
    // (글자, 그 글자의 UTF-16 시작 위치). 끝에 본문 전체 길이를 덧붙여 경계 계산을 단순하게 한다.
    let mut chars: Vec<(char, usize)> = Vec::with_capacity(text.len());
    let mut offset = 0usize;
    for c in text.chars() {
        chars.push((c, offset));
        offset += c.len_utf16();
    }
    let total = chars.len();
    let utf16_at = |index: usize| chars.get(index).map(|&(_, at)| at).unwrap_or(offset);

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < total {
        let mut end = (start + CHUNK_CHARS).min(total);
        if end < total {
            // 창 끝 근처에서 문장·줄 경계를 찾아 거기서 자른다.
            let floor = end.saturating_sub(BOUNDARY_LOOKBACK).max(start + 1);
            if let Some(boundary) = (floor..end).rev().find(|&at| is_sentence_end(chars[at].0)) {
                end = boundary + 1;
            }
        }

        // 앞뒤 공백을 빼고 실제 내용이 있는 범위만 오프셋으로 남긴다.
        let mut first = start;
        while first < end && chars[first].0.is_whitespace() {
            first += 1;
        }
        let mut last = end;
        while last > first && chars[last - 1].0.is_whitespace() {
            last -= 1;
        }
        if first < last {
            let slice: String = chars[first..last].iter().map(|&(c, _)| c).collect();
            chunks.push(Chunk {
                start: utf16_at(first),
                end: utf16_at(last),
                text: collapse_whitespace(&slice),
            });
        }

        if end >= total {
            break;
        }
        // 다음 창은 겹치게 시작하되, 앞으로 반드시 나아간다.
        let mut next = end.saturating_sub(CHUNK_OVERLAP).max(start + 1);
        // 낱말 한가운데서 시작하지 않도록 다음 공백까지 조금 민다.
        let push_limit = (next + 40).min(end);
        while next < push_limit && !chars[next - 1].0.is_whitespace() {
            next += 1;
        }
        start = next;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16_slice(text: &str, start: usize, end: usize) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[start..end]).unwrap()
    }

    #[test]
    fn a_short_page_is_one_trimmed_chunk() {
        let chunks = chunk_page("  Dynamic address\r\nassignment.  ");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "Dynamic address assignment.");
        assert_eq!(
            utf16_slice(
                "  Dynamic address\r\nassignment.  ",
                chunks[0].start,
                chunks[0].end
            ),
            "Dynamic address\r\nassignment."
        );
    }

    #[test]
    fn long_pages_split_with_overlap_and_offsets_map_back() {
        let sentence = "버스 초기화가 끝나면 동적 주소 할당이 시작된다. ";
        let text = sentence.repeat(80);
        let chunks = chunk_page(&text);
        assert!(chunks.len() >= 3, "{}", chunks.len());
        for pair in chunks.windows(2) {
            assert!(pair[1].start < pair[0].end, "조각이 겹쳐야 한다");
            assert!(pair[1].start > pair[0].start, "앞으로 나아가야 한다");
        }
        for chunk in &chunks {
            let original = utf16_slice(&text, chunk.start, chunk.end);
            assert_eq!(collapse_whitespace(&original), chunk.text);
            assert!(chunk.text.chars().count() <= CHUNK_CHARS);
        }
        // 문장 경계에서 잘린다.
        assert!(chunks[0].text.ends_with('.'), "{}", chunks[0].text);
    }

    #[test]
    fn characters_outside_the_bmp_count_as_two_units() {
        let text = "😀 emoji then words";
        let chunks = chunk_page(text);
        assert_eq!(chunks[0].start, 0);
        assert_eq!(chunks[0].end, text.encode_utf16().count());
    }

    #[test]
    fn blank_pages_have_no_chunks() {
        assert!(chunk_page("   \r\n  ").is_empty());
        assert!(chunk_page("").is_empty());
    }
}
