//! GitHub 문서 폴더 가져오기. PC 에 깔린 git 을 부른다(공개 저장소만 — 로그인 창을 띄우지 않는다).
//!
//! git 작업 폴더는 `<Vault>/.iwae/github/<이름>/` 에 숨겨 두고, 받은 폴더(주소에 폴더가 있으면 그 폴더만 —
//! sparse checkout + blob:none)의 파일만 사용자가 고른 Vault 폴더로 복사한다. 어느 Vault 폴더와 이어졌는지는
//! `.iwae/github-links.json` 에 적고, 그 폴더를 옮기면 `github_move_target` 으로 따라간다.
//! 예전 방식(`<Vault>/GitHub/<저장소>/` 가 곧 git 작업 폴더)도 그대로 읽는다.
//! 앱이 쓰는 git 명령은 clone / fetch / merge --ff-only / checkout / log·rev-list·diff(읽기) 뿐이다.
//! 사용자가 고친 파일이 있어 덮을 수 없으면 git 이 멈추고, 그 메시지를 그대로 돌려준다(강제로 덮지 않는다).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 예전 방식: Vault 안에서 GitHub 문서를 두던 폴더 이름(그 아래가 곧 git 작업 폴더)
pub const GITHUB_DIR: &str = "GitHub";
/// 숨긴 git 작업 폴더들
const HIDDEN_DIR: &str = ".iwae/github";
const LINKS_FILE: &str = ".iwae/github-links.json";

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq, Eq)]
struct GithubLink {
    /// 숨긴 작업 폴더 이름
    name: String,
    /// 이어진 Vault 폴더(Vault 기준 경로, `/` 구분)
    target: String,
}

#[derive(Debug, Default, serde::Deserialize, Serialize)]
struct LinksFile {
    #[serde(default)]
    links: Vec<GithubLink>,
}

fn read_links(vault_root: &str) -> Vec<GithubLink> {
    std::fs::read_to_string(Path::new(vault_root).join(LINKS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<LinksFile>(&text).ok())
        .map(|file| file.links)
        .unwrap_or_default()
}

fn write_links(vault_root: &str, links: &[GithubLink]) -> Result<(), String> {
    let path = Path::new(vault_root).join(LINKS_FILE);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&LinksFile { links: links.to_vec() }).map_err(|err| err.to_string())?;
    std::fs::write(path, text).map_err(|err| tr!("연결 정보를 쓰지 못했습니다: {err}", "Could not save the link info: {err}"))
}

/// Vault 기준 경로가 안전한가(빈 칸·.. 금지, .iwae 금지)
fn safe_vault_path(path: &str) -> bool {
    !path.split('/').any(|part| part.is_empty() || part == "." || part == "..") && !path.starts_with(".iwae")
}

/// 받은 폴더(저장소 안 경로) 아래의 파일을 이어진 Vault 폴더로 복사한다(.git 은 빼고). 복사한 파일 수
fn copy_tree(from: &Path, to: &Path) -> Result<usize, String> {
    std::fs::create_dir_all(to).map_err(|err| tr!("폴더를 만들지 못했습니다: {err}", "Could not create the folder: {err}"))?;
    let mut count = 0;
    for entry in std::fs::read_dir(from).map_err(|err| err.to_string())?.flatten() {
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let path = entry.path();
        let target = to.join(&name);
        if path.is_dir() {
            count += copy_tree(&path, &target)?;
        } else {
            std::fs::copy(&path, &target).map_err(|err| tr!("{} 을 복사하지 못했습니다: {err}", "Could not copy {}: {err}", name.to_string_lossy()))?;
            count += 1;
        }
    }
    Ok(count)
}

/// 한 연결의 자리들: 숨긴 작업 폴더, 받은 폴더(작업 폴더 안), 이어진 Vault 폴더. 예전 방식이면 셋이 같은 곳
struct Place {
    clone: PathBuf,
    target: String,
    in_place: bool,
}

impl Place {
    fn source_root(&self, path: Option<&str>) -> PathBuf {
        match path {
            Some(path) if !self.in_place => self.clone.join(path),
            _ => self.clone.clone(),
        }
    }
}

