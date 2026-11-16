//! 문서 형식 판단 한 곳. 프런트의 `src/core/documentFormat.ts` 와 확장자 목록이 같아야 한다.

use std::path::Path;

/// 확장자(소문자, 점 없이)로 문서 형식을 정한다: "pdf" · "markdown" · "text" · "html" · "xml".
/// 확장자가 없거나 모르는 것이면 None. `notes/cmd` 처럼 점 없이 md 로 끝나는 이름은 문서가 아니다.
pub fn document_format(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?;
    let (_, ext) = name.rsplit_once('.')?;
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => Some("pdf"),
        "md" | "markdown" => Some("markdown"),
        "txt" | "text" | "log" => Some("text"),
        "html" | "htm" | "xhtml" => Some("html"),
        "xml" => Some("xml"),
        _ => None,
    }
}

/// 흐르는 글(Markdown·텍스트·HTML·XML)로 여는 문서인가
pub fn is_flow_document(path: &Path) -> bool {
    matches!(document_format(path), Some(format) if format != "pdf")
}

/// IWAE 에서 열 수 있는 문서(PDF 포함)인가
pub fn is_openable_document(path: &Path) -> bool {
    document_format(path).is_some()
}

/// 색인 파일(.iwae/index.json)에 적는 종류('pdf' | 'markdown' | 'other')로 바꾼다. 문서가 아니면 None.
/// 텍스트·HTML·XML 은 예전 버전이 적던 대로 'other' 다(여러 기기·버전이 같은 Vault 를 연다. 새 값을 적지 않는다)
pub fn index_kind(path: &Path) -> Option<&'static str> {
    match document_format(path)? {
        "pdf" => Some("pdf"),
        "markdown" => Some("markdown"),
        _ => Some("other"),
    }
}

/// 색인 항목의 종류를 응답·검색 거르개에 쓰는 이름표로 바꾼다: 종류 'other' 인데 경로가 txt·html·xml 이면 "text".
/// 이것은 계산한 값일 뿐 색인 파일에 적지 않는다
pub fn derived_kind<'a>(stored_kind: &'a str, path: &Path) -> &'a str {
    if stored_kind == "other" && is_flow_document(path) {
        "text"
    } else {
        stored_kind
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn format(name: &str) -> Option<&'static str> {
        document_format(Path::new(name))
    }

    #[test]
    fn every_extension_maps_to_its_format() {
        for (name, expected) in [
            ("a.pdf", "pdf"),
            ("a.md", "markdown"),
            ("a.markdown", "markdown"),
            ("a.txt", "text"),
            ("a.text", "text"),
            ("a.log", "text"),
            ("a.html", "html"),
            ("a.htm", "html"),
            ("a.xhtml", "html"),
            ("a.xml", "xml"),
        ] {
            assert_eq!(format(name), Some(expected), "{name}");
        }
    }

    #[test]
    fn case_and_folders_do_not_matter() {
        assert_eq!(format("C:\\Docs\\A.PDF"), Some("pdf"));
        assert_eq!(format("x/y/Guide.Markdown"), Some("markdown"));
        assert_eq!(format("/home/u/Page.HTM"), Some("html"));
    }

    #[test]
    fn names_without_a_known_extension_are_not_documents() {
        for name in ["", "README", "notes/cmd", "readmemd", "a.mdx", "a.md.bak", "a.png", "a.", "v1.2/readme", "notes.md/readme"] {
            assert_eq!(format(name), None, "{name}");
        }
        assert_eq!(format("v1.2/readme.txt"), Some("text"));
    }

    #[test]
    fn dotfiles_use_the_part_after_the_dot_like_the_frontend() {
        assert_eq!(format(".md"), Some("markdown"));
        assert_eq!(format(".gitignore"), None);
    }

    #[test]
    fn flow_openable_and_index_kind() {
        assert!(is_flow_document(Path::new("a.xml")));
        assert!(is_flow_document(Path::new("a.md")));
        assert!(!is_flow_document(Path::new("a.pdf")));
        assert!(is_openable_document(Path::new("a.pdf")));
        assert!(!is_openable_document(Path::new("a.png")));
        assert_eq!(index_kind(Path::new("a.pdf")), Some("pdf"));
        assert_eq!(index_kind(Path::new("a.markdown")), Some("markdown"));
        assert_eq!(index_kind(Path::new("a.html")), Some("other"));
        assert_eq!(derived_kind("other", Path::new("a.html")), "text");
        assert_eq!(derived_kind("other", Path::new("a.png")), "other");
        assert_eq!(derived_kind("image", Path::new("a.xml")), "image");
        assert_eq!(derived_kind("markdown", Path::new("a.md")), "markdown");
        assert_eq!(index_kind(Path::new("a.zip")), None);
    }
}
