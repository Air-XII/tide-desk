#![allow(non_snake_case)]

//! 桌面图标读取与摆放。
//!
//! 读：找到桌面的 SysListView32，用 LVM_GETITEMCOUNT / LVM_GETITEMTEXTW /
//!     LVM_GETITEMPOSITION 跨进程取名字与坐标。
//! 写：LVM_SETITEMPOSITION 批量摆位（lParam 打包坐标，不需要远程指针）。

use crate::win::*;
use serde::Serialize;
use std::ffi::c_void;

#[derive(Debug, Clone, Serialize)]
pub struct IconInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeskSnapshot {
    pub icons: Vec<IconInfo>,
    pub cell_w: i32,
    pub cell_h: i32,
    pub screen_w: i32,
    pub screen_h: i32,
    pub ok: bool,
    pub error: Option<String>,
}

fn find_defview() -> Option<HWND> {
    unsafe {
        let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
        if !progman.is_null() {
            let dv = FindWindowExW(
                progman,
                std::ptr::null_mut(),
                wide("SHELLDLL_DefView").as_ptr(),
                std::ptr::null(),
            );
            if !dv.is_null() {
                return Some(dv);
            }
        }
    }
    // 壁纸被 WorkerW 接管时，SHELLDLL_DefView 挂在某个 WorkerW 下
    static mut FOUND: HWND = std::ptr::null_mut();
    unsafe {
        FOUND = std::ptr::null_mut();
        extern "system" fn cb(h: HWND, _l: LPARAM) -> i32 {
            unsafe {
                let mut buf = [0u16; 64];
                let n = GetClassNameW(h, buf.as_mut_ptr(), 64);
                if n <= 0 {
                    return 1;
                }
                let cls = String::from_utf16_lossy(&buf[..n as usize]);
                if cls == "WorkerW" {
                    let dv = FindWindowExW(
                        h,
                        std::ptr::null_mut(),
                        wide("SHELLDLL_DefView").as_ptr(),
                        std::ptr::null(),
                    );
                    if !dv.is_null() {
                        FOUND = dv;
                        return 0;
                    }
                }
            }
            1
        }
        EnumWindows(cb, 0);
        if FOUND.is_null() {
            None
        } else {
            Some(FOUND)
        }
    }
}

fn find_listview() -> Option<(HWND, u32)> {
    let dv = find_defview()?;
    unsafe {
        let lv = FindWindowExW(
            dv,
            std::ptr::null_mut(),
            wide("SysListView32").as_ptr(),
            std::ptr::null(),
        );
        if lv.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(lv, &mut pid);
        if pid == 0 {
            return None;
        }
        Some((lv, pid))
    }
}

/// 跨进程读写用的远程缓冲
struct Remote {
    handle: HANDLE,
    addr: *mut c_void,
    size: usize,
}