/// 이름으로 연결을 찾는다(숨긴 것 먼저, 없으면 예전 방식 GitHub/<name>)
fn place_of(vault_root: &str, name: &str) -> Result<Place, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(tr!("저장소 폴더 이름이 올바르지 않습니다.", "Invalid repository folder name."));
    }
    if let Some(link) = read_links(vault_root).into_iter().find(|link| link.name == name) {
        let clone = Path::new(vault_root).join(HIDDEN_DIR).join(name);
        if clone.join(".git").exists() {
            return Ok(Place { clone, target: link.target, in_place: false });
        }
    }
    let legacy = Path::new(vault_root).join(GITHUB_DIR).join(name);
    if legacy.join(".git").exists() {
        return Ok(Place { clone: legacy, target: format!("{GITHUB_DIR}/{name}"), in_place: true });
    }
    Err(tr!("GitHub 에서 가져온 폴더가 아닙니다.", "This folder was not imported from GitHub."))
}

/// git diff 의 바뀐 파일을 이어진 Vault 폴더에 반영한다(더하고·고치고·지우기). 반영한 Vault 경로 목록
fn apply_changes(vault_root: &str, place: &Place, path: Option<&str>, from: &str, to: &str) -> Vec<String> {
    if place.in_place {
        return changed_files(&place.clone, from, to, path, &place.target);
    }
    let mut args = vec!["diff", "--name-status", "--no-renames", from, to];
    if let Some(path) = path {
        args.push("--");
        args.push(path);
    }
    let Ok(text) = git(Some(&place.clone), &args) else { return Vec::new() };
    let prefix = path.map(|value| format!("{}/", value.trim_end_matches('/'))).unwrap_or_default();
    let target_root = Path::new(vault_root).join(&place.target);
    let mut changed = Vec::new();
    for line in text.lines() {
        let mut fields = line.splitn(2, '\t');
        let (Some(status), Some(file)) = (fields.next(), fields.next()) else { continue };
        let Some(relative) = file.strip_prefix(prefix.as_str()) else { continue };
        let target = target_root.join(relative);
        if status.starts_with('D') {
            let _ = std::fs::remove_file(&target);
        } else {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(place.clone.join(file), &target);
        }
        changed.push(format!("{}/{}", place.target, relative));
    }
    changed
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubUrl {
    pub owner: String,
    pub repo: String,
    /// 주소에 적힌 브랜치·태그. 없으면 저장소 기본 브랜치
    pub reference: Option<String>,
    /// 받을 폴더(저장소 안 경로). 없으면 저장소 전체
    pub path: Option<String>,
}

/// `https://github.com/<owner>/<repo>[.git][/tree/<ref>/<path>]` 를 읽는다
pub fn parse_github_url(url: &str) -> Result<GithubUrl, String> {
    let trimmed = url.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))
        .ok_or_else(|| tr!("github.com 주소를 넣어 주세요 (예: https://github.com/<소유자>/<저장소>/tree/main/docs)", "Enter a github.com URL (e.g. https://github.com/<owner>/<repo>/tree/main/docs)"))?;
    let parts: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Err(tr!("주소에 저장소 이름이 없습니다.", "The URL has no repository name."));
    }
    let valid = |value: &str| !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && value != "." && value != "..";
    let owner = parts[0].to_string();
    let repo = parts[1].trim_end_matches(".git").to_string();
    if !valid(&owner) || !valid(&repo) {
        return Err(tr!("저장소 이름이 올바르지 않습니다.", "Invalid repository name."));
    }
    let (reference, path) = match parts.get(2) {
        Some(&"tree") | Some(&"blob") => {
            let reference = parts.get(3).map(|value| value.to_string());
            let path = if parts.len() > 4 { Some(parts[4..].join("/")) } else { None };
            (reference, path)
        }
        None => (None, None),
        Some(_) => return Err(tr!("저장소 주소 또는 .../tree/<브랜치>/<폴더> 주소를 넣어 주세요.", "Enter a repository URL or a .../tree/<branch>/<folder> URL.")),
    };
    if let Some(path) = &path {
        if path.split('/').any(|part| part == ".." || part == ".") {
            return Err(tr!("폴더 경로가 올바르지 않습니다.", "Invalid folder path."));
        }
    }
    if let Some(reference) = &reference {
        if reference.starts_with('-') || reference.contains("..") {
            return Err(tr!("브랜치 이름이 올바르지 않습니다.", "Invalid branch name."));
        }
    }
    Ok(GithubUrl { owner, repo, reference, path })
}

