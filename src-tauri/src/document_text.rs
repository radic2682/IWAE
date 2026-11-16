//! 문서 파일의 바이트를 색인·검색에 쓸 글로 바꾼다.
//!
//! 프런트의 `src/core/textDecode.ts`(부호화 판별)와 맞춘다: UTF-8(BOM 은 뗀다)·UTF-16(BOM)·한글 CP949.
//! HTML·XML 은 태그를 걷어 낸 본문만 돌려준다(색인에 `<div class=...>` 같은 글자가 섞이지 않게).
//! 화면에 그리는 것이 아니라 검색용 글이라, 모양은 단락 단위 줄바꿈만 남기고 거칠게 정리한다.

/// 바이트를 글로 푼다. BOM 이 있으면 그 부호화, 없으면 엄격한 UTF-8, 그것이 안 되면 CP949(EUC-KR),
/// 그래도 깨지면 UTF-8 로 풀되 못 푼 글자는 대체 문자로 둔다. 맨 앞 BOM 은 어느 경우든 뗀다
pub fn decode_document_bytes(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return strip_bom(String::from_utf8_lossy(rest).into_owned());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return strip_bom(encoding_rs::UTF_16LE.decode_without_bom_handling(rest).0.into_owned());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return strip_bom(encoding_rs::UTF_16BE.decode_without_bom_handling(rest).0.into_owned());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return strip_bom(text.to_string());
    }
    // 한글 Windows 파일. 못 푼 글자가 있으면 UTF-8 결과를 쓴다(프런트와 같다)
    let (korean, had_errors) = {
        let (text, had_errors) = encoding_rs::EUC_KR.decode_without_bom_handling(bytes);
        (text.into_owned(), had_errors)
    };
    if !had_errors {
        return strip_bom(korean);
    }
    strip_bom(String::from_utf8_lossy(bytes).into_owned())
}

fn strip_bom(text: String) -> String {
    match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    }
}

/// 형식("markdown" · "text" · "html" · "xml")에 맞게 색인용 글을 만든다
pub fn text_for_search(format: &str, bytes: &[u8]) -> String {
    let text = decode_document_bytes(bytes);
    match format {
        "html" => html_to_text(&text),
        "xml" => xml_to_text(&text),
        _ => text,
    }
}

/// 줄을 나누는 HTML 태그(이 태그의 앞뒤에서 줄이 바뀐다)
fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div" | "br" | "hr" | "li" | "ul" | "ol" | "dl" | "dt" | "dd" | "tr" | "table" | "thead" | "tbody" | "tfoot"
            | "caption" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "pre" | "section" | "article" | "aside"
            | "header" | "footer" | "nav" | "main" | "figure" | "figcaption" | "form" | "fieldset" | "address" | "details"
            | "summary" | "title" | "body" | "head"
    )
}

/// 태그 하나의 읽은 결과
struct Tag {
    /// 소문자 이름(닫는 태그는 `/` 를 뗀 이름)
    name: String,
    closing: bool,
    /// `<script />` 처럼 스스로 닫는 태그인가(`/>` 로 끝난다)
    self_closing: bool,
    /// 속성 값들(따옴표 안팎). `xmlns` 로 시작하는 속성은 뺀다
    attribute_values: Vec<String>,
    /// 다음 글자 자리(`>` 바로 뒤)
    end: usize,
}

