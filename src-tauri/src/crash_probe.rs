//! 개발판 전용: 프로세스가 처리되지 않은 예외(접근 위반 등)로 죽을 때, 어느 모듈의 어느 오프셋에서
//! 죽었는지 stderr 와 임시 폴더의 iwae-crash.txt 에 남긴다. 덤프 도구 없이 원인 모듈을 가리기 위한 것.
//! 릴리즈 빌드에서는 아무것도 하지 않는다.

#[cfg(all(windows, debug_assertions))]
mod imp {
    use std::ffi::c_void;
    use std::io::Write;

    #[repr(C)]
    struct ExceptionRecord {
        code: u32,
        flags: u32,
        record: *mut ExceptionRecord,
        address: *mut c_void,
        parameter_count: u32,
        information: [usize; 15],
    }

    #[repr(C)]
    struct ExceptionPointers {
        record: *mut ExceptionRecord,
        context: *mut c_void,
    }

    type Filter = Option<unsafe extern "system" fn(*mut ExceptionPointers) -> i32>;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetUnhandledExceptionFilter(filter: Filter) -> Filter;
        fn GetModuleHandleExW(flags: u32, address: *const c_void, module: *mut *mut c_void) -> i32;
        fn GetModuleFileNameW(module: *mut c_void, name: *mut u16, size: u32) -> u32;
    }

    const FROM_ADDRESS: u32 = 0x4;
    const UNCHANGED_REFCOUNT: u32 = 0x2;

    fn describe(address: *mut c_void) -> String {
        let mut module: *mut c_void = std::ptr::null_mut();
        // SAFETY: 주소로 모듈 핸들을 찾을 뿐이며 참조 수를 바꾸지 않는다.
        let found = unsafe { GetModuleHandleExW(FROM_ADDRESS | UNCHANGED_REFCOUNT, address, &mut module) };
        if found == 0 || module.is_null() {
            return format!("{address:p} (모듈 없음)");
        }
        let mut name = [0u16; 520];
        // SAFETY: 버퍼 길이를 함께 넘긴다.
        let len = unsafe { GetModuleFileNameW(module, name.as_mut_ptr(), name.len() as u32) } as usize;
        let path = String::from_utf16_lossy(&name[..len.min(name.len())]);
        let offset = (address as usize).wrapping_sub(module as usize);
        format!("{path}+0x{offset:x}")
    }

    unsafe extern "system" fn on_crash(pointers: *mut ExceptionPointers) -> i32 {
        let text = if pointers.is_null() || (*pointers).record.is_null() {
            String::from("unhandled exception (기록 없음)")
        } else {
            let record = &*(*pointers).record;
            let thread = std::thread::current();
            format!(
                "IWAE crash: code=0x{:08x} at {} thread={:?} access={:?} last={}",
                record.code,
                describe(record.address),
                thread.name().unwrap_or("?"),
                &record.information[..(record.parameter_count as usize).min(2)],
                super::last_note(),
            )
        };
        eprintln!("{text}");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("iwae-crash.txt"))
        {
            let _ = writeln!(file, "{text}");
        }
        0 // EXCEPTION_CONTINUE_SEARCH: 원래대로 죽게 둔다
    }

    pub fn install() {
        // SAFETY: 프로세스 전역 필터를 하나 거는 것뿐이다.
        unsafe {
            SetUnhandledExceptionFilter(Some(on_crash));
        }
    }
}

static LAST_PTR: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static LAST_LEN: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static LAST_DETAIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// PDFium 스레드가 지금 하는 일을 적어 둔다(충돌 기록에 함께 남는다). 개발판 진단용.
pub fn note(what: &'static str, detail: u64) {
    use std::sync::atomic::Ordering::Relaxed;
    LAST_PTR.store(what.as_ptr() as usize, Relaxed);
    LAST_LEN.store(what.len(), Relaxed);
    LAST_DETAIL.store(detail, Relaxed);
}

#[allow(dead_code)]
fn last_note() -> String {
    use std::sync::atomic::Ordering::Relaxed;
    let ptr = LAST_PTR.load(Relaxed);
    let len = LAST_LEN.load(Relaxed);
    if ptr == 0 { return String::from("-"); }
    // SAFETY: note() 에는 'static str 만 들어온다.
    let text = unsafe { std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr as *const u8, len)) };
    format!("{text} {}", LAST_DETAIL.load(Relaxed))
}

/// 개발판(Windows)에서만 충돌 위치 기록기를 건다.
pub fn install() {
    #[cfg(all(windows, debug_assertions))]
    imp::install();
}
