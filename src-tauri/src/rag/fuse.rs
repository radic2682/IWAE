//! 검색어 해석, 두 순위 목록의 합치기, 벡터 저장 형식.

/// FTS5 trigram 토크나이저는 세 글자보다 짧은 낱말로는 찾지 못한다. "버스" 같은 두 글자
/// 한국어 낱말이 흔해서, 짧은 낱말은 따로 모아 부분 문자열 검색으로 돌린다.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FtsPlan {
    /// `MATCH` 에 넣을 식. 세 글자 이상 낱말을 각각 따옴표로 감싸 AND 로 잇는다.
    pub phrase: Option<String>,
    /// 세 글자 미만 낱말.
    pub short_tokens: Vec<String>,
}

pub fn fts_query(query: &str) -> FtsPlan {
    let mut long = Vec::new();
    let mut short = Vec::new();
    for raw in query.split_whitespace() {
        let token: String = raw.chars().filter(|c| *c != '"').collect();
        if token.is_empty() {
            continue;
        }
        if token.chars().count() >= 3 {
            long.push(format!("\"{token}\""));
        } else {
            short.push(token);
        }
    }
    FtsPlan {
        phrase: (!long.is_empty()).then(|| long.join(" ")),
        short_tokens: short,
    }
}

/// Reciprocal Rank Fusion. 각 목록에서 순위 r(0-기반)의 항목에 1/(k + r + 1) 을 더한다.
/// 점수가 같으면 먼저 나온 목록의 순서를 따른다.
pub fn rrf(lists: &[Vec<i64>], k: f64) -> Vec<(i64, f64)> {
    let mut scores: Vec<(i64, f64, usize)> = Vec::new();
    let mut order = 0usize;
    for list in lists {
        for (rank, id) in list.iter().enumerate() {
            let add = 1.0 / (k + rank as f64 + 1.0);
            if let Some(entry) = scores.iter_mut().find(|entry| entry.0 == *id) {
                entry.1 += add;
            } else {
                scores.push((*id, add, order));
                order += 1;
            }
        }
    }
    scores.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.2.cmp(&b.2))
    });
    scores
        .into_iter()
        .map(|(id, score, _)| (id, score))
        .collect()
}

pub fn encode_vector(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

pub fn decode_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub fn normalize(vector: &mut [f32]) {
    let length = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if length > 0.0 {
        vector.iter_mut().for_each(|value| *value /= length);
    }
}

/// 정규화된 두 벡터의 코사인 유사도(= 내적). 길이가 다르면 0.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// 검색어가 처음 나오는 자리 주변을 `max` 글자 안으로 잘라 보여 준다.
pub fn snippet(text: &str, query: &str, max: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_string();
    }
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    let hit = query
        .split_whitespace()
        .filter_map(|token| {
            let needle: Vec<char> = token.to_lowercase().chars().collect();
            if needle.is_empty() || needle.len() > lower.len() {
                return None;
            }
            (0..=lower.len() - needle.len()).find(|&at| lower[at..at + needle.len()] == needle[..])
        })
        .min()
        .unwrap_or(0);
    let start = hit.saturating_sub(max / 3).min(chars.len() - max);
    let end = start + max;
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_tokens_become_a_quoted_and_short_tokens_go_aside() {
        assert_eq!(
            fts_query("dynamic \"address\" 버스 할당"),
            FtsPlan {
                phrase: Some("\"dynamic\" \"address\"".into()),
                short_tokens: vec!["버스".into(), "할당".into()]
            }
        );
        assert_eq!(fts_query("   "), FtsPlan::default());
    }

    #[test]
    fn rrf_rewards_items_found_by_both_lists() {
        let fused = rrf(&[vec![1, 2, 3], vec![3, 4]], 60.0);
        assert_eq!(fused[0].0, 3);
        assert_eq!(
            fused.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
            vec![3, 1, 2, 4]
        );
    }

    #[test]
    fn vectors_round_trip_and_cosine_is_a_dot_product() {
        let mut v = vec![3.0, 4.0];
        normalize(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6);
        assert_eq!(decode_vector(&encode_vector(&v)), v);
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
        assert_eq!(cosine(&v, &[1.0]), 0.0);
    }

    #[test]
    fn snippets_center_on_the_first_hit() {
        let text = format!("{}TARGET word{}", "a ".repeat(200), " b".repeat(200));
        let shown = snippet(&text, "target", 60);
        assert!(shown.contains("TARGET"), "{shown}");
        assert!(shown.starts_with('…') && shown.ends_with('…'));
        assert_eq!(snippet("short", "x", 60), "short");
    }
}