impl Remote {
    unsafe fn new(pid: u32, size: usize) -> Option<Self> {
        let handle = OpenProcess(
            PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION,
            0,
            pid,
        );
        if handle.is_null() {
            return None;
        }
        let addr = VirtualAllocEx(handle, std::ptr::null_mut(), size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if addr.is_null() {
            CloseHandle(handle);
            return None;
        }
        Some(Remote { handle, addr, size })
    }

    unsafe fn write<T>(&self, data: &T) {
        let mut n = 0usize;
        WriteProcessMemory(
            self.handle,
            self.addr,
            data as *const T as *const c_void,
            std::mem::size_of::<T>(),
            &mut n,
        );
    }

    unsafe fn write_bytes(&self, data: &[u8]) {
        let mut n = 0usize;
        WriteProcessMemory(
            self.handle,
            self.addr,
            data.as_ptr() as *const c_void,
            data.len(),
            &mut n,
        );
    }

    unsafe fn read<T: Default>(&self) -> T {
        let mut v = T::default();
        let mut n = 0usize;
        ReadProcessMemory(
            self.handle,
            self.addr as *const c_void,
            &mut v as *mut T as *mut c_void,
            std::mem::size_of::<T>(),
            &mut n,
        );
        v
    }
}

impl Drop for Remote {
    fn drop(&mut self) {
        unsafe {
            VirtualFreeEx(self.handle, self.addr, 0, MEM_RELEASE);
            CloseHandle(self.handle);
        }
    }
}

pub fn read_icons() -> DeskSnapshot {
    let mut out = DeskSnapshot {
        icons: vec![],
        cell_w: 76,
        cell_h: 100,
        screen_w: 0,
        screen_h: 0,
        ok: false,
        error: None,
    };
    unsafe {
        out.screen_w = GetSystemMetrics(SM_CXSCREEN);
        out.screen_h = GetSystemMetrics(SM_CYSCREEN);
    }
    let (lv, pid) = match find_listview() {
        Some(v) => v,
        None => {
            out.error = Some("找不到桌面图标列表（Explorer 未运行？）".into());
            return out;
        }
    };

    unsafe {
        let count = SendMessageW(lv, LVM_GETITEMCOUNT, 0, 0) as i32;
        if count <= 0 {
            out.error = Some("桌面没有图标".into());
            return out;
        }

        // 图标格子尺寸
        let sp = SendMessageW(lv, LVM_GETITEMSPACING, 0, 0) as u32;
        if sp != 0 {
            let cx = (sp & 0xFFFF) as i32;
            let cy = ((sp >> 16) & 0xFFFF) as i32;
            if cx > 0 && cy > 0 {
                out.cell_w = cx;
                out.cell_h = cy;
            }
        }

        // 一块远程内存同时放 LVITEMW 和文本缓冲
        const TEXT_MAX: usize = 520;
        let item_size = std::mem::size_of::<LVITEMW>();
        let remote = match Remote::new(pid, item_size + TEXT_MAX * 2) {
            Some(r) => r,
            None => {
                out.error = Some("OpenProcess / VirtualAllocEx 失败（权限不足？）".into());
                return out;
            }
        };
        let text_addr = remote.addr as usize + item_size;

        let mut icons = Vec::with_capacity(count as usize);
        for i in 0..count {
            // 每次都要清零文本缓冲，否则上一次的长名字会残留在尾巴上
            let zero = vec![0u8; TEXT_MAX * 2];
            remote.write_bytes(&zero);

            let mut item = LVITEMW {
                mask: LVIF_TEXT,
                iItem: i,
                iSubItem: 0,
                state: 0,
                stateMask: 0,
                pszText: text_addr as *mut u16,
                cchTextMax: TEXT_MAX as i32,
                iImage: 0,
                lParam: 0,
                iIndent: 0,
                iGroupId: 0,
                cColumns: 0,
                puColumns: std::ptr::null_mut(),
                piColFmt: std::ptr::null_mut(),
                iGroup: 0,
            };
            remote.write(&mut item);
            let n = SendMessageW(lv, LVM_GETITEMTEXTW, i as WPARAM, remote.addr as LPARAM) as i32;

            let mut buf = vec![0u8; TEXT_MAX * 2];
            let mut read = 0usize;
            ReadProcessMemory(
                remote.handle,
                text_addr as *const c_void,
                buf.as_mut_ptr() as *mut c_void,
                TEXT_MAX * 2,
                &mut read,
            );
            let chars: Vec<u16> = buf
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .take(if n > 0 { (n as usize).min(TEXT_MAX) } else { 0 })
                .collect();
            let name = String::from_utf16_lossy(&chars);

            // 坐标
            let mut pos = POINT::default();
            remote.write(&mut pos);
            let ok = SendMessageW(
                lv,
                LVM_GETITEMPOSITION,
                i as WPARAM,
                remote.addr as LPARAM,
            );
            if ok != 0 {
                pos = remote.read::<POINT>();
            }

            icons.push(IconInfo {
                name,
                x: pos.x,
                y: pos.y,
            });
        }
        out.icons = icons;
        out.ok = true;
    }
    out
}

/// 按名字批量摆位。positions: (名字, x, y)
pub fn set_positions(positions: &[(String, i32, i32)]) -> Result<usize, String> {
    let (lv, pid) = find_listview().ok_or_else(|| "找不到桌面图标列表".to_string())?;
    let snap = read_icons();
    if !snap.ok {
        return Err(snap.error.unwrap_or_else(|| "读桌面失败".into()));
    }
    let mut moved = 0usize;
    // 同名图标可能有两个（用户桌面 + 公共桌面各一份），
    // 所以每次匹配后要把那个索引「用掉」，否则两个都摆到同一个坐标，
    // 剩下那个就孤零零留在原地。
    let mut used = vec![false; snap.icons.len()];
    unsafe {
        let _ = pid;
        for (name, x, y) in positions {
            let hit = snap
                .icons
                .iter()
                .enumerate()
                .position(|(i, ic)| !used[i] && &ic.name == name);
            if let Some(idx) = hit {
                used[idx] = true;
                let lp = (((y & 0xFFFF) << 16) | (x & 0xFFFF)) as LPARAM;
                SendMessageW(lv, LVM_SETITEMPOSITION, idx as WPARAM, lp);
                moved += 1;
            }
        }
    }
    Ok(moved)
}

/// 读桌面目录里的文件名，用于推断每个图标是什么类型
pub fn desktop_files() -> Vec<(String, String)> {
    // 返回 (显示名, 扩展名小写)
    let mut out = Vec::new();
    let mut dirs = Vec::new();
    if let Ok(p) = std::env::var("USERPROFILE") {
        dirs.push(format!("{}\\Desktop", p));
    }
    dirs.push("C:\\Users\\Public\\Desktop".to_string());

    for d in dirs {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                let stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let is_dir = p.is_dir();
                let ext = if is_dir {
                    "folder".to_string()
                } else {
                    p.extension()
                        .map(|s| s.to_string_lossy().to_lowercase())
                        .unwrap_or_default()
                };
                if !stem.is_empty() {
                    out.push((stem, ext));
                }
            }
        }
    }
    out
}

/// 整理模式下隐藏 / 恢复 Explorer 画的桌面图标
pub fn set_icons_visible(visible: bool) -> bool {
    let Some((lv, _)) = find_listview() else {
        return false;
    };
    unsafe {
        ShowWindow(lv, if visible { SW_SHOW } else { SW_HIDE });
    }
    true
}