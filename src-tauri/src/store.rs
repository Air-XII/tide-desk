use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn state_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let d = PathBuf::from(base).join("tide-desk");
    let _ = std::fs::create_dir_all(&d);
    d
}

pub fn state_file() -> PathBuf {
    state_dir().join("state.json")
}

pub fn snapshot_file() -> PathBuf {
    state_dir().join("desk-snapshot.json")
}

pub fn backup_dir() -> PathBuf {
    state_dir().join("backups")
}

/// 最多留几份备份
const KEEP_BACKUPS: usize = 12;
/// 两次备份之间至少隔多久（秒），防止拖组件时刷出一堆
const BACKUP_MIN_GAP_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedIcon {
    pub name: String,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub taken_at: String,
    pub icons: Vec<SavedIcon>,
}

/// 原子写：先写同目录的 .tmp，fsync 落盘，再 rename 覆盖。
/// rename 在同一卷上是原子的，所以中途断电最多丢掉这一次改动，
/// 不会留下半截 JSON 把老数据也一起毁掉。
pub fn write_atomic(p: &PathBuf, s: &str) -> Result<(), String> {
    use std::io::Write;
    let dir = p.parent().ok_or_else(|| "没有父目录".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("state.json");
    let tmp = dir.join(format!(".{name}.tmp"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn backup_list() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(backup_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("state-") && n.ends_with(".json"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// 覆盖之前先把「当前这份」存进 backups/。
/// 内容跟最近一份一样就不存；距离上次不到 5 分钟也不存；只留最近 12 份。
pub fn backup_current() {
    let Ok(old) = std::fs::read_to_string(state_file()) else {
        return;
    };
    if old.trim().is_empty() {
        return;
    }
    let dir = backup_dir();
    let _ = std::fs::create_dir_all(&dir);
    let list = backup_list();
    if let Some(last) = list.last() {
        if let Ok(prev) = std::fs::read_to_string(last) {
            if prev == old {
                return;
            }
        }
        if let Ok(meta) = std::fs::metadata(last) {
            if let Ok(modi) = meta.modified() {
                if let Ok(d) = std::time::SystemTime::now().duration_since(modi) {
                    if d.as_secs() < BACKUP_MIN_GAP_SECS {
                        return;
                    }
                }
            }
        }
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let _ = write_atomic(&dir.join(format!("state-{stamp}.json")), &old);
    let list = backup_list();
    if list.len() > KEEP_BACKUPS {
        for p in &list[..list.len() - KEEP_BACKUPS] {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// 备份目录概况，给前端显示用
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub count: usize,
    pub dir: String,
    pub latest: Option<String>,
}

pub fn backup_info() -> BackupInfo {
    let list = backup_list();
    BackupInfo {
        count: list.len(),
        dir: backup_dir().display().to_string(),
        latest: list
            .last()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
    }
}

pub fn write_json<T: Serialize>(p: &PathBuf, v: &T) -> Result<(), String> {
    let s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    write_atomic(p, &s)
}

pub fn read_json<T: for<'a> Deserialize<'a>>(p: &PathBuf) -> Option<T> {
    let s = std::fs::read_to_string(p).ok()?;
    // 手工编辑过的文件可能带 UTF-8 BOM，serde_json 不认
    let s = s.trim_start_matches('\u{feff}');
    serde_json::from_str(s).ok()
}
