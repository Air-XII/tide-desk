#![cfg(windows)]

use serde::Serialize;
use windows::UI::Notifications::{
    NotificationKinds, UserNotification,
};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

/// 一条系统通知（Windows 通知中心里的 toast）
#[derive(Serialize, Clone)]
pub struct SysNotif {
    pub id: u32,
    pub app: String,
    pub aumid: String,
    pub title: String,
    pub body: String,
    /// unix 毫秒
    pub time: i64,
}

/// WinRT 调用前必须初始化 apartment；已经初始化过会返回 S_FALSE，忽略即可
fn init_apartment() {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

/// 取一条通知的文本行：第一行当标题，其余拼成正文
fn texts_of(n: &UserNotification) -> (String, String) {
    let mut lines: Vec<String> = Vec::new();
    if let Ok(notif) = n.Notification() {
        if let Ok(visual) = notif.Visual() {
            if let Ok(bindings) = visual.Bindings() {
                if let Ok(bsize) = bindings.Size() {
                    for i in 0..bsize {
                        let Ok(b) = bindings.GetAt(i) else { continue };
                        let Ok(els) = b.GetTextElements() else { continue };
                        let Ok(tsize) = els.Size() else { continue };
                        for j in 0..tsize {
                            let Ok(t) = els.GetAt(j) else { continue };
                            let Ok(s) = t.Text() else { continue };
                            let s = s.to_string_lossy();
                            let s = s.trim();
                            if !s.is_empty() {
                                lines.push(s.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    let title = lines.first().cloned().unwrap_or_default();
    let body = if lines.len() > 1 {
        lines[1..].join(" · ")
    } else {
        String::new()
    };
    (title, body)
}

/// 拉取通知中心里所有 toast（新的在前）
pub fn read_all() -> Result<Vec<SysNotif>, String> {
    let listener = listener_ready()?;

    let op = listener
        .GetNotificationsAsync(NotificationKinds::Toast)
        .map_err(|e| format!("get: {e}"))?;
    let list = op.join().map_err(|e| format!("join: {e}"))?;
    let size = list.Size().map_err(|e| format!("size: {e}"))?;

    let mut out: Vec<SysNotif> = Vec::with_capacity(size as usize);
    for i in 0..size {
        let Ok(n) = list.GetAt(i) else { continue };
        let id = n.Id().unwrap_or(0);
        let time = n
            .CreationTime()
            .map(|d| (d.UniversalTime - 116_444_736_000_000_000) / 10_000)
            .unwrap_or(0);
        let (app, aumid) = match n.AppInfo() {
            Ok(ai) => {
                let name = ai
                    .DisplayInfo()
                    .ok()
                    .and_then(|d| d.DisplayName().ok())
                    .map(|s| s.to_string_lossy())
                    .unwrap_or_default();
                let aum = ai
                    .AppUserModelId()
                    .map(|s| s.to_string_lossy())
                    .unwrap_or_default();
                (name, aum)
            }
            Err(_) => (String::new(), String::new()),
        };
        let (title, body) = texts_of(&n);
        out.push(SysNotif {
            id,
            app,
            aumid,
            title,
            body,
            time,
        });
    }
    out.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(out)
}

/// 拿到已授权的 listener（读/删共用）
fn listener_ready() -> Result<UserNotificationListener, String> {
    init_apartment();
    let listener = UserNotificationListener::Current().map_err(|e| format!("listener: {e}"))?;
    let status = listener
        .GetAccessStatus()
        .map_err(|e| format!("status: {e}"))?;
    if status != UserNotificationListenerAccessStatus::Allowed {
        let op = listener
            .RequestAccessAsync()
            .map_err(|e| format!("request: {e}"))?;
        let got = op.join().map_err(|e| format!("request-join: {e}"))?;
        if got != UserNotificationListenerAccessStatus::Allowed {
            return Err("denied".into());
        }
    }
    Ok(listener)
}

/// 删掉一条通知（从 Windows 通知中心移除）
pub fn remove_one(id: u32) -> Result<(), String> {
    let listener = listener_ready()?;
    listener
        .RemoveNotification(id)
        .map_err(|e| format!("remove: {e}"))
}

/// 清空通知中心里所有 toast
///
/// 注意：`ClearNotifications()` 在本机 Windows 11 Build 26300 上会抛
/// `Element not found (0x80070490)`，所以改成逐条 RemoveNotification。
pub fn clear_all() -> Result<(), String> {
    let listener = listener_ready()?;
    let op = listener
        .GetNotificationsAsync(NotificationKinds::Toast)
        .map_err(|e| format!("get: {e}"))?;
    let list = op.join().map_err(|e| format!("join: {e}"))?;
    let size = list.Size().map_err(|e| format!("size: {e}"))?;

    let mut ids: Vec<u32> = Vec::new();
    for i in 0..size {
        if let Ok(n) = list.GetAt(i) {
            if let Ok(id) = n.Id() {
                ids.push(id);
            }
        }
    }
    let mut last_err: Option<String> = None;
    for id in ids {
        if let Err(e) = listener.RemoveNotification(id) {
            last_err = Some(format!("{e}"));
        }
    }
    match last_err {
        Some(e) => Err(format!("remove: {e}")),
        None => Ok(()),
    }
}
