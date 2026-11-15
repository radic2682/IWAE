//! Merging many sources must neither depend on nor disturb the open-document cache (16 slots).
mod common;
use app_lib::pdf::{PdfThread, ToolOp, ToolTarget};
use common::{fixture_dir, pdfium_present, write_single_page_pdf};

#[test]
fn checking_many_merge_sources_keeps_open_documents_and_the_merge_works() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let host = write_single_page_pdf("r3-host.pdf", 612.0, 792.0);
    pdf.open_with_password_blocking(host, Some("r3-host".into()), None).expect("host");
    let tab = write_single_page_pdf("r3-tab.pdf", 500.0, 700.0);
    pdf.open_with_password_blocking(tab, Some("r3-tab".into()), None).expect("tab");

    // What the webview now does for every source: check, never open into the cache.
    let sources: Vec<String> = (0..20)
        .map(|i| {
            let path = write_single_page_pdf(&format!("r3-src{i}.pdf"), 300.0 + i as f32, 400.0);
            pdf.check_source_blocking(path.clone(), None).expect("source is readable");
            path.to_string_lossy().into_owned()
        })
        .collect();

    pdf.page_text_blocking("r3-tab".into(), 0).expect("the other open tab was not evicted");
    pdf.page_text_blocking("r3-host".into(), 0).expect("the host was not evicted");
    let out = fixture_dir().join("r3-merged.pdf");
    let _ = std::fs::remove_file(&out);
    pdf.tool_blocking("r3-host".into(), ToolOp::Merge { sources }, ToolTarget::NewFile { path: out })
        .expect("merge of 20 sources succeeds");
}
