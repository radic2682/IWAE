//! 창 위치·크기 기억. 앱은 닫을 때 노트를 저장하려고 닫기를 막았다가 창을 destroy 하는데,
//! window-state 플러그인은 그 경로에서 위치를 남기지 않는다(빈 `{}` 가 저장됐다). 그래서 닫기 직전에 직접 남긴다.

/// 지금 창들의 위치·크기·최대화 상태를 파일에 남긴다
#[tauri::command]
pub fn save_window_state(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        app.save_window_state(StateFlags::all()).map_err(|error| error.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    Ok(())
}
