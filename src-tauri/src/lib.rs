#![allow(non_snake_case)]

mod desk;
#[cfg(windows)]
mod notify;
mod store;
mod win;

use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};

/// 交互区域（物理像素，相对窗口左上角）
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

static HIT_RECTS: Mutex<Vec<HitRect>> = Mutex::new(Vec::new());
static PREV_WNDPROC: Mutex<isize> = Mutex::new(0);
static DESK_HWND: Mutex<isize> = Mutex::new(0);
static ALLOW_FOCUS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn desk_read() -> desk::DeskSnapshot {
    desk::read_icons()
}

#[tauri::command]
fn desk_apply(positions: Vec<(String, i32, i32)>) -> Result<usize, String> {
    desk::set_positions(&positions)
}

#[tauri::command]
fn desk_files() -> Vec<(String, String)> {
    desk::desktop_files()
}

/// 整理模式下把 Explorer 画的真图标藏起来，换成前端画的副本
#[tauri::command]
fn desk_icons_visible(visible: bool) -> bool {
    desk::set_icons_visible(visible)
}

#[tauri::command]
fn snapshot_save() -> Result<usize, String> {
    let snap = desk::read_icons();
    if !snap.ok {
        return Err(snap.error.unwrap_or_else(|| "读桌面失败".into()));
    }
    let s = store::Snapshot {
        taken_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        icons: snap
            .icons
            .iter()
            .map(|i| store::SavedIcon {
                name: i.name.clone(),
                x: i.x,
                y: i.y,
            })
            .collect(),
    };
    let n = s.icons.len();
    store::write_json(&store::snapshot_file(), &s)?;
    Ok(n)
}

#[tauri::command]
fn snapshot_restore() -> Result<usize, String> {
    let s: store::Snapshot = store::read_json(&store::snapshot_file())
        .ok_or_else(|| "还没有保存过桌面快照".to_string())?;
    let pos: Vec<(String, i32, i32)> = s
        .icons
        .iter()
        .map(|i| (i.name.clone(), i.x, i.y))
        .collect();
    desk::set_positions(&pos)
}

#[tauri::command]
fn snapshot_info() -> Option<store::Snapshot> {
    store::read_json(&store::snapshot_file())
}

