//! 요청이 서버에 닿기 전의 문지기. 경로·메서드·토큰·출처·크기를 본다.

/// 본문 상한. MCP 요청은 작다 — 이보다 크면 정상 클라이언트가 아니다.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rejection {
    pub status: u16,
    pub reason: &'static str,
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

/// 길이가 같은 두 문자열을 시간 차이 없이 비교한다(토큰 추측 공격 방어).
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 받아들일 요청이면 Ok. 아니면 돌려줄 상태 코드.
///
/// `Origin` 이 붙은 요청은 브라우저 안의 웹페이지에서 온 것이다. 토큰이 없으면 어차피
/// 막히지만, DNS 리바인딩으로 토큰이 새는 경로까지 미리 끊는다 — MCP 클라이언트는
/// 브라우저가 아니라서 `Origin` 을 보내지 않는다(`null` 은 허용).
pub fn check_request(
    method: &str,
    path: &str,
    headers: &[(String, String)],
    token: &str,
    body_len: usize,
) -> Result<(), Rejection> {
    let path = path.split('?').next().unwrap_or(path);
    if path != "/mcp" {
        return Err(Rejection {
            status: 404,
            reason: "없는 경로입니다.",
        });
    }
    if let Some(origin) = header(headers, "Origin") {
        if origin != "null" {
            return Err(Rejection {
                status: 403,
                reason: "브라우저에서 온 요청은 받지 않습니다.",
            });
        }
    }
    let presented = header(headers, "Authorization")
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .unwrap_or("");
    if presented.is_empty() || !constant_time_eq(presented.trim(), token) {
        return Err(Rejection {
            status: 401,
            reason: "토큰이 없거나 맞지 않습니다.",
        });
    }
    if method != "POST" {
        return Err(Rejection {
            status: 405,
            reason: "POST 만 받습니다.",
        });
    }
    if body_len > MAX_BODY_BYTES {
        return Err(Rejection {
            status: 413,
            reason: "요청이 너무 큽니다.",
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    fn headers(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn a_well_formed_request_passes() {
        let auth = format!("Bearer {TOKEN}");
        assert_eq!(
            check_request(
                "POST",
                "/mcp",
                &headers(&[("authorization", &auth)]),
                TOKEN,
                10
            ),
            Ok(())
        );
        assert_eq!(
            check_request(
                "POST",
                "/mcp",
                &headers(&[("Authorization", &auth), ("Origin", "null")]),
                TOKEN,
                10
            ),
            Ok(())
        );
    }

    #[test]
    fn missing_or_wrong_tokens_are_401() {
        assert_eq!(
            check_request("POST", "/mcp", &[], TOKEN, 10)
                .unwrap_err()
                .status,
            401
        );
        let wrong = headers(&[("Authorization", "Bearer nope")]);
        assert_eq!(
            check_request("POST", "/mcp", &wrong, TOKEN, 10)
                .unwrap_err()
                .status,
            401
        );
    }

    #[test]
    fn browser_origins_are_403_even_with_a_token() {
        let auth = format!("Bearer {TOKEN}");
        let h = headers(&[("Authorization", &auth), ("Origin", "https://evil.example")]);
        assert_eq!(
            check_request("POST", "/mcp", &h, TOKEN, 10)
                .unwrap_err()
                .status,
            403
        );
    }

    #[test]
    fn wrong_path_method_or_size_are_rejected() {
        let auth = format!("Bearer {TOKEN}");
        let h = headers(&[("Authorization", &auth)]);
        assert_eq!(
            check_request("POST", "/other", &h, TOKEN, 10)
                .unwrap_err()
                .status,
            404
        );
        assert_eq!(
            check_request("GET", "/mcp", &h, TOKEN, 0)
                .unwrap_err()
                .status,
            405
        );
        assert_eq!(
            check_request("POST", "/mcp", &h, TOKEN, MAX_BODY_BYTES + 1)
                .unwrap_err()
                .status,
            413
        );
    }
}
