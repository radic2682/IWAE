//! Zotero 보관함 읽기. Zotero 데이터 폴더(zotero.sqlite + storage/)를 **읽기만** 한다.
//!
//! Zotero 는 실행 중에 DB 를 잠가 두므로 DB 파일을 임시 폴더로 복사해서 그 사본을 연다.
//! 원본에는 어떤 쓰기도 하지 않는다. 읽어 온 것은 항목(서지 정보)·컬렉션 경로·PDF 첨부 파일 경로·
//! 형광펜/메모(Zotero 6·7 의 itemAnnotations)·자식 노트로, 화면이 Vault 로 옮겨 담는다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroAnnotation {
    /// highlight | underline | note | image | ink
    pub kind: String,
    pub text: Option<String>,
    pub comment: Option<String>,
    /// #rrggbb
    pub color: Option<String>,
    pub page_label: Option<String>,
    /// 0-기반 쪽
    pub page_index: Option<i64>,
    /// 쪽 좌표(PDF points, 왼쪽 아래 기준) [x1, y1, x2, y2]
    pub rects: Vec<[f64; 4]>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroAttachment {
    pub key: String,
    /// 파일이 실제로 있는 절대 경로(없으면 None)
    pub path: Option<String>,
    pub file_name: String,
    pub annotations: Vec<ZoteroAnnotation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroItem {
    pub key: String,
    pub item_type: String,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub year: Option<i64>,
    pub doi: Option<String>,
    pub journal: Option<String>,
    /// "부모/자식" 모양의 컬렉션 경로들
    pub collections: Vec<String>,
    pub attachments: Vec<ZoteroAttachment>,
    /// 항목에 붙은 노트(HTML 을 걷어 낸 글)
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroLibrary {
    pub data_dir: String,
    pub items: Vec<ZoteroItem>,
}

fn db_error(err: rusqlite::Error) -> String {
    tr!("Zotero 데이터를 읽지 못했습니다: {err}", "Could not read the Zotero data: {err}")
}

/// 데이터 폴더 또는 zotero.sqlite 파일을 가리키는 경로에서 (데이터 폴더, DB 파일)을 정한다.
fn locate(path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let dir = if path.is_dir() { path.to_path_buf() } else { path.parent().map(Path::to_path_buf).unwrap_or_default() };
    let db = if path.is_file() { path.to_path_buf() } else { dir.join("zotero.sqlite") };
    if !db.is_file() {
        return Err(tr!(
            "이 폴더에서 zotero.sqlite 를 찾지 못했습니다. Zotero 데이터 폴더(보통 내 폴더의 Zotero)를 골라 주세요.",
            "zotero.sqlite was not found in this folder. Pick the Zotero data folder (usually “Zotero” in your home folder)."
        ));
    }
    Ok((dir, db))
}

/// HTML 노트에서 태그를 걷어 내고 흔한 문자 참조를 푼다.
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("").to_ascii_lowercase();
                if matches!(name.as_str(), "p" | "br" | "div" | "li" | "h1" | "h2" | "h3" | "h4" | "tr") {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(ch),
            _ => out.push(ch),
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let mut lines: Vec<&str> = decoded.lines().map(str::trim).collect();
    while lines.first() == Some(&"") {
        lines.remove(0);
    }
    while lines.last() == Some(&"") {
        lines.pop();
    }
    lines.join("\n")
}

fn year_of(date: &str) -> Option<i64> {
    let digits: String = date.chars().skip_while(|c| !c.is_ascii_digit()).take(4).collect();
    if digits.len() == 4 { digits.parse().ok() } else { None }
}

fn has_table(conn: &Connection, name: &str) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1", [name], |_| Ok(())).is_ok()
}

/// 위치 JSON(`{"pageIndex":0,"rects":[[x1,y1,x2,y2],…]}`)에서 쪽과 사각형들.
pub fn parse_position(raw: &str) -> (Option<i64>, Vec<[f64; 4]>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return (None, Vec::new());
    };
    let page = value.get("pageIndex").and_then(serde_json::Value::as_i64);
    let rects = value
        .get("rects")
        .and_then(serde_json::Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|rect| {
                    let r = rect.as_array()?;
                    if r.len() < 4 {
                        return None;
                    }
                    Some([r[0].as_f64()?, r[1].as_f64()?, r[2].as_f64()?, r[3].as_f64()?])
                })
                .collect()
        })
        .unwrap_or_default();
    (page, rects)
}