/// `<` 에서 시작하는 태그를 읽는다. 따옴표는 `=` 바로 뒤(사이에 공백이 있어도 된다)에서만 값을 여는 것이고,
/// 그 안의 `>` 는 태그 끝이 아니다. 닫는 따옴표가 없으면 따옴표 없는 값으로 보고 다음 `>` 까지를 값으로 한다
/// (그래야 깨진 태그 하나가 파일의 나머지를 삼키지 않는다). `>` 가 아예 없으면 None
fn read_tag(text: &str, start: usize) -> Option<Tag> {
    let bytes = text.as_bytes();
    let mut i = start + 1;
    let closing = bytes.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_start = i;
    while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' && bytes[i] != b'/' {
        i += 1;
    }
    let name = text[name_start..i].to_ascii_lowercase();
    let mut attribute_values = Vec::new();
    // 지금 읽는 속성의 이름(`xmlns` 선언을 거르려고 쓴다. ASCII 가 아닌 글자는 소문자로 바꾸지 않고 그대로 둔다)
    let mut attribute = String::new();
    // `=` 를 막 지났나(공백은 건너뛴다): 이때 오는 따옴표만 값을 연다
    let mut after_equals = false;
    // 이름이 끝났나(공백 뒤): 다음 이름 글자가 오면 새 속성이다
    let mut name_ended = false;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'>' {
            let self_closing = i > start + 1 && bytes[i - 1] == b'/';
            return Some(Tag { name, closing, self_closing, attribute_values, end: i + 1 });
        }
        if after_equals && !byte.is_ascii_whitespace() {
            after_equals = false;
            let keep = !attribute.starts_with("xmlns");
            if byte == b'"' || byte == b'\'' {
                let value_start = i + 1;
                if let Some(close) = text[value_start..].find(byte as char) {
                    if keep {
                        attribute_values.push(text[value_start..value_start + close].to_string());
                    }
                    i = value_start + close + 1;
                } else {
                    // 닫는 따옴표가 없다: 따옴표 없는 값으로 보고 다음 `>` 까지를 값으로 한다
                    let gt = text[value_start..].find('>')? + value_start;
                    if keep {
                        attribute_values.push(text[value_start..gt].to_string());
                    }
                    i = gt;
                }
            } else {
                // 따옴표 없는 값: 공백이나 `>` 까지
                let value_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                    i += 1;
                }
                if keep {
                    attribute_values.push(text[value_start..i].trim_end_matches('/').to_string());
                }
            }
            attribute.clear();
            name_ended = false;
            continue;
        }
        if byte == b'=' {
            after_equals = true;
            i += 1;
        } else if byte.is_ascii_whitespace() {
            // 이름 뒤 공백: 곧 `=` 가 올 수도 있으니 이름은 남겨 두고, 다음 이름 글자가 오면 새 속성으로 본다
            if !attribute.is_empty() {
                name_ended = true;
            }
            i += 1;
        } else if byte == b'/' {
            i += 1;
        } else {
            // 속성 이름 한 글자(UTF-8 다중 바이트 글자는 통째로 지나간다)
            if name_ended {
                attribute.clear();
                name_ended = false;
            }
            let ch_len = text[i..].chars().next().map_or(1, char::len_utf8);
            attribute.push_str(&text[i..i + ch_len].to_ascii_lowercase());
            i += ch_len;
        }
    }
    None
}

/// 이름 있는 글자 참조 가운데 문서에 자주 나오는 것만 푼다(모르는 이름은 그대로 둔다)
fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "copy" => "\u{a9}",
        "reg" => "\u{ae}",
        "hellip" => "\u{2026}",
        "mdash" => "\u{2014}",
        "ndash" => "\u{2013}",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "ldquo" => "\u{201c}",
        "rdquo" => "\u{201d}",
        "middot" => "\u{b7}",
        "bull" => "\u{2022}",
        "times" => "\u{d7}",
        "laquo" => "\u{ab}",
        "raquo" => "\u{bb}",
        _ => return None,
    })
}