#[tauri::command]
fn state_load() -> Option<String> {
    let s = std::fs::read_to_string(store::state_file()).ok()?;
    // 手工编辑过的文件可能带 UTF-8 BOM，前端 JSON.parse 不认
    Some(s.trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
fn state_save(json: String) -> Result<(), String> {
    // 覆盖前先把旧的一份收进 backups/，原子写保证不会写出半截文件
    store::backup_current();
    store::write_atomic(&store::state_file(), &json)
}

/// 备份概况，给外观面板显示
#[tauri::command]
fn backup_status() -> store::BackupInfo {
    store::backup_info()
}

/// 在资源管理器里打开备份文件夹
#[tauri::command]
fn backup_open() -> bool {
    let d = store::backup_dir();
    let _ = std::fs::create_dir_all(&d);
    // explorer 是 GUI 程序，本来就不带控制台，不用 creation_flags
    std::process::Command::new("explorer").arg(d).spawn().is_ok()
}

#[tauri::command]
fn hit_set(rects: Vec<HitRect>) {
    if let Ok(mut g) = HIT_RECTS.lock() {
        *g = rects.clone();
    }
    #[cfg(windows)]
    hook::apply_region(&rects);
}

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// 需要键盘输入时（新建任务浮层）临时允许激活，关闭后恢复不抢焦点
#[tauri::command]
fn focus_set(on: bool) {
    #[cfg(windows)]
    hook::set_noactivate(!on);
}

/// 悬浮提醒条的数据
#[derive(Debug, Clone, Serialize)]
pub struct RemindPayload {
    pub title: String,
    pub sub: String,
    pub id: String,
    pub hot: bool,
}

static REMIND: Mutex<Option<RemindPayload>> = Mutex::new(None);


/// 主窗口启动时建一条隐藏的置顶小窗，专门显示 deadline 提醒条
/// 注意必须是 async：同步 command 跑在主线程上，建窗口会等主线程 → 死锁
#[tauri::command]
async fn remind_spawn(app: tauri::AppHandle) -> bool {
    if app.get_webview_window("remind").is_some() {
        return true;
    }
    let (x, y) = remind_spot(&app);
    let built = tauri::WebviewWindowBuilder::new(
        &app,
        "remind",
        tauri::WebviewUrl::App("index.html?remind=1".into()),
    )
    .title("潮汐 · 提醒")
    .inner_size(460.0, 104.0)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .visible(false)
    .build();
    built.is_ok()
}

/// 顶部居中，留出一点边距
fn remind_spot(app: &tauri::AppHandle) -> (f64, f64) {
    let mut w = 1920.0f64;
    let mut scale = 1.0f64;
    if let Ok(Some(m)) = app.primary_monitor() {
        w = m.size().width as f64;
        scale = m.scale_factor();
    }
    let lw = 460.0 * scale;
    ((w - lw) / 2.0 / scale, 18.0)
}

#[tauri::command]
async fn remind_show(app: tauri::AppHandle, title: String, sub: String, id: String, hot: bool) -> bool {
    use tauri::Emitter;
    let p = RemindPayload { title, sub, id, hot };
    if let Ok(mut g) = REMIND.lock() {
        *g = Some(p.clone());
    }

    if let Some(w) = app.get_webview_window("remind") {
        let _ = app.emit_to("remind", "remind-update", p);
        let _ = w.show();
        return true;
    }
    false
}

#[tauri::command]
async fn remind_hide(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("remind") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn remind_payload() -> Option<RemindPayload> {
    REMIND.lock().ok().and_then(|g| g.clone())
}

/// 改 state.json：把某个任务标记成已完成
#[tauri::command]
fn state_done(id: String) -> bool {
    edit_state(|v| {
        if let Some(arr) = v.get_mut("tasks").and_then(|t| t.as_array_mut()) {
            for t in arr {
                if t.get("id").and_then(|x| x.as_str()) == Some(id.as_str()) {
                    t["done"] = serde_json::Value::Bool(true);
                    return true;
                }
            }
        }
        false
    })
}

/// 改 state.json：把某个任务「稍后提醒」到 until_ms
#[tauri::command]
fn state_snooze(id: String, until_ms: i64) -> bool {
    edit_state(|v| {
        if !v.get("snoozed").map(|x| x.is_object()).unwrap_or(false) {
            v["snoozed"] = serde_json::json!({});
        }
        if let Some(m) = v.get_mut("snoozed").and_then(|x| x.as_object_mut()) {
            m.insert(id.clone(), serde_json::json!(until_ms));
            return true;
        }
        false
    })
}

/// 读 Windows 通知中心里所有 toast 通知
#[tauri::command]
async fn sys_notifs() -> Result<Vec<notify::SysNotif>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(notify::read_all)
            .await
            .map_err(|e| format!("task: {e}"))?
    }
    #[cfg(not(windows))]
    {
        Err("unsupported".into())
    }
}

/// 删掉通知中心里的一条通知
#[tauri::command]
async fn sys_notif_remove(id: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || notify::remove_one(id))
            .await
            .map_err(|e| format!("task: {e}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Err("unsupported".into())
    }
}

/// 清空通知中心
#[tauri::command]
async fn sys_notif_clear() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(notify::clear_all)
            .await
            .map_err(|e| format!("task: {e}"))?
    }
    #[cfg(not(windows))]
    {
        Err("unsupported".into())
    }
}

/* ================= 开机自启 ================= */
#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_NAME: &str = "TideDesk";

#[cfg(windows)]
fn reg_cmd(args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("reg")
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，别闪黑框
        .output()
        .ok()
}

