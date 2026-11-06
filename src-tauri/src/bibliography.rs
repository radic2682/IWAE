//! Crossref 로 DOI 서지 정보를 받는다.
//!
//! 사용자가 서지 정보 창에서 「Crossref에서 채우기」를 눌렀을 때만 부른다 — 문서를 열
//! 때마다 밖으로 요청을 보내지 않는다. 받은 JSON 의 해석은 웹뷰(`parseCrossrefWork`)가
//! 한다. 여기서는 주소를 안전하게 만들고 응답에서 `message` 만 꺼낸다.

use std::time::Duration;

const CROSSREF_WORKS: &str = "https://api.crossref.org/works/";
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);

/// `10.<숫자 4-9자리>/<공백 없는 무엇>` 꼴이고 지나치게 길지 않은가.
pub fn valid_doi(doi: &str) -> bool {
    let Some(rest) = doi.strip_prefix("10.") else {
        return false;
    };
    let Some((registrant, suffix)) = rest.split_once('/') else {
        return false;
    };
    (4..=9).contains(&registrant.len())
        && registrant.chars().all(|c| c.is_ascii_digit())
        && !suffix.is_empty()
        && doi.len() <= 300
        && !doi.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// DOI 를 URL 경로 조각으로 만든다. `/` 는 Crossref 가 경로 그대로 받으므로 두고, 그 밖의
/// 예약 문자는 퍼센트 인코딩한다 — `?`, `#` 이 그대로 가면 질의·조각으로 잘린다.
pub fn encode_doi_path(doi: &str) -> String {
    let mut encoded = String::with_capacity(doi.len());
    for byte in doi.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/');
        if keep {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Crossref 응답 본문에서 `message` 를 꺼낸다.
pub fn crossref_message(body: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|err| tr!("Crossref 응답을 읽지 못했습니다: {err}", "Could not parse the Crossref response: {err}"))?;
    value
        .get("message")
        .filter(|message| message.is_object())
        .cloned()
        .ok_or_else(|| tr!("Crossref 응답에 서지 정보가 없습니다.", "The Crossref response has no bibliographic data."))
}

#[tauri::command]
pub async fn bib_lookup_doi(doi: String) -> Result<serde_json::Value, String> {
    let doi = doi.trim().to_string();
    if !valid_doi(&doi) {
        return Err(tr!("DOI 형식이 올바르지 않습니다.", "Invalid DOI format."));
    }
    let client = reqwest::Client::builder()
        .timeout(LOOKUP_TIMEOUT)
        .user_agent(concat!(
            "IWAE/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/radic2682/IWAE)"
        ))
        .build()
        .map_err(|err| tr!("네트워크 준비에 실패했습니다: {err}", "Could not set up the network client: {err}"))?;
    let response = client
        .get(format!("{CROSSREF_WORKS}{}", encode_doi_path(&doi)))
        .send()
        .await
        .map_err(|err| tr!("Crossref 에 연결하지 못했습니다: {err}", "Could not connect to Crossref: {err}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(tr!("Crossref 에서 이 DOI 를 찾지 못했습니다.", "Crossref has no record for this DOI."));
    }
    if !response.status().is_success() {
        return Err(tr!(
            "Crossref 가 오류를 돌려주었습니다: {}",
            "Crossref returned an error: {}",
            response.status()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|err| tr!("Crossref 응답을 받지 못했습니다: {err}", "Could not receive the Crossref response: {err}"))?;
    crossref_message(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_real_dois_and_rejects_everything_else() {
        assert!(valid_doi("10.1038/nature14539"));
        assert!(valid_doi("10.1145/3290605.3300233"));
        assert!(!valid_doi("11.1038/nature"));
        assert!(!valid_doi("10.12/x"));
        assert!(!valid_doi("10.1038/"));
        assert!(!valid_doi("10.1038/a b"));
        assert!(!valid_doi("10.1038/a\nb"));
    }

    #[test]
    fn query_and_fragment_characters_are_encoded() {
        assert_eq!(encode_doi_path("10.1000/a?b#c"), "10.1000/a%3Fb%23c");
        assert_eq!(encode_doi_path("10.1000/(x)<y>"), "10.1000/%28x%29%3Cy%3E");
        assert_eq!(
            encode_doi_path("10.1038/nature14539"),
            "10.1038/nature14539"
        );
    }

    #[test]
    fn the_message_object_is_extracted() {
        let body = r#"{"status":"ok","message":{"title":["Deep Learning"]}}"#;
        assert_eq!(crossref_message(body).unwrap()["title"][0], "Deep Learning");
        assert!(crossref_message(r#"{"status":"ok"}"#).is_err());
        assert!(crossref_message("not json").is_err());
    }
}