/// 글자 참조(`&amp;` · `&#44032;` · `&#xAC00;`)를 푼다. 풀 수 없는 것은 `&` 를 포함해 그대로 둔다.
/// `named` 가 false 면(XML) 이름 있는 참조는 미리 정해진 다섯 개(amp lt gt quot apos)만 푼다
fn decode_entities(text: &str, named: bool) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        // 참조 길이는 짧다: 세미콜론이 12 글자 안에 없으면 참조가 아니다
        let decoded = after
            .char_indices()
            .take(12)
            .find(|&(_, c)| c == ';')
            .and_then(|(semi, _)| {
                let body = &after[..semi];
                let value = if let Some(num) = body.strip_prefix('#') {
                    let code = match num.strip_prefix(['x', 'X']) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                        None => num.parse::<u32>().ok()?,
                    };
                    char::from_u32(code).filter(|c| *c != '\0')?.to_string()
                } else if named || matches!(body, "amp" | "lt" | "gt" | "quot" | "apos") {
                    named_entity(body)?.to_string()
                } else {
                    return None;
                };
                Some((value, semi + 1))
            });
        match decoded {
            Some((value, consumed)) => {
                out.push_str(&value);
                rest = &after[consumed..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// 대소문자를 가리지 않고 `needle`(소문자 ASCII)이 처음 나오는 자리
fn find_ignore_case(haystack: &str, from: usize, needle: &str) -> Option<usize> {
    let bytes = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || bytes.len() < n.len() || from > bytes.len() - n.len() {
        return None;
    }
    (from..=bytes.len() - n.len()).find(|&i| bytes[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// 줄 안의 공백 덩어리를 한 칸으로 줄이고, 빈 줄을 없애 글이 있는 줄만 한 줄 바꿈으로 잇는다
/// (색인은 어차피 공백을 합쳐서 자르므로 단락 구분은 남기지 않는다)
fn tidy_lines(raw: &str) -> String {
    raw.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// HTML 에서 읽을 수 있는 글만 남긴다. `<script>` · `<style>` 속 내용과 주석 · 선언은 버리고,
/// 줄을 나누는 태그는 줄바꿈으로 바꾸며, 글자 참조를 푼다
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = 0;
    while i < html.len() {
        let Some(lt) = html[i..].find('<') else {
            out.push_str(&decode_entities(&html[i..], true));
            break;
        };
        out.push_str(&decode_entities(&html[i..i + lt], true));
        let at = i + lt;
        let rest = &html[at..];
        if rest.starts_with("<!--") {
            // 주석: `-->` 까지(없으면 나머지 전부)
            i = html[at + 4..].find("-->").map_or(html.len(), |end| at + 4 + end + 3);
            continue;
        }
        if rest.starts_with("<![CDATA[") {
            let end = html[at + 9..].find("]]>");
            let (body_end, next) = end.map_or((html.len(), html.len()), |end| (at + 9 + end, at + 9 + end + 3));
            out.push_str(&html[at + 9..body_end]);
            i = next;
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            // 선언 · 처리 명령: `>` 까지
            i = rest.find('>').map_or(html.len(), |end| at + end + 1);
            continue;
        }
        // 태그처럼 보이지 않는 `<`(예: "a < b")는 글자 그대로 둔다
        let next_char = rest[1..].chars().next();
        if !matches!(next_char, Some(c) if c.is_ascii_alphabetic() || c == '/') {
            out.push('<');
            i = at + 1;
            continue;
        }
        let Some(tag) = read_tag(html, at) else {
            // 닫히지 않은 태그: 나머지는 태그의 일부로 보고 버린다
            break;
        };
        if !tag.closing && !tag.self_closing && (tag.name == "script" || tag.name == "style") {
            // 닫는 태그까지의 내용은 글이 아니다
            let close = format!("</{}", tag.name);
            i = find_ignore_case(html, tag.end, &close)
                .and_then(|from| html[from..].find('>').map(|end| from + end + 1))
                .unwrap_or(html.len());
            continue;
        }
        if is_block_tag(&tag.name) {
            out.push('\n');
        } else if tag.name == "td" || tag.name == "th" {
            out.push(' ');
        }
        i = tag.end;
    }
    tidy_lines(&out)
}

/// XML 에서 글만 남긴다: 요소 속 글과 CDATA, 그리고 속성 값(`xmlns` 선언은 뺀다)을 줄로 이어 붙인다.
/// 주석 · 처리 명령 · DOCTYPE 은 버린다. XML 이 깨져 있어도 읽을 수 있는 만큼 돌려준다
pub fn xml_to_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 2);
    let mut i = 0;
    while i < xml.len() {
        let Some(lt) = xml[i..].find('<') else {
            out.push_str(&decode_entities(&xml[i..], false));
            break;
        };
        out.push_str(&decode_entities(&xml[i..i + lt], false));
        let at = i + lt;
        let rest = &xml[at..];
        if rest.starts_with("<!--") {
            i = xml[at + 4..].find("-->").map_or(xml.len(), |end| at + 4 + end + 3);
            out.push('\n');
            continue;
        }
        if rest.starts_with("<![CDATA[") {
            let end = xml[at + 9..].find("]]>");
            let (body_end, next) = end.map_or((xml.len(), xml.len()), |end| (at + 9 + end, at + 9 + end + 3));
            out.push_str(&xml[at + 9..body_end]);
            i = next;
            continue;
        }
        if rest.starts_with("<?") {
            i = rest.find("?>").map_or(xml.len(), |end| at + end + 2);
            out.push('\n');
            continue;
        }
        if rest.starts_with("<!") {
            // DOCTYPE: 안쪽 `[ ... ]` 선언부가 있으면 `]>` 까지, 없으면 `>` 까지
            // `[` 는 이 선언의 `>` 앞에서만 찾는다(선언이 많은 파일에서 끝까지 되풀이해 훑지 않게)
            let gt = rest.find('>');
            let has_subset = gt.is_some_and(|g| rest[..g].contains('['));
            i = match gt {
                Some(_) if has_subset => rest.find("]>").map_or(xml.len(), |end| at + end + 2),
                Some(g) => at + g + 1,
                None => xml.len(),
            };
            out.push('\n');
            continue;
        }
        let next_char = rest[1..].chars().next();
        if !matches!(next_char, Some(c) if c.is_alphabetic() || c == '_' || c == ':' || c == '/') {
            out.push('<');
            i = at + 1;
            continue;
        }
        let Some(tag) = read_tag(xml, at) else {
            break;
        };
        out.push('\n');
        if !tag.closing {
            for value in &tag.attribute_values {
                let value = decode_entities(value, false);
                if !value.trim().is_empty() {
                    out.push_str(&value);
                    out.push('\n');
                }
            }
        }
        i = tag.end;
    }
    tidy_lines(&out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_utf16_and_cp949() {
        assert_eq!(decode_document_bytes("한글".as_bytes()), "한글");
        assert_eq!(decode_document_bytes(&[0xef, 0xbb, 0xbf, b'a']), "a");
        // UTF-16 LE / BE BOM
        assert_eq!(decode_document_bytes(&[0xff, 0xfe, 0x00, 0xac, b'a', 0x00]), "가a");
        assert_eq!(decode_document_bytes(&[0xfe, 0xff, 0xac, 0x00, 0x00, b'a']), "가a");
        // "한글" 의 CP949 바이트
        assert_eq!(decode_document_bytes(&[0xc7, 0xd1, 0xb1, 0xdb]), "한글");
    }

    #[test]
    fn html_drops_scripts_styles_comments_and_tags() {
        let html = r#"<!DOCTYPE html><html><head><title>제목</title><style>p { color: red }</style>
<script>if (a < b) { document.write("<b>x</b>") }</script></head>
<body><!-- 숨김 --><h1>머리</h1><p class="a>b">첫 <b>문단</b>입니다.</p><p>둘째 &amp; &lt;끝&gt; &#44032; &#xAC01; &nbsp;끝</p>
<SCRIPT type="x">alert(1)</SCRIPT><ul><li>하나</li><li>둘</li></ul></body></html>"#;
        let text = html_to_text(html);
        assert_eq!(text, "제목\n머리\n첫 문단입니다.\n둘째 & <끝> 가 각 끝\n하나\n둘");
        assert!(!text.contains("color"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("숨김"));
        assert!(!text.contains("document.write"));
    }

    #[test]
    fn html_keeps_a_lone_less_than_and_unknown_entities() {
        assert_eq!(html_to_text("a < b &unknown; &amp"), "a < b &unknown; &amp");
    }

    #[test]
    fn html_survives_unclosed_tags_and_scripts() {
        assert_eq!(html_to_text("앞<p>글<script>끝없음"), "앞\n글");
        assert_eq!(html_to_text("<p>글<div class=\"x"), "글");
        assert_eq!(html_to_text(""), "");
    }

    #[test]
    fn xml_keeps_element_text_cdata_and_attribute_values() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note [<!ENTITY x "y">]>
<!-- 주석 -->
<note xmlns="http://example.com/ns" id="n1"><to>철수</to><body><![CDATA[a < b & c]]></body><x v='&lt;7&gt;'/></note>"#;
        let text = xml_to_text(xml);
        assert_eq!(text, "n1\n철수\na < b & c\n<7>");
        assert!(!text.contains("example.com"));
        assert!(!text.contains("ENTITY"));
        assert!(!text.contains("주석"));
    }

    #[test]
    fn xml_only_decodes_the_five_predefined_entities() {
        assert_eq!(xml_to_text("<a>&copy; &amp; &#65;</a>"), "&copy; & A");
    }

    #[test]
    fn text_for_search_routes_by_format() {
        assert_eq!(text_for_search("text", "<b>그대로</b>".as_bytes()), "<b>그대로</b>");
        assert_eq!(text_for_search("markdown", "# 제목".as_bytes()), "# 제목");
        assert_eq!(text_for_search("html", "<b>본문</b>".as_bytes()), "본문");
        assert_eq!(text_for_search("xml", "<a>본문</a>".as_bytes()), "본문");
        // CP949 HTML
        let (bytes, _, _) = encoding_rs::EUC_KR.encode("<p>한글 문서</p>");
        assert_eq!(text_for_search("html", &bytes), "한글 문서");
    }

    #[test]
    fn a_self_closing_script_or_style_does_not_swallow_the_rest() {
        assert_eq!(html_to_text(r#"<p>앞</p><script src="a.js" /><p>뒤</p>"#), "앞\n뒤");
        assert_eq!(html_to_text("<style/><p>본문</p><script/>끝"), "본문\n끝");
        // 짝이 있는 script 는 여전히 통째로 건너뛴다
        assert_eq!(html_to_text("<script>var a=1;</script>글"), "글");
    }

    #[test]
    fn quotes_only_open_a_value_after_an_equals_sign() {
        // 따옴표가 값 자리가 아니면 태그 끝(>)을 가리지 못한다
        assert_eq!(html_to_text(r#"<p it's>글</p>"#), "글");
        assert_eq!(html_to_text(r#"<a title = "x > y" href='z'>링크</a>"#), "링크");
        assert_eq!(xml_to_text(r#"<a b = "값 하나"  c='둘'/>"#), "값 하나\n둘");
        assert_eq!(xml_to_text(r#"<a xmlns = "urn:x" d=e>글</a>"#), "e\n글");
    }

    #[test]
    fn an_unclosed_quote_does_not_drop_the_rest_of_the_file() {
        assert_eq!(html_to_text(r#"<p class="x>첫째</p><p>둘째</p>"#), "첫째\n둘째");
        assert_eq!(xml_to_text(r#"<a v="깨짐><b>살아남음</b></a>"#), "깨짐\n살아남음");
        // 닫는 `>` 가 아예 없으면 거기서 끝난다
        assert_eq!(html_to_text(r#"앞<p class="x"#), "앞");
    }

    #[test]
    fn non_ascii_attribute_names_and_values_are_handled() {
        assert_eq!(xml_to_text(r#"<항목 이름="철수" 나이='열'>본문</항목>"#), "철수\n열\n본문");
        assert_eq!(html_to_text(r#"<p 데이터-값="가나">글</p>"#), "글");
        // 이름 속 한글이 xmlns 거르기를 깨지 않는다
        assert_eq!(xml_to_text(r#"<a 가="1" xmlns:ns="urn:x">t</a>"#), "1\nt");
    }

    #[test]
    fn a_flood_of_declarations_stays_linear() {
        let started = std::time::Instant::now();
        let html = "<!x>".repeat(200_000) + "끝";
        assert_eq!(html_to_text(&html), "끝");
        // XML: `[` 가 없는 선언, 그리고 `[` 가 나중에 한 번 있는 파일 모두 선언마다 끝까지 훑지 않는다
        let xml = "<!x>".repeat(200_000) + "<a>끝</a><!y[z]>";
        assert_eq!(xml_to_text(&xml), "끝");
        let bracket = "<!x>".repeat(200_000) + "[";
        assert_eq!(xml_to_text(&bracket), "[");
        assert!(started.elapsed() < std::time::Duration::from_secs(1), "{:?}", started.elapsed());
    }
}
