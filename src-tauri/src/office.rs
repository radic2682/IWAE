//! PowerPoint 파일(.ppt/.pptx)을 PDF 로 바꾼다. PC 에 깔린 PowerPoint 를 COM 으로 부른다
//! (모양이 원본과 똑같이 나오는 유일한 길이다 — 순수 라이브러리 변환은 글꼴·도형이 어긋난다).
//!
//! 사용자가 PowerPoint 를 켜 두고 있으면 COM 이 그 PowerPoint 에 붙는다. 그래서 변환한 파일만 닫고,
//! 변환 전에 열린 프레젠테이션이 없었을 때만 PowerPoint 를 끈다(사용자 작업을 닫지 않는다).

use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 콘솔 창을 띄우지 않는다
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// PowerShell 의 출력 인코딩을 UTF-8 로 맞추는 앞머리. 안 맞추면 한국어 Windows 에서 오류 글이 CP949 로 나와
/// UTF-8 로 읽을 때 깨진다.
const UTF8_PREAMBLE: &str = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8
";

/// 변환 한 번에 줄 시간. 큰 발표 자료도 끝나게 넉넉히 두되, 응답 없는 PowerPoint 가 영영 붙잡지는 못하게 한다
const CONVERT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$source = $env:IWAE_PPT_SOURCE
$target = $env:IWAE_PPT_TARGET
$app = New-Object -ComObject PowerPoint.Application
$before = $app.Presentations.Count
# 3 = msoAutomationSecurityForceDisable: 출처가 불분명한 파일의 매크로는 열 때 돌지 않게 끈다.
# 사용자가 켜 둔 PowerPoint 에 붙었을 수 있으니, 끝나면 원래 값으로 되돌린다
$security = $app.AutomationSecurity
$app.AutomationSecurity = 3
try {
  # Open(FileName, ReadOnly, Untitled, WithWindow) — 창 없이 읽기 전용으로
  $deck = $app.Presentations.Open($source, -1, 0, 0)
  try {
    # 32 = ppSaveAsPDF
    $deck.SaveAs($target, 32)
  } finally {
    $deck.Close()
  }
} finally {
  $app.AutomationSecurity = $security
  if ($before -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
"#;

/// 명령을 돌리고 `timeout` 안에 안 끝나면 죽인다. 출력은 따로 읽어 파이프가 차서 멈추는 일이 없게 한다
fn run_with_timeout(mut command: Command, timeout: std::time::Duration) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::process::Stdio;
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| tr!("PowerShell 을 실행하지 못했습니다: {err}", "Could not run PowerShell: {err}"))?;
    let read_all = |mut pipe: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            let _ = tx.send(bytes);
        });
        rx
    };
    let stdout = read_all(Box::new(child.stdout.take().expect("piped")));
    let stderr = read_all(Box::new(child.stderr.take().expect("piped")));
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let minutes = (timeout.as_secs() / 60).max(1);
                return Err(tr!(
                    "PowerPoint 가 {minutes}분 안에 끝나지 않아 변환을 멈췄습니다. PowerPoint 에서 이 파일을 직접 열어 보세요.",
                    "PowerPoint did not finish within {minutes} minutes, so the conversion was stopped. Try opening the file in PowerPoint yourself."
                ));
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(err) => return Err(tr!("PowerShell 을 실행하지 못했습니다: {err}", "Could not run PowerShell: {err}")),
        }
    };
    let wait = std::time::Duration::from_secs(5);
    Ok(std::process::Output { status, stdout: stdout.recv_timeout(wait).unwrap_or_default(), stderr: stderr.recv_timeout(wait).unwrap_or_default() })
}