fn annotation_kind(code: i64) -> &'static str {
    match code {
        1 => "highlight",
        2 => "note",
        3 => "image",
        4 => "ink",
        5 => "underline",
        _ => "other",
    }
}

/// 열린 연결에서 보관함을 읽는다(시험에서도 쓴다).
pub fn read_library(conn: &Connection, data_dir: &Path) -> Result<ZoteroLibrary, String> {
    // 항목: 첨부·노트·주석 자체와 휴지통 항목은 뺀다
    let mut item_rows = conn
        .prepare(
            "SELECT i.itemID, i.key, t.typeName FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID \
             WHERE t.typeName NOT IN ('attachment','note','annotation') \
             AND i.itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY i.itemID",
        )
        .map_err(db_error)?;
    let base: Vec<(i64, String, String)> = item_rows
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(db_error)?
        .filter_map(Result::ok)
        .collect();

    // 필드값
    let mut fields: HashMap<i64, HashMap<String, String>> = HashMap::new();
    let mut field_stmt = conn
        .prepare(
            "SELECT d.itemID, f.fieldName, v.value FROM itemData d JOIN fields f ON f.fieldID = d.fieldID \
             JOIN itemDataValues v ON v.valueID = d.valueID WHERE f.fieldName IN ('title','date','DOI','publicationTitle','journalAbbreviation','bookTitle')",
        )
        .map_err(db_error)?;
    for row in field_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
        .map_err(db_error)?
        .filter_map(Result::ok)
    {
        fields.entry(row.0).or_default().insert(row.1, row.2);
    }

    // 저자
    let mut creators: HashMap<i64, Vec<(String, String)>> = HashMap::new();
    let mut creator_stmt = conn
        .prepare(
            "SELECT ic.itemID, ct.creatorType, c.firstName, c.lastName, c.fieldMode FROM itemCreators ic \
             JOIN creators c ON c.creatorID = ic.creatorID JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID \
             ORDER BY ic.itemID, ic.orderIndex",
        )
        .map_err(db_error)?;
    for row in creator_stmt
        .query_map([], |row| {
            let first: Option<String> = row.get(2)?;
            let last: Option<String> = row.get(3)?;
            let mode: i64 = row.get(4)?;
            let name = if mode == 1 {
                last.unwrap_or_default()
            } else {
                format!("{} {}", first.unwrap_or_default(), last.unwrap_or_default()).trim().to_string()
            };
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, name))
        })
        .map_err(db_error)?
        .filter_map(Result::ok)
    {
        creators.entry(row.0).or_default().push((row.1, row.2));
    }

    // 컬렉션 경로
    let mut collection_rows: HashMap<i64, (String, Option<i64>)> = HashMap::new();
    let mut coll_stmt = conn
        .prepare("SELECT collectionID, collectionName, parentCollectionID FROM collections")
        .map_err(db_error)?;
    for row in coll_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<i64>>(2)?)))
        .map_err(db_error)?
        .filter_map(Result::ok)
    {
        collection_rows.insert(row.0, (row.1, row.2));
    }
    let path_of = |mut id: i64| -> String {
        let mut parts = Vec::new();
        let mut guard = 0;
        while let Some((name, parent)) = collection_rows.get(&id) {
            parts.push(name.clone());
            guard += 1;
            match parent {
                Some(p) if guard < 12 => id = *p,
                _ => break,
            }
        }
        parts.reverse();
        parts.join("/")
    };
    let mut item_collections: HashMap<i64, Vec<String>> = HashMap::new();
    let mut ci_stmt = conn.prepare("SELECT collectionID, itemID FROM collectionItems").map_err(db_error)?;
    for row in ci_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(db_error)?
        .filter_map(Result::ok)
    {
        item_collections.entry(row.1).or_default().push(path_of(row.0));
    }

    // 주석(Zotero 6 이상)
    let mut annotations: HashMap<i64, Vec<ZoteroAnnotation>> = HashMap::new();
    if has_table(conn, "itemAnnotations") {
        let mut stmt = conn
            .prepare("SELECT parentItemID, type, text, comment, color, pageLabel, position FROM itemAnnotations ORDER BY parentItemID, sortIndex")
            .map_err(db_error)?;
        for row in stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(db_error)?
            .filter_map(Result::ok)
        {
            let (page_index, rects) = parse_position(row.6.as_deref().unwrap_or(""));
            annotations.entry(row.0).or_default().push(ZoteroAnnotation {
                kind: annotation_kind(row.1).to_string(),
                text: row.2.filter(|t| !t.trim().is_empty()),
                comment: row.3.filter(|t| !t.trim().is_empty()),
                color: row.4,
                page_label: row.5,
                page_index,
                rects,
            });
        }
    }

    // 첨부 파일(PDF 만)
    let mut attachments: HashMap<i64, Vec<ZoteroAttachment>> = HashMap::new();
    let mut att_stmt = conn
        .prepare(
            "SELECT a.itemID, a.parentItemID, a.linkMode, a.path, i.key FROM itemAttachments a JOIN items i ON i.itemID = a.itemID \
             WHERE a.contentType = 'application/pdf' AND a.parentItemID IS NOT NULL AND a.itemID NOT IN (SELECT itemID FROM deletedItems)",
        )
        .map_err(db_error)?;
    for row in att_stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, String>(4)?))
        })
        .map_err(db_error)?
        .filter_map(Result::ok)
    {
        let (att_id, parent, link_mode, raw_path, key) = row;
        let raw_path = raw_path.unwrap_or_default();
        // linkMode 0·1: storage/<키>/<파일>, 2: 연결된 파일(절대 경로), 3: 웹 주소
        let resolved: Option<PathBuf> = match link_mode {
            0 | 1 => raw_path.strip_prefix("storage:").map(|name| data_dir.join("storage").join(&key).join(name)),
            2 => {
                let linked = PathBuf::from(&raw_path);
                linked.is_absolute().then_some(linked)
            }
            _ => None,
        };
        let existing = resolved.filter(|p| p.is_file());
        let file_name = existing
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw_path.trim_start_matches("storage:").to_string());
        attachments.entry(parent).or_default().push(ZoteroAttachment {
            key,
            path: existing.map(|p| p.to_string_lossy().into_owned()),
            file_name,
            annotations: annotations.remove(&att_id).unwrap_or_default(),
        });
    }

    // 항목 노트
    let mut notes: HashMap<i64, Vec<String>> = HashMap::new();
    if has_table(conn, "itemNotes") {
        let mut stmt = conn
            .prepare("SELECT parentItemID, note FROM itemNotes WHERE parentItemID IS NOT NULL AND itemID NOT IN (SELECT itemID FROM deletedItems)")
            .map_err(db_error)?;
        for row in stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)))
            .map_err(db_error)?
            .filter_map(Result::ok)
        {
            let text = strip_html(&row.1.unwrap_or_default());
            if !text.is_empty() {
                notes.entry(row.0).or_default().push(text);
            }
        }
    }

    let mut items = Vec::new();
    for (id, key, item_type) in base {
        let field = fields.get(&id);
        let get = |name: &str| field.and_then(|f| f.get(name)).cloned();
        let all = creators.get(&id).cloned().unwrap_or_default();
        let authors: Vec<String> = {
            let primary: Vec<String> = all.iter().filter(|(kind, _)| kind == "author").map(|(_, n)| n.clone()).collect();
            if primary.is_empty() { all.iter().map(|(_, n)| n.clone()).collect() } else { primary }
        };
        let mut collections = item_collections.remove(&id).unwrap_or_default();
        collections.sort();
        collections.dedup();
        let atts = attachments.remove(&id).unwrap_or_default();
        let item_notes = notes.remove(&id).unwrap_or_default();
        if atts.is_empty() && item_notes.is_empty() && get("title").is_none() {
            continue;
        }
        items.push(ZoteroItem {
            key,
            item_type,
            title: get("title"),
            authors,
            year: get("date").as_deref().and_then(year_of),
            doi: get("DOI"),
            journal: get("publicationTitle").or_else(|| get("journalAbbreviation")).or_else(|| get("bookTitle")),
            collections,
            attachments: atts,
            notes: item_notes,
        });
    }
    Ok(ZoteroLibrary { data_dir: data_dir.to_string_lossy().into_owned(), items })
}