fn git(dir: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command
        .args(args)
        // 로그인 창·질문을 띄우지 않는다(공개 저장소만). 글은 영어로 받아 판단한다
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            tr!("이 PC 에 git 이 없습니다. Git for Windows 를 설치해 주세요.", "git is not installed on this PC. Please install Git for Windows.")
        } else {
            tr!("git 을 실행하지 못했습니다: {err}", "Could not run git: {err}")
        }
    })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr.lines().filter(|line| !line.trim().is_empty()).last().unwrap_or("").trim().to_string();
    if message.contains("could not read Username") || message.contains("Authentication failed") || message.contains("Repository not found") {
        return Err(tr!("저장소를 찾지 못했습니다. 공개 저장소 주소인지 확인해 주세요.", "Repository not found. Check that it is a public repository URL."));
    }
    if message.contains("Could not resolve host") || message.contains("unable to access") {
        return Err(tr!("GitHub 에 연결하지 못했습니다(네트워크·프록시 확인): {message}", "Could not connect to GitHub (check network/proxy): {message}"));
    }
    Err(if message.is_empty() { tr!("git {} 이 실패했습니다.", "git {} failed.", args.first().unwrap_or(&"")) } else { message })
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSource {
    /// 연결 이름(숨긴 작업 폴더 이름)
    pub name: String,
    /// 이어진 Vault 폴더(Vault 기준 경로)
    pub target: String,
    pub url: String,
    /// 받은 폴더(저장소 안 경로). 없으면 저장소 전체
    pub path: Option<String>,
    /// 지금 보고 있는 브랜치. 태그·커밋을 보는 중이면 None
    pub branch: Option<String>,
    /// 태그·커밋을 보는 중이면 그 이름(태그가 있으면 태그, 없으면 짧은 커밋)
    pub detached: Option<String>,
    pub head: String,
    pub head_date: String,
    pub head_subject: String,
    /// 마지막 「새 소식 확인」 이후 원격에 쌓인 커밋 수(받은 폴더에 닿는 것만). 브랜치를 볼 때만
    pub behind: u32,
}

fn sparse_path(dir: &Path) -> Option<String> {
    let list = git(Some(dir), &["sparse-checkout", "list"]).ok()?;
    let first = list.lines().next()?.trim().trim_matches('/').to_string();
    if first.is_empty() { None } else { Some(first) }
}

fn read_source(dir: &Path, target: &str) -> Result<GithubSource, String> {
    let name = dir.file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default();
    let target = target.to_string();
    let url = git(Some(dir), &["remote", "get-url", "origin"]).unwrap_or_default();
    let path = sparse_path(dir);
    let branch = git(Some(dir), &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok().filter(|value| !value.is_empty());
    let info = git(Some(dir), &["log", "-1", "--format=%h%x1f%cs%x1f%s"])?;
    let mut fields = info.split('\u{1f}');
    let head = fields.next().unwrap_or_default().to_string();
    let head_date = fields.next().unwrap_or_default().to_string();
    let head_subject = fields.next().unwrap_or_default().to_string();
    let detached = if branch.is_some() {
        None
    } else {
        Some(git(Some(dir), &["describe", "--tags", "--exact-match", "HEAD"]).unwrap_or_else(|_| head.clone()))
    };
    let behind = if branch.is_some() {
        let mut args = vec!["rev-list", "--count", "HEAD..@{u}"];
        if let Some(path) = &path {
            args.push("--");
            args.push(path.as_str());
        }
        git(Some(dir), &args).ok().and_then(|value| value.trim().parse().ok()).unwrap_or(0)
    } else {
        0
    };
    Ok(GithubSource { name, target, url, path, branch, detached, head, head_date, head_subject, behind })
}

/// 가져온 저장소들(네트워크 없이 지금 상태만): 숨긴 연결 + 예전 방식 GitHub/<저장소>
#[tauri::command]
pub async fn github_list(vault_root: String) -> Result<Vec<GithubSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut sources = Vec::new();
        for link in read_links(&vault_root) {
            let clone = Path::new(&vault_root).join(HIDDEN_DIR).join(&link.name);
            if clone.join(".git").exists() {
                if let Ok(source) = read_source(&clone, &link.target) {
                    sources.push(source);
                }
            }
        }
        if let Ok(entries) = std::fs::read_dir(Path::new(&vault_root).join(GITHUB_DIR)) {
            for entry in entries.flatten() {
                let dir = entry.path();
                if dir.join(".git").exists() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if let Ok(source) = read_source(&dir, &format!("{GITHUB_DIR}/{name}")) {
                        sources.push(source);
                    }
                }
            }
        }
        sources.sort_by(|left, right| left.target.cmp(&right.target));
        Ok(sources)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// 이어진 Vault 폴더를 옮겼다(이름 바꾸기·끌어 옮기기): 그 폴더(또는 그 안)와 이어진 연결을 따라 옮긴다
