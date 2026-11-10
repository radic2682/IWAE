// `tr!` 매크로를 아래 모든 모듈에서 쓰도록 맨 앞에 둔다.
#[macro_use]
pub mod i18n;
pub mod ai;
pub mod bibliography;
pub mod clipboard_files;
pub mod fs_move;
pub mod markdown_pdf;
pub mod mcp;
pub mod office;
pub mod github;
pub mod locale;
pub mod window_state;
pub mod open_files;
pub mod example_vault;
pub mod pdf;
pub mod protocol;
pub mod rag;
pub mod storage;
pub mod translation;
pub mod usage;
pub mod vault_backup;
pub mod windows;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // PDFium 스레드는 앱과 수명을 같이한다. dll 이 없어도 여기서 죽지 않고,
    // 문서를 열려고 할 때 읽을 수 있는 오류로 알려 준다.
    //
    // 커맨드(관리 상태)와 프로토콜 핸들러가 같은 스레드를 봐야 한다 — 프로토콜은 캐시에
    // 이미 있는 문서만 그리고, 그 캐시를 채우는 것이 `pdf_open` 이기 때문이다.
    let pdf = pdf::PdfThread::shared();
    // 프런트엔드가 `set_locale` 을 부르기 전까지는 설치기에서 고른 언어를 쓴다.
    i18n::init_from_installer();

    let builder = tauri::Builder::default();
    // 이미 켜져 있으면 두 번째 실행(탐색기에서 PDF 열기)은 그 인자를 이 창에 넘기고 끝난다. 다른 플러그인보다 먼저
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        open_files::on_second_instance(app, argv, cwd);
    }));
    builder
        .manage(pdf.clone())
        // 처음 켜질 때 받은 PDF 경로(기본 PDF 앱으로 열었을 때)
        .manage(open_files::PendingOpenFiles(std::sync::Mutex::new(open_files::pdf_args(std::env::args(), None))))
        .manage(open_files::OpenFilesTaken::default())
        // 전체 Vault 백업·복원 진행 상태(취소용)
        .manage(vault_backup::BackupState::default())
        .manage(windows::TabDragState::default())
        // 동기 버전은 렌더(13–29ms) 동안 웹뷰를 멈춰 세운다.
        .register_asynchronous_uri_scheme_protocol(
            protocol::SCHEME,
            move |_context, request, responder| {
                protocol::serve(pdf.clone(), request, responder);
            },
        )
        // 폴더 선택으로 열린 범위를 재시작 뒤에도 복원해야 최근 vault 를 다시 열 수 있다.
        // persisted-scope 는 fs 뒤에 등록해야 저장된 범위를 가져올 수 있다.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // 창 위치·크기 기억. 창이 만들어지기 전에 등록해야 그 창을 기억한다(setup 안에서 등록하면 메인 창을 놓쳐 늘 빈 {} 가 저장됐다).
        // 새 창(window-…)은 label 이 매번 달라 기억해 봐야 쌓이기만 하므로 뺀다. 떼어 낸 창(detached-<문서>)은 문서마다 같은 label 이라 기억한다
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| !label.starts_with("window-"))
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            usage::app_usage,
            pdf::pdf_open,
            pdf::pdf_file_hash,
            open_files::take_open_files,
            example_vault::create_example_vault,
            office::office_to_pdf,
            github::github_list,
            github::github_clone,
            github::github_fetch,
            github::github_pull,
            github::github_refs,
            github::github_checkout,
            github::github_move_target,
            fs_move::vault_move_dir,
            markdown_pdf::markdown_to_pdf,
            mcp::webview_call::mcp_webview_reply,
            pdf::shared::pdf_render_shared,
            pdf::pdf_edit_pages,
            pdf::pdf_page_text,
            pdf::pdf_outline,
            pdf::pdf_page_links,
            pdf::pdf_metadata,
            pdf::pdf_annotations,
            pdf::pdf_export_annotated,
            pdf::pdf_export_searchable,
            pdf::pdf_tool,
            pdf::pdf_blank_pages,
            pdf::pdf_export_images,
            bibliography::bib_lookup_doi,
            ai::ai_set_vault,
            ai::rag_index,
            ai::rag_status,
            ai::rag_search,
            ai::ai_settings_get,
            ai::ai_embedding_configure,
            ai::ai_api_configure,
            ai::ai_api_status,
            ai::ai_api_regenerate_token,
            clipboard_files::copy_file_to_clipboard,
            translation::translation_status,
            translation::translation_unload,
            translation::translation_models,
            translation::translation_pull,
            translation::translation_generate,
            translation::translation_external_generate,
            translation::translation_api_key_get,
            translation::translation_api_key_set,
            locale::installer_language,
            window_state::save_window_state,
            windows::open_app_window,
            windows::close_secondary_windows,
            windows::report_tab_zones,
            windows::begin_tab_drag,
            windows::tab_drag_move,
            windows::tab_drag_end,
            windows::destroy_app_window,
            i18n::set_locale,
            translation::translation_install_ollama,
            storage::atomic_write_text,
            storage::scan_storage_recovery,
            storage::recover_storage_transaction,
            vault_backup::vault_backup_estimate,
            vault_backup::vault_backup_create,
            vault_backup::vault_backup_auto,
            vault_backup::vault_backup_restore,
            vault_backup::vault_backup_cancel,
            vault_backup::vault_trash_stats,
            vault_backup::vault_trash_empty,
        ])
        .setup(|app| {
            use tauri::Manager;
            let ai_state = ai::AiState::new(app.path().app_data_dir()?);
            // 사용자가 켜 둔 경우에만 MCP 서버를 띄운다(기본은 꺼짐).
            ai_state.apply_api(app.handle());
            app.manage(ai_state);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: Finder 에서 연 PDF(기본 앱·다음으로 열기)는 Apple Event 로 온다
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.into_iter().filter_map(|url| url.to_file_path().ok()).collect();
                open_files::on_opened_paths(_app, paths);
            }
        });
}