/// Zotero 데이터 폴더(또는 zotero.sqlite)를 읽는다. DB 는 임시 사본으로만 연다.
#[tauri::command]
pub async fn zotero_read(path: String) -> Result<ZoteroLibrary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, db) = locate(Path::new(&path))?;
        let temp = std::env::temp_dir().join(format!("iwae-zotero-{}.sqlite", std::process::id()));
        std::fs::copy(&db, &temp).map_err(|err| tr!("Zotero DB 를 복사하지 못했습니다: {err}", "Could not copy the Zotero database: {err}"))?;
        let result = (|| {
            let conn = Connection::open_with_flags(&temp, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(db_error)?;
            read_library(&conn, &dir)
        })();
        let _ = std::fs::remove_file(&temp);
        result
    })
    .await
    .map_err(|err| tr!("Zotero 읽기가 중단되었습니다: {err}", "Reading Zotero was interrupted: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_html_notes() {
        assert_eq!(strip_html("<p>Hello &amp; <b>bye</b></p><p>second</p>"), "Hello & bye\n\nsecond");
    }

    #[test]
    fn parses_position_json() {
        let (page, rects) = parse_position(r#"{"pageIndex":2,"rects":[[1,2,3,4],[5,6,7,8]]}"#);
        assert_eq!(page, Some(2));
        assert_eq!(rects, vec![[1.0, 2.0, 3.0, 4.0], [5.0, 6.0, 7.0, 8.0]]);
    }

    #[test]
    fn reads_a_small_library() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itemTypes(itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
             INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment'),(3,'annotation'),(4,'note');
             CREATE TABLE items(itemID INTEGER PRIMARY KEY, itemTypeID INT, key TEXT);
             CREATE TABLE deletedItems(itemID INTEGER PRIMARY KEY);
             CREATE TABLE fields(fieldID INTEGER PRIMARY KEY, fieldName TEXT);
             INSERT INTO fields VALUES (1,'title'),(2,'date'),(3,'DOI'),(4,'publicationTitle');
             CREATE TABLE itemDataValues(valueID INTEGER PRIMARY KEY, value TEXT);
             CREATE TABLE itemData(itemID INT, fieldID INT, valueID INT);
             CREATE TABLE creatorTypes(creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
             INSERT INTO creatorTypes VALUES (1,'author'),(2,'editor');
             CREATE TABLE creators(creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
             CREATE TABLE itemCreators(itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
             CREATE TABLE collections(collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INT);
             CREATE TABLE collectionItems(collectionID INT, itemID INT);
             CREATE TABLE itemAttachments(itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
             CREATE TABLE itemAnnotations(itemID INTEGER PRIMARY KEY, parentItemID INT, type INT, text TEXT, comment TEXT, color TEXT, pageLabel TEXT, sortIndex TEXT, position TEXT);
             CREATE TABLE itemNotes(itemID INTEGER PRIMARY KEY, parentItemID INT, note TEXT, title TEXT);
             INSERT INTO items VALUES (10,1,'ITEM0001'),(11,2,'ATTACH01'),(12,3,'ANNOT001');
             INSERT INTO itemDataValues VALUES (1,'Attention Is All You Need'),(2,'2017-06-12'),(3,'10.1000/xyz'),(4,'NeurIPS'),(5,'Ada Lovelace');
             INSERT INTO itemData VALUES (10,1,1),(10,2,2),(10,3,3),(10,4,4);
             INSERT INTO creators VALUES (1,'Ada','Lovelace',0);
             INSERT INTO itemCreators VALUES (10,1,1,0);
             INSERT INTO collections VALUES (1,'ML',NULL),(2,'Papers',1);
             INSERT INTO collectionItems VALUES (2,10);
             INSERT INTO itemAttachments VALUES (11,10,0,'application/pdf','storage:paper.pdf');
             INSERT INTO itemAnnotations VALUES (12,11,1,'quoted text','my comment','#ffd400','3','00000|000100|00000','{\"pageIndex\":2,\"rects\":[[10,20,30,40]]}');",
        )
        .unwrap();
        let library = read_library(&conn, Path::new("Z:/nowhere")).unwrap();
        assert_eq!(library.items.len(), 1);
        let item = &library.items[0];
        assert_eq!(item.title.as_deref(), Some("Attention Is All You Need"));
        assert_eq!(item.year, Some(2017));
        assert_eq!(item.authors, vec!["Ada Lovelace".to_string()]);
        assert_eq!(item.collections, vec!["ML/Papers".to_string()]);
        assert_eq!(item.attachments.len(), 1);
        assert_eq!(item.attachments[0].annotations[0].page_index, Some(2));
        assert_eq!(item.attachments[0].annotations[0].comment.as_deref(), Some("my comment"));
    }
}