#[tauri::command]
pub fn github_move_target(vault_root: String, from: String, to: String) -> Result<(), String> {
    let mut links = read_links(&vault_root);
    let mut changed = false;
    for link in &mut links {
        if link.target == from {
            link.target = to.clone();
            changed = true;
        } else if let Some(rest) = link.target.strip_prefix(&format!("{from}/")) {
            link.target = format!("{to}/{rest}");
            changed = true;
        }
    }
    if changed { write_links(&vault_root, &links) } else { Ok(()) }
}

/// 주소의 저장소(또는 그 안 폴더)를 받아, 그 파일을 Vault 의 `target` 폴더(Vault 기준 경로)에 넣는다.
/// git 작업 폴더는 `.iwae/github/<저장소>` 에 숨긴다
#[tauri::command]
pub async fn github_clone(vault_root: String, url: String, target: String) -> Result<GithubSource, String> {
    let parsed = parse_github_url(&url)?;
    let target = target.trim().trim_matches('/').replace('\\', "/");
    if !safe_vault_path(&target) {
        return Err(tr!("넣을 폴더 경로가 올바르지 않습니다.", "Invalid destination folder path."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let target_dir = Path::new(&vault_root).join(&target);
        if target_dir.exists() && std::fs::read_dir(&target_dir).map(|mut entries| entries.next().is_some()).unwrap_or(true) {
            return Err(tr!("Vault 에 이미 「{target}」 폴더가 있습니다. 다른 이름을 고르세요.", "The vault already has a folder named \"{target}\". Choose another name."));
        }
        let base = Path::new(&vault_root).join(HIDDEN_DIR);
        std::fs::create_dir_all(&base).map_err(|err| tr!("작업 폴더를 만들지 못했습니다: {err}", "Could not create the working folder: {err}"))?;
        // 같은 저장소를 여러 번 받을 수 있게 이름 뒤에 번호
        let mut name = parsed.repo.clone();
        let mut counter = 2;
        while base.join(&name).exists() {
            name = format!("{}-{counter}", parsed.repo);
            counter += 1;
        }
        let dir = base.join(&name);
        let remote = format!("https://github.com/{}/{}.git", parsed.owner, parsed.repo);
        let clone_target = dir.to_string_lossy().into_owned();
        let mut args = vec!["clone", "--filter=blob:none", "--no-checkout"];
        if parsed.path.is_some() {
            args.push("--sparse");
        }
        if let Some(reference) = &parsed.reference {
            args.push("--branch");
            args.push(reference.as_str());
        }
        args.push("--");
        args.push(remote.as_str());
        args.push(clone_target.as_str());
        let result = (|| {
            git(None, &args)?;
            if let Some(path) = &parsed.path {
                // 그 폴더만(맨 위 파일도 받지 않는다)
                let pattern = format!("/{path}/");
                git(Some(&dir), &["sparse-checkout", "set", "--no-cone", pattern.as_str()])?;
            }
            git(Some(&dir), &["checkout"])?;
            let from = match &parsed.path { Some(path) => dir.join(path), None => dir.clone() };
            copy_tree(&from, &target_dir)?;
            let mut links = read_links(&vault_root);
            links.push(GithubLink { name: name.clone(), target: target.clone() });
            write_links(&vault_root, &links)?;
            read_source(&dir, &target)
        })();
        if result.is_err() {
            // 받다 만 작업 폴더는 지운다(다음에 다시 받을 수 있게). 이어진 폴더는 비어 있었으므로 지운다
            let _ = std::fs::remove_dir_all(&dir);
            if std::fs::read_dir(&target_dir).map(|mut entries| entries.next().is_none()).unwrap_or(false) {
                let _ = std::fs::remove_dir(&target_dir);
            }
        }
        result
    })
    .await
    .map_err(|err| err.to_string())?
}

/// 「새 소식 확인」: 받기만 하고 파일은 바꾸지 않는다. 바뀔 파일 목록도 함께 준다
#[tauri::command]
pub async fn github_fetch(vault_root: String, name: String) -> Result<GithubFetchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let place = place_of(&vault_root, &name)?;
        let dir = place.clone.clone();
        git(Some(&dir), &["fetch", "--tags", "--prune", "origin"])?;
        let source = read_source(&dir, &place.target)?;
        let changed = if source.branch.is_some() && source.behind > 0 { changed_files(&dir, "HEAD", "@{u}", source.path.as_deref(), &place.target) } else { Vec::new() };
        Ok(GithubFetchResult { source, changed })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubFetchResult {
    pub source: GithubSource,
    /// 바뀌는(바뀐) 파일. Vault 경로(`GitHub/<name>/<파일>`)
    pub changed: Vec<String>,
}

/// 바뀐(바뀔) 파일을 이어진 Vault 폴더 기준 경로로. 예전 방식은 작업 폴더 경로 그대로, 숨긴 방식은 받은 폴더 앞부분을 뗀다
fn changed_files(dir: &Path, from: &str, to: &str, path: Option<&str>, target: &str) -> Vec<String> {
    let legacy = target.starts_with(&format!("{GITHUB_DIR}/")) && dir.parent().and_then(|parent| parent.file_name()).is_some_and(|value| value == GITHUB_DIR);
    let mut args = vec!["diff", "--name-only", from, to];
    if let Some(path) = path {
        args.push("--");
        args.push(path);
    }
    let prefix = match path { Some(path) if !legacy => format!("{}/", path.trim_end_matches('/')), _ => String::new() };
    git(Some(dir), &args)
        .map(|text| text.lines().filter(|line| !line.is_empty()).map(|line| format!("{target}/{}", line.strip_prefix(prefix.as_str()).unwrap_or(line))).collect())
        .unwrap_or_default()
}

/// 「최신으로」: 받은 것을 적용한다(fast-forward 만 — 강제로 덮지 않는다). 태그·커밋을 보는 중이면 브랜치로 돌아간다
#[tauri::command]
pub async fn github_pull(vault_root: String, name: String) -> Result<GithubFetchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let place = place_of(&vault_root, &name)?;
        let dir = place.clone.clone();
        git(Some(&dir), &["fetch", "--tags", "--prune", "origin"])?;
        let before = git(Some(&dir), &["rev-parse", "HEAD"])?;
        let mut source = read_source(&dir, &place.target)?;
        if source.branch.is_none() {
            let default = git(Some(&dir), &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
                .ok()
                .and_then(|value| value.strip_prefix("origin/").map(str::to_string))
                .unwrap_or_else(|| "main".into());
            git(Some(&dir), &["checkout", default.as_str()])?;
        }
        git(Some(&dir), &["merge", "--ff-only", "@{u}"])?;
        source = read_source(&dir, &place.target)?;
        let changed = apply_changes(&vault_root, &place, source.path.as_deref(), before.as_str(), "HEAD");
        Ok(GithubFetchResult { source, changed })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRef {
    /// branch | tag | commit
    pub kind: String,
    pub name: String,
    pub date: String,
    pub subject: String,
}

/// 「다른 버전 보기」에 보일 목록: 브랜치, 태그, 받은 폴더에 닿은 최근 커밋
#[tauri::command]
pub async fn github_refs(vault_root: String, name: String) -> Result<Vec<GithubRef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = place_of(&vault_root, &name)?.clone;
        let path = sparse_path(&dir);
        let mut refs = Vec::new();
        let read = |args: &[&str], kind: &str, refs: &mut Vec<GithubRef>| {
            if let Ok(text) = git(Some(&dir), args) {
                for line in text.lines() {
                    let mut fields = line.split('\u{1f}');
                    let name = fields.next().unwrap_or_default().trim().to_string();
                    if name.is_empty() || name == "origin/HEAD" || name == "origin" {
                        continue;
                    }
                    refs.push(GithubRef {
                        kind: kind.into(),
                        name: name.strip_prefix("origin/").unwrap_or(&name).to_string(),
                        date: fields.next().unwrap_or_default().to_string(),
                        subject: fields.next().unwrap_or_default().to_string(),
                    });
                }
            }
        };
        read(&["for-each-ref", "--sort=-committerdate", "--count=30", "--format=%(refname:short)%1f%(committerdate:short)%1f%(contents:subject)", "refs/remotes/origin"], "branch", &mut refs);
        read(&["for-each-ref", "--sort=-creatordate", "--count=50", "--format=%(refname:short)%1f%(creatordate:short)%1f%(contents:subject)", "refs/tags"], "tag", &mut refs);
        let mut log = vec!["log", "-40", "--format=%h%x1f%cs%x1f%s", "@{u}"];
        if let Some(path) = &path {
            log.push("--");
            log.push(path.as_str());
        }
        if git(Some(&dir), &["rev-parse", "--verify", "--quiet", "@{u}"]).is_err() {
            log[3] = "HEAD";
        }
        read(&log, "commit", &mut refs);
        Ok(refs)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// 고른 브랜치·태그·커밋으로 바꿔 본다(브랜치면 그 브랜치를 따라간다)
#[tauri::command]
pub async fn github_checkout(vault_root: String, name: String, kind: String, reference: String) -> Result<GithubSource, String> {
    if reference.is_empty() || reference.starts_with('-') || reference.contains("..") {
        return Err(tr!("버전 이름이 올바르지 않습니다.", "Invalid version name."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let place = place_of(&vault_root, &name)?;
        let dir = place.clone.clone();
        let before = git(Some(&dir), &["rev-parse", "HEAD"])?;
        match kind.as_str() {
            "branch" => {
                if git(Some(&dir), &["checkout", reference.as_str()]).is_err() {
                    let remote = format!("origin/{reference}");
                    git(Some(&dir), &["checkout", "--track", remote.as_str()])?;
                }
            }
            "tag" => {
                let tag = format!("tags/{reference}");
                git(Some(&dir), &["checkout", "--detach", tag.as_str()])?;
            }
            _ => {
                git(Some(&dir), &["checkout", "--detach", reference.as_str()])?;
            }
        }
        let source = read_source(&dir, &place.target)?;
        apply_changes(&vault_root, &place, source.path.as_deref(), before.as_str(), "HEAD");
        Ok(source)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tree_urls() {
        let url = parse_github_url("https://github.com/example-org/example-docs/tree/main/docs").unwrap();
        assert_eq!(url, GithubUrl { owner: "example-org".into(), repo: "example-docs".into(), reference: Some("main".into()), path: Some("docs".into()) });
        let bare = parse_github_url("github.com/example-org/example-docs.git/").unwrap();
        assert_eq!(bare.repo, "example-docs");
        assert_eq!(bare.path, None);
        assert!(parse_github_url("https://gitlab.com/a/b").is_err());
        assert!(parse_github_url("https://github.com/a/b/tree/main/../x").is_err());
        assert!(parse_github_url("https://github.com/a/b/tree/--upload-pack=x").is_err());
    }

    #[test]
    fn links_follow_folder_moves() {
        let root = std::env::temp_dir().join(format!("iwae-gh-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let vault = root.to_string_lossy().into_owned();
        write_links(&vault, &[
            GithubLink { name: "a".into(), target: "Docs/Spec".into() },
            GithubLink { name: "b".into(), target: "Docs/Spec/Sub".into() },
            GithubLink { name: "c".into(), target: "Other".into() },
        ]).unwrap();
        github_move_target(vault.clone(), "Docs/Spec".into(), "Moved/Spec".into()).unwrap();
        let links = read_links(&vault);
        assert_eq!(links[0].target, "Moved/Spec");
        assert_eq!(links[1].target, "Moved/Spec/Sub");
        assert_eq!(links[2].target, "Other");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn copies_tree_without_git_folder() {
        let root = std::env::temp_dir().join(format!("iwae-gh-copy-{}", std::process::id()));
        let from = root.join("from");
        std::fs::create_dir_all(from.join(".git")).unwrap();
        std::fs::create_dir_all(from.join("images")).unwrap();
        std::fs::write(from.join("a.md"), "# a").unwrap();
        std::fs::write(from.join("images/x.png"), "x").unwrap();
        std::fs::write(from.join(".git/HEAD"), "ref").unwrap();
        assert_eq!(copy_tree(&from, &root.join("to")).unwrap(), 2);
        assert!(root.join("to/images/x.png").exists());
        assert!(!root.join("to/.git").exists());
        assert!(safe_vault_path("Docs/Spec"));
        assert!(!safe_vault_path("../x"));
        assert!(!safe_vault_path(".iwae/github"));
        std::fs::remove_dir_all(&root).ok();
    }
}
