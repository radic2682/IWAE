//! AI 가 바로 읽을 수 있는 쪽 표시 Markdown.
//!
//! 바깥 AI(Claude Code 등)는 MCP 없이도 `.iwae/ai/*.md` 를 파일로 열어 볼 수 있다. 쪽마다
//! `<!-- page:N -->` 표시를 두어, 찾은 구절을 다시 "몇 쪽" 으로 가리킬 수 있게 한다.

pub struct AiDocMeta<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub kind: &'a str,
    pub source: &'a str,
    pub complete: bool,
}

/// YAML 큰따옴표 문자열. 제목에 콜론·따옴표가 있어도 front matter 가 깨지지 않는다.
fn yaml_string(value: &str) -> String {
    let escaped: String = value
        .chars()
        .flat_map(|c| match c {
            '\\' => vec!['\\', '\\'],
            '"' => vec!['\\', '"'],
            '\n' | '\r' => vec![' '],
            other => vec![other],
        })
        .collect();
    format!("\"{escaped}\"")
}

pub fn render_ai_markdown(meta: &AiDocMeta, pages: &[String]) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("title: {}\n", yaml_string(meta.title)));
    out.push_str(&format!("id: {}\n", yaml_string(meta.id)));
    out.push_str(&format!("kind: {}\n", meta.kind));
    out.push_str(&format!("source: {}\n", yaml_string(meta.source)));
    out.push_str(&format!("pages: {}\n", pages.len()));
    if !meta.complete {
        out.push_str("complete: false\n");
    }
    out.push_str("---\n");
    for (index, page) in pages.iter().enumerate() {
        out.push_str(&format!("\n<!-- page:{} -->\n", index + 1));
        out.push_str(page.replace("\r\n", "\n").trim_end());
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_front_matter_and_page_markers() {
        let meta = AiDocMeta {
            id: "abc",
            title: "Notes: \"Draft\"",
            kind: "pdf",
            source: "papers/notes.pdf",
            complete: false,
        };
        let out = render_ai_markdown(&meta, &["first\r\npage".into(), "second".into()]);
        assert_eq!(
            out,
            "---\ntitle: \"Notes: \\\"Draft\\\"\"\nid: \"abc\"\nkind: pdf\nsource: \"papers/notes.pdf\"\npages: 2\ncomplete: false\n---\n\n<!-- page:1 -->\nfirst\npage\n\n<!-- page:2 -->\nsecond\n"
        );
    }
}
