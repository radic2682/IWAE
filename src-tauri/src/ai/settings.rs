//! 외부 AI 연결 설정. 앱 데이터 폴더의 `ai-settings.json` 한 파일이다.
//!
//! 접속 토큰이 들어 있어서 Vault(동기화 폴더일 수 있다)가 아니라 이 PC 의 앱 데이터에 둔다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 47821;
pub const DEFAULT_OLLAMA: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSettings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSettings {
    pub enabled: bool,
    pub endpoint: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub api: ApiSettings,
    pub embedding: EmbeddingSettings,
}

/// 32바이트 난수를 16진수로. 운영체제 난수원을 쓴다.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("운영체제 난수원을 쓸 수 없습니다");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            api: ApiSettings {
                enabled: false,
                port: DEFAULT_PORT,
                token: new_token(),
            },
            embedding: EmbeddingSettings {
                enabled: false,
                endpoint: DEFAULT_OLLAMA.into(),
                model: crate::rag::embed::DEFAULT_EMBED_MODEL.into(),
            },
        }
    }
}

pub fn settings_path(app_data: &Path) -> PathBuf {
    app_data.join("ai-settings.json")
}

/// 읽지 못하면(처음 실행, 깨진 파일) 기본값. 토큰이 비어 있으면 새로 만든다.
pub fn load(app_data: &Path) -> AiSettings {
    let mut settings = std::fs::read_to_string(settings_path(app_data))
        .ok()
        .and_then(|text| serde_json::from_str::<AiSettings>(&text).ok())
        .unwrap_or_default();
    if settings.api.token.len() < 32 {
        settings.api.token = new_token();
    }
    if settings.api.port < 1024 {
        settings.api.port = DEFAULT_PORT;
    }
    settings
}

pub fn save(app_data: &Path, settings: &AiSettings) -> Result<(), String> {
    std::fs::create_dir_all(app_data)
        .map_err(|err| tr!("설정 폴더를 만들지 못했습니다: {err}", "Couldn't create the settings folder: {err}"))?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|err| tr!("설정을 쓰지 못했습니다: {err}", "Couldn't write the settings: {err}"))?;
    let path = settings_path(app_data);
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|err| tr!("설정을 쓰지 못했습니다: {err}", "Couldn't write the settings: {err}"))?;
    std::fs::rename(&temp, &path).map_err(|err| tr!("설정을 바꾸지 못했습니다: {err}", "Couldn't replace the settings: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("iwae-ai-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn first_run_gets_safe_defaults_with_a_fresh_token() {
        let settings = load(&temp_dir("first"));
        assert!(!settings.api.enabled, "기본은 꺼짐");
        assert_eq!(settings.api.port, DEFAULT_PORT);
        assert_eq!(settings.api.token.len(), 64);
        assert!(settings.api.token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(new_token(), new_token());
    }

    #[test]
    fn saves_and_reloads_and_repairs_bad_values() {
        let dir = temp_dir("roundtrip");
        let mut settings = load(&dir);
        settings.api.enabled = true;
        settings.embedding.enabled = true;
        save(&dir, &settings).unwrap();
        assert_eq!(load(&dir), settings);

        std::fs::write(settings_path(&dir), r#"{"api":{"enabled":true,"port":80,"token":"short"},"embedding":{"enabled":false,"endpoint":"x","model":"y"}}"#).unwrap();
        let repaired = load(&dir);
        assert_eq!(repaired.api.port, DEFAULT_PORT);
        assert_eq!(repaired.api.token.len(), 64);
        std::fs::write(settings_path(&dir), "not json").unwrap();
        assert!(!load(&dir).api.enabled);
    }
}