/// 首次运行时默认把开机自启打开（只做一次）。
/// 用户自己关掉之后会留一个标记文件，下次不再自动打开。
#[cfg(windows)]
fn autostart_first_run() {
    let dir = store::state_file().parent().map(|p| p.to_path_buf());
    let Some(dir) = dir else { return };
    let mark = dir.join("autostart-asked");
    // 已经开着自启的，顺手把路径刷新成当前 exe：
    // 装到别的目录、或者从开发目录换成安装版之后，老路径会失效。
    if autostart_get() {
        let _ = autostart_set(true);
        let _ = std::fs::write(&mark, b"1");
        return;
    }
    if mark.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    // 开发态不写注册表
    let is_dev = std::env::current_exe()
        .map(|p| p.display().to_string().contains("\\target\\debug\\"))
        .unwrap_or(false);
    if !is_dev {
        let _ = autostart_set(true);
    }
    let _ = std::fs::write(&mark, b"1");
}
/// 注册表里有没有开机自启项
#[tauri::command]
fn autostart_get() -> bool {
    #[cfg(windows)]
    {
        reg_cmd(&["query", RUN_KEY, "/v", RUN_NAME])
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 开/关开机自启。写的是当前 exe 的绝对路径。
#[tauri::command]
fn autostart_set(on: bool) -> bool {
    #[cfg(windows)]
    {
        if on {
            let Ok(exe) = std::env::current_exe() else {
                return false;
            };
            let exe = exe.display().to_string();
            // 开发态（target\debug）不写注册表，免得把调试版塞进开机项
            if exe.contains("\\target\\debug\\") {
                return true;
            }
            let val = format!("\"{exe}\"");
            reg_cmd(&["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", &val, "/f"])
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            reg_cmd(&["delete", RUN_KEY, "/v", RUN_NAME, "/f"])
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = on;
        false
    }
}
fn edit_state(f: impl FnOnce(&mut serde_json::Value) -> bool) -> bool {
    let path = store::state_file();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}')) else {
        return false;
    };
    if !f(&mut v) {
        return false;
    }
    let _ = std::fs::write(&path, v.to_string());
    true
}
#[cfg(windows)]
mod hook {
    use super::*;
    use crate::win::*;

    extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> isize {
        unsafe {
            match msg {
                // Win+D / Win+M 会发这个，吞掉就不收走
                WM_SYSCOMMAND if (wp & 0xFFF0) == SC_MINIMIZE => return 0,
                // 点组件时不要抢走别的窗口的焦点。
                // 只拦激活、不设 WS_EX_NOACTIVATE —— 后者会让 WebView2 收不到鼠标事件。
                WM_MOUSEACTIVATE if !ALLOW_FOCUS.load(std::sync::atomic::Ordering::Relaxed) => {
                    return MA_NOACTIVATE
                }
                WM_NCHITTEST => {
                    let mut pt = POINT::default();
                    GetCursorPos(&mut pt);
                    let mut r = RECT::default();
                    GetWindowRect(hwnd, &mut r);
                    let x = (pt.x - r.left) as f64;
                    let y = (pt.y - r.top) as f64;
                    let inside = HIT_RECTS
                        .lock()
                        .map(|g| {
                            g.iter()
                                .any(|h| x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
                        })
                        .unwrap_or(false);
                    return if inside { HTCLIENT } else { HTTRANSPARENT };
                }
                _ => {}
            }
            let prev = *PREV_WNDPROC.lock().unwrap();
            CallWindowProcW(prev, hwnd, msg, wp, lp)
        }
    }

    /// 真正的鼠标穿透：把窗口区域裁成只剩几个组件矩形。
    /// WM_NCHITTEST 返回 HTTRANSPARENT 只在同进程内有效，
    /// 跨进程（Explorer 双击 / 别的程序）会照旧被吞掉，所以必须改窗口区域。
    pub fn apply_region(rects: &[HitRect]) {
        unsafe {
            let h = *DESK_HWND.lock().unwrap() as HWND;
            if h.is_null() || IsWindow(h) == 0 {
                return;
            }
            if rects.is_empty() {
                // 空区域会让整个窗口不可见，退回整窗，等前端下次推坐标
                SetWindowRgn(h, std::ptr::null_mut(), 1);
                return;
            }
            let f = &rects[0];
            let first = CreateRectRgn(
                f.x as i32,
                f.y as i32,
                (f.x + f.w) as i32,
                (f.y + f.h) as i32,
            );
            for r in &rects[1..] {
                let tmp = CreateRectRgn(
                    r.x as i32,
                    r.y as i32,
                    (r.x + r.w) as i32,
                    (r.y + r.h) as i32,
                );
                CombineRgn(first, first, tmp, RGN_OR);
                DeleteObject(tmp as *mut c_void);
            }
            // 成功后区域归系统所有，不能再删
            SetWindowRgn(h, first, 1);
        }
    }

    /// 需要打字时（新建任务浮层）临时要焦点
    pub fn set_noactivate(on: bool) {
        ALLOW_FOCUS.store(!on, std::sync::atomic::Ordering::Relaxed);
        unsafe {
            let h = *DESK_HWND.lock().unwrap() as HWND;
            if h.is_null() {
                return;
            }
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let next = if on {
                ex | WS_EX_NOACTIVATE
            } else {
                ex & !WS_EX_NOACTIVATE
            };
            SetWindowLongPtrW(h, GWL_EXSTYLE, next);
            if !on {
                // 取消 NOACTIVATE 后主动要一次焦点，输入框才能打字
                SetForegroundWindow(h);
            }
        }
    }

    /// 贴在桌面正上方：z-order 里插到 Progman（桌面窗口）的上面一格，
    /// 于是壁纸之上、所有普通窗口之下，Win+D 也收不走。
    pub fn to_bottom(window: &WebviewWindow) {
        unsafe {
            if let Ok(h) = window.hwnd() {
                let hwnd = h.0 as HWND;
                let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
                let after = if progman.is_null() { HWND_BOTTOM } else { progman };
                SetWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                ShowWindow(hwnd, SW_SHOW);
            }
        }
    }

    /// 设置窗口扩展样式。必须在 window.show() **之后**调用 ——
    /// tao 的 show() 会重写 GWL_EXSTYLE，之前设的 TOOLWINDOW/NOACTIVATE 会被抹掉。
    pub fn apply_exstyle() {
        unsafe {
            let hwnd = *DESK_HWND.lock().unwrap() as HWND;
            if hwnd.is_null() || IsWindow(hwnd) == 0 {
                return;
            }
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            // TOOLWINDOW：不进 Alt+Tab；NOACTIVATE：点组件不抢焦点
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            );
        }
    }

    pub fn install(window: &WebviewWindow) {
        unsafe {
            let hwnd = window.hwnd().unwrap().0 as HWND;
            *DESK_HWND.lock().unwrap() = hwnd as isize;
            let prev = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wndproc as usize as isize);
            *PREV_WNDPROC.lock().unwrap() = prev;
            // 铺满「工作区」而不是整块屏幕：任务栏那一条留出来，
            // 否则底部 dock 会压在任务栏上。
            let mut rc = RECT::default();
            SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut rc as *mut RECT as *mut c_void, 0);
            let ww = if rc.right > rc.left { rc.right - rc.left } else { GetSystemMetrics(SM_CXSCREEN) };
            let hh = if rc.bottom > rc.top { rc.bottom - rc.top } else { GetSystemMetrics(SM_CYSCREEN) };
            SetWindowPos(
                hwnd,
                HWND_BOTTOM,
                rc.left,
                rc.top,
                ww,
                hh,
                SWP_NOACTIVATE,
            );
        }
    }
}

pub fn run() {
    // 单实例：第二个进程会再画一层组件，看起来像重影，直接退。
    #[cfg(windows)]
    if !win::single_instance() {
        std::process::exit(0);
    }
    // 第一次跑：默认开自启，之后交给外观面板里的开关
    #[cfg(windows)]
    autostart_first_run();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desk_read,
            desk_apply,
            desk_files,
            desk_icons_visible,
            snapshot_save,
            snapshot_restore,
            snapshot_info,
            state_load,
            state_save,
            hit_set,
            remind_spawn,
            remind_show,
            remind_hide,
            remind_payload,
            state_done,
            state_snooze,
            focus_set,
            sys_notifs,
            sys_notif_remove,
            sys_notif_clear,
            autostart_get,
            autostart_set,
            backup_status,
            backup_open,
            app_quit
        ])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("desk") {
                #[cfg(windows)]
                hook::install(&w);
                let _ = w.show();
                hook::to_bottom(&w);
                #[cfg(windows)]
                hook::apply_exstyle();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tide-desk");
}
