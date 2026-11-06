//! 앱이 쓰는 CPU·메모리(PDF 하단 오른쪽 표시). IWAE 와 그 아래 WebView2 프로세스(화면 그리기·글자 처리)를
//! 모두 더한다. 새 크레이트 없이 Windows API 를 바로 부른다(다른 OS 는 None).

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    /// IWAE(웹뷰 포함)가 쓴 CPU. 컴퓨터 전체(모든 코어)를 100 으로 한 %. 처음 잴 때는 0
    pub app_cpu: f64,
    /// IWAE(웹뷰 포함)의 전용 메모리(바이트). 작업 관리자의 「메모리」와 같은 성격(공유 DLL 은 빼고 센다)
    pub app_memory: u64,
    /// 시스템 전체 CPU %
    pub system_cpu: f64,
    pub system_memory_used: u64,
    pub system_memory_total: u64,
}

/// 지난번에 잰 값과의 차이로 CPU % 를 낸다. 프로세스가 생기고 없어져도 pid 별로 따로 빼서 음수가 나지 않는다
pub fn cpu_percent(busy_delta_100ns: u64, wall_delta_100ns: u64, cpus: u32) -> f64 {
    if wall_delta_100ns == 0 || cpus == 0 {
        return 0.0;
    }
    let percent = busy_delta_100ns as f64 * 100.0 / (wall_delta_100ns as f64 * f64::from(cpus));
    percent.clamp(0.0, 100.0)
}

#[tauri::command]
pub fn app_usage() -> Option<AppUsage> {
    imp::sample()
}

#[cfg(not(windows))]
mod imp {
    pub fn sample() -> Option<super::AppUsage> {
        None
    }
}

#[cfg(windows)]
mod imp {
    use super::{cpu_percent, AppUsage};
    use std::collections::{HashMap, HashSet};
    use std::ffi::c_void;
    use std::sync::Mutex;
    use std::time::Instant;

    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    impl FileTime {
        fn ticks(self) -> u64 {
            (u64::from(self.high) << 32) | u64::from(self.low)
        }
    }

    #[repr(C)]
    struct ProcessEntry32W {
        size: u32,
        usage: u32,
        process_id: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_process_id: u32,
        priority_class_base: i32,
        flags: u32,
        exe_file: [u16; 260],
    }

    #[repr(C)]
    #[derive(Default)]
    struct ProcessMemoryCountersEx {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }

    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetProcessTimes(handle: Handle, creation: *mut FileTime, exit: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn K32GetProcessMemoryInfo(handle: Handle, counters: *mut ProcessMemoryCountersEx, cb: u32) -> i32;
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
    }

    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_READ: u32 = 0x0010;

    struct Previous {
        at: Instant,
        /// pid → 그때까지 쓴 CPU 시간(100ns)
        process_ticks: HashMap<u32, u64>,
        system_busy: u64,
        system_total: u64,
    }

    static PREVIOUS: Mutex<Option<Previous>> = Mutex::new(None);

