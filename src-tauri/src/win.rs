#![allow(non_snake_case, non_camel_case_types, dead_code)]

//! 直接声明 Win32 接口，不依赖 windows crate 的版本命名。

use std::ffi::c_void;

pub type HWND = *mut c_void;
pub type HANDLE = *mut c_void;
pub type HINSTANCE = *mut c_void;
pub type HDC = *mut c_void;
pub type LPARAM = isize;
pub type WPARAM = usize;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C)]
pub struct LVITEMW {
    pub mask: u32,
    pub iItem: i32,
    pub iSubItem: i32,
    pub state: u32,
    pub stateMask: u32,
    pub pszText: *mut u16,
    pub cchTextMax: i32,
    pub iImage: i32,
    pub lParam: isize,
    pub iIndent: i32,
    pub iGroupId: i32,
    pub cColumns: u32,
    pub puColumns: *mut u32,
    pub piColFmt: *mut i32,
    pub iGroup: i32,
}

pub const LVM_GETITEMCOUNT: u32 = 0x1004;
pub const LVM_GETITEMPOSITION: u32 = 0x1010;
pub const LVM_SETITEMPOSITION: u32 = 0x100F;
pub const LVM_GETITEMTEXTW: u32 = 0x1073;
pub const LVM_GETITEMSPACING: u32 = 0x1033;
pub const LVM_GETORIGIN: u32 = 0x1029;

pub const LVIF_TEXT: u32 = 0x0001;

pub const PROCESS_VM_OPERATION: u32 = 0x0008;
pub const PROCESS_VM_READ: u32 = 0x0010;
pub const PROCESS_VM_WRITE: u32 = 0x0020;
pub const PROCESS_QUERY_INFORMATION: u32 = 0x0400;

pub const MEM_COMMIT: u32 = 0x1000;
pub const MEM_RESERVE: u32 = 0x2000;
pub const MEM_RELEASE: u32 = 0x8000;
pub const PAGE_READWRITE: u32 = 0x04;

pub const GWLP_WNDPROC: i32 = -4;
pub const GWL_EXSTYLE: i32 = -20;
pub const WS_EX_TRANSPARENT: isize = 0x0000_0020;
pub const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
pub const WS_EX_NOACTIVATE: isize = 0x0800_0000;

pub const WM_SYSCOMMAND: u32 = 0x0112;
pub const WM_NCHITTEST: u32 = 0x0084;
pub const WM_MOUSEACTIVATE: u32 = 0x0021;
pub const MA_NOACTIVATE: isize = 3;
pub const SC_MINIMIZE: usize = 0xF020;
pub const HTTRANSPARENT: isize = -1;
pub const HTCLIENT: isize = 1;

pub type HRGN = *mut c_void;
pub const RGN_OR: i32 = 2;
pub const RGN_COPY: i32 = 5;

pub const HWND_BOTTOM: HWND = 1 as HWND;
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const SWP_SHOWWINDOW: u32 = 0x0040;
pub const SWP_NOZORDER: u32 = 0x0004;

pub const SM_CXSCREEN: i32 = 0;
pub const SM_CYSCREEN: i32 = 1;
pub const SPI_GETWORKAREA: u32 = 0x0030;

#[link(name = "user32")]
extern "system" {
    pub fn FindWindowW(lpClassName: *const u16, lpWindowName: *const u16) -> HWND;
    pub fn FindWindowExW(
        hwndParent: HWND,
        hwndChildAfter: HWND,
        lpszClass: *const u16,
        lpszWindow: *const u16,
    ) -> HWND;
    pub fn SendMessageW(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> isize;
    pub fn GetWindowThreadProcessId(hwnd: HWND, pid: *mut u32) -> u32;
    pub fn EnumWindows(cb: extern "system" fn(HWND, LPARAM) -> i32, lparam: LPARAM) -> i32;
    pub fn GetClassNameW(hwnd: HWND, buf: *mut u16, n: i32) -> i32;
    pub fn GetCursorPos(p: *mut POINT) -> i32;
    pub fn SetWindowLongPtrW(hwnd: HWND, index: i32, value: isize) -> isize;
    pub fn GetWindowLongPtrW(hwnd: HWND, index: i32) -> isize;
    pub fn CallWindowProcW(
        prev: isize,
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> isize;
    pub fn SetWindowPos(
        hwnd: HWND,
        after: HWND,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    pub fn GetWindowRect(hwnd: HWND, r: *mut RECT) -> i32;
    pub fn GetSystemMetrics(index: i32) -> i32;
    pub fn SystemParametersInfoW(act: u32, a: u32, b: *mut c_void, c: u32) -> i32;
    pub fn IsWindow(hwnd: HWND) -> i32;
    pub fn ShowWindow(hwnd: HWND, cmd: i32) -> i32;
    pub fn SetParent(hwnd: HWND, parent: HWND) -> HWND;
    pub fn SetForegroundWindow(hwnd: HWND) -> i32;
    pub fn SetWindowRgn(hwnd: HWND, rgn: HRGN, redraw: i32) -> i32;
    pub fn CreateRectRgn(x1: i32, y1: i32, x2: i32, y2: i32) -> HRGN;
    pub fn CombineRgn(dst: HRGN, a: HRGN, b: HRGN, mode: i32) -> i32;
    pub fn DeleteObject(o: *mut c_void) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> HANDLE;
    pub fn CloseHandle(h: HANDLE) -> i32;
    pub fn VirtualAllocEx(
        h: HANDLE,
        addr: *mut c_void,
        size: usize,
        ty: u32,
        protect: u32,
    ) -> *mut c_void;
    pub fn VirtualFreeEx(h: HANDLE, addr: *mut c_void, size: usize, ty: u32) -> i32;
    pub fn WriteProcessMemory(
        h: HANDLE,
        addr: *mut c_void,
        buf: *const c_void,
        size: usize,
        written: *mut usize,
    ) -> i32;
    pub fn ReadProcessMemory(
        h: HANDLE,
        addr: *const c_void,
        buf: *mut c_void,
        size: usize,
        read: *mut usize,
    ) -> i32;
    pub fn CreateMutexW(attr: *mut c_void, owner: i32, name: *const u16) -> HANDLE;
    pub fn GetLastError() -> u32;
}

pub const ERROR_ALREADY_EXISTS: u32 = 183;

/// 单实例锁：同一时间只允许一个 tide-desk 在跑。
/// 两个实例会各自画一层组件，叠在一起看起来像重影。
/// 拿不到锁返回 false，调用方应直接退出。
pub fn single_instance() -> bool {
    unsafe {
        let name = wide("Global\\tide-desk-single-instance");
        let h = CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr());
        if h.is_null() {
            return true;
        }
        GetLastError() != ERROR_ALREADY_EXISTS
    }
}

pub const SW_HIDE: i32 = 0;
pub const SW_SHOW: i32 = 5;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