fn convert(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err(tr!("PowerPoint 파일을 찾지 못했습니다.", "PowerPoint file not found."));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|err| tr!("변환 폴더를 만들지 못했습니다: {err}", "Could not create the conversion folder: {err}"))?;
    }
    let script = format!("{UTF8_PREAMBLE}{SCRIPT}");
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script.as_str()])
        // -Command 뒤의 인자는 명령 글에 그대로 붙어 버려 경로(빈칸·괄호)가 깨진다. 환경 변수로 넘긴다
        .env("IWAE_PPT_SOURCE", source)
        .env("IWAE_PPT_TARGET", target);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = run_with_timeout(command, CONVERT_TIMEOUT)?;
    if !output.status.success() || !target.is_file() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        if detail.contains("80040154") || detail.contains("PowerPoint.Application") {
            return Err(tr!("이 PC 에 PowerPoint 가 없어 PDF 로 바꿀 수 없습니다.", "PowerPoint is not installed on this PC, so it cannot be converted to PDF."));
        }
        return Err(if detail.is_empty() {
            tr!("PowerPoint 가 PDF 를 만들지 못했습니다.", "PowerPoint could not create the PDF.")
        } else {
            tr!("PDF 로 바꾸지 못했습니다: {}", "Could not convert to PDF: {}", detail.lines().next().unwrap_or(detail))
        });
    }
    Ok(())
}

/// source(.ppt/.pptx)를 target(.pdf)으로 바꾼다. 몇 초 걸리므로 블로킹 풀에서 돈다
#[tauri::command]
pub async fn office_to_pdf(app: tauri::AppHandle, source: String, target: String) -> Result<(), String> {
    crate::fs_scope::ensure_all_allowed(&app, [&source, &target])?;
    let lower = source.to_lowercase();
    if !(lower.ends_with(".ppt") || lower.ends_with(".pptx")) {
        return Err(tr!("PowerPoint 파일(.ppt, .pptx)만 바꿀 수 있습니다.", "Only PowerPoint files (.ppt, .pptx) can be converted."));
    }
    if !target.to_lowercase().ends_with(".pdf") {
        return Err(tr!("PDF 경로가 올바르지 않습니다.", "Invalid PDF path."));
    }
    tauri::async_runtime::spawn_blocking(move || convert(Path::new(&source), Path::new(&target)))
        .await
        .map_err(|err| tr!("변환 작업이 멈췄습니다: {err}", "The conversion stopped: {err}"))?
}

#[cfg(test)]
mod tests {
    /// 한국어 Windows 에서도 PowerShell 오류 글이 UTF-8 로 나와 한글이 안 깨진다
    #[cfg(windows)]
    #[test]
    fn powershell_errors_come_back_as_utf8() {
        let script = format!("{}{}", super::UTF8_PREAMBLE, "$ErrorActionPreference = 'Stop'; throw '한글 오류 메시지'");
        let mut command = std::process::Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script.as_str()]);
        let output = super::run_with_timeout(command, std::time::Duration::from_secs(60)).unwrap();
        assert!(!output.status.success());
        let text = String::from_utf8(output.stderr).expect("UTF-8 이어야 한다");
        assert!(text.contains("한글 오류 메시지"), "{text}");
    }

    #[cfg(windows)]
    #[test]
    fn a_hung_powershell_is_killed_after_the_time_limit() {
        let mut command = std::process::Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 60"]);
        let started = std::time::Instant::now();
        let error = super::run_with_timeout(command, std::time::Duration::from_millis(800)).expect_err("시간 초과");
        assert!(started.elapsed() < std::time::Duration::from_secs(20));
        assert!(error.contains("PowerPoint"), "{error}");
    }

    #[test]
    fn script_disables_macros_before_opening_the_file() {
        let security = super::SCRIPT.find("$app.AutomationSecurity = 3").expect("macros must be force-disabled");
        let open = super::SCRIPT.find("Presentations.Open(").expect("script opens the deck");
        assert!(security < open, "AutomationSecurity must be set before Open()");
        assert!(super::SCRIPT.contains("$app.AutomationSecurity = $security"), "the user's own setting is restored");
    }
}