    /// 이 프로세스와 그 아래(자식·손자…) 프로세스 id
    fn own_tree() -> HashSet<u32> {
        let root = std::process::id();
        let mut tree = HashSet::from([root]);
        let mut parents: Vec<(u32, u32)> = Vec::new();
        // SAFETY: 스냅샷 핸들은 아래에서 닫고, entry 는 size 를 채운 뒤에 넘긴다.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot.is_null() || snapshot as isize == -1 {
                return tree;
            }
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.size = std::mem::size_of::<ProcessEntry32W>() as u32;
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    parents.push((entry.process_id, entry.parent_process_id));
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        // 부모가 이미 든 프로세스를 더 이상 늘지 않을 때까지 넣는다(WebView2 는 2~3 단 깊이)
        loop {
            let before = tree.len();
            for &(pid, parent) in &parents {
                if pid != parent && tree.contains(&parent) {
                    tree.insert(pid);
                }
            }
            if tree.len() == before {
                break;
            }
        }
        tree
    }

    /// (CPU 시간 100ns, 전용 메모리 바이트)
    fn process_numbers(pid: u32) -> Option<(u64, u64)> {
        // SAFETY: 연 핸들은 반드시 닫는다. 출력 구조체는 크기를 채워 넘긴다.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return None;
            }
            let (mut creation, mut exit, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default(), FileTime::default());
            let times = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0;
            let mut counters = ProcessMemoryCountersEx { cb: std::mem::size_of::<ProcessMemoryCountersEx>() as u32, ..Default::default() };
            let memory = K32GetProcessMemoryInfo(handle, &mut counters, counters.cb) != 0;
            CloseHandle(handle);
            if !times {
                return None;
            }
            Some((kernel.ticks() + user.ticks(), if memory { counters.private_usage as u64 } else { 0 }))
        }
    }

    pub fn sample() -> Option<AppUsage> {
        let now = Instant::now();
        let cpus = std::thread::available_parallelism().map(|count| count.get() as u32).unwrap_or(1);

        let mut process_ticks = HashMap::new();
        let mut app_memory = 0u64;
        for pid in own_tree() {
            if let Some((ticks, memory)) = process_numbers(pid) {
                process_ticks.insert(pid, ticks);
                app_memory += memory;
            }
        }

        let (mut idle, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default());
        // SAFETY: 출력만 받는 세 구조체.
        let system_times = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0;
        // GetSystemTimes 의 kernel 에는 idle 이 들어 있다
        let system_total = kernel.ticks() + user.ticks();
        let system_busy = system_total.saturating_sub(idle.ticks());

        let mut status = MemoryStatusEx { length: std::mem::size_of::<MemoryStatusEx>() as u32, ..Default::default() };
        // SAFETY: length 를 채운 구조체 하나.
        let memory_status = unsafe { GlobalMemoryStatusEx(&mut status) } != 0;

        let mut previous = PREVIOUS.lock().ok()?;
        let (app_cpu, system_cpu) = match previous.as_ref() {
            Some(before) => {
                let wall = (now.duration_since(before.at).as_nanos() / 100) as u64;
                // 지난번에도 있던 프로세스만 차이를 센다(새로 생긴 것은 다음번부터)
                let busy: u64 = process_ticks
                    .iter()
                    .filter_map(|(pid, ticks)| before.process_ticks.get(pid).map(|old| ticks.saturating_sub(*old)))
                    .sum();
                let system = if system_times && system_total > before.system_total {
                    (system_busy.saturating_sub(before.system_busy)) as f64 * 100.0 / (system_total - before.system_total) as f64
                } else {
                    0.0
                };
                (cpu_percent(busy, wall, cpus), system.clamp(0.0, 100.0))
            }
            None => (0.0, 0.0),
        };
        *previous = Some(Previous { at: now, process_ticks, system_busy, system_total });

        Some(AppUsage {
            app_cpu,
            app_memory,
            system_cpu,
            system_memory_used: if memory_status { status.total_phys.saturating_sub(status.avail_phys) } else { 0 },
            system_memory_total: if memory_status { status.total_phys } else { 0 },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_percent_spreads_over_all_cores_and_stays_in_range() {
        // 1초(10,000,000 × 100ns) 동안 한 코어를 다 쓰면 4코어에서 25%
        assert_eq!(cpu_percent(10_000_000, 10_000_000, 4), 25.0);
        assert_eq!(cpu_percent(0, 10_000_000, 4), 0.0);
        assert_eq!(cpu_percent(5, 0, 4), 0.0);
        assert_eq!(cpu_percent(90_000_000, 10_000_000, 4), 100.0);
    }

    #[cfg(windows)]
    #[test]
    fn sample_reports_own_memory() {
        let first = app_usage().expect("windows sample");
        assert!(first.app_memory > 0);
        assert!(first.system_memory_total >= first.system_memory_used);
        let second = app_usage().expect("second sample");
        assert!((0.0..=100.0).contains(&second.app_cpu));
    }
}
