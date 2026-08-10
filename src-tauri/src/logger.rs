use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use chrono::Local;
use tauri::Manager;

static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Initialize the central logging facility, overwriting the log file.
pub fn init(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_data = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    // Ensure parent directories exist
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    let log_path = app_data.join("tweeker.log");

    // Open file with write + create + truncate to overwrite on every run
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let _ = LOG_FILE.set(Mutex::new(file));
    let _ = LOG_PATH.set(log_path);

    Ok(())
}

/// Retrieve the absolute path to the log file.
pub fn get_log_path() -> Option<String> {
    LOG_PATH.get().map(|p| p.to_string_lossy().into_owned())
}

/// Log a message with a specific severity level.
pub fn log_msg(level: &str, msg: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let formatted = format!("[{}] [{}] {}\n", timestamp, level, msg);

    if let Some(mutex) = LOG_FILE.get() {
        if let Ok(mut file) = mutex.lock() {
            let _ = file.write_all(formatted.as_bytes());
            let _ = file.flush();
        }
    }
}

#[macro_export]
macro_rules! tlog {
    ($($arg:tt)*) => {
        $crate::logger::log_msg("INFO", &format!($($arg)*));
    };
}

#[macro_export]
macro_rules! tlog_err {
    ($($arg:tt)*) => {
        $crate::logger::log_msg("ERROR", &format!($($arg)*));
    };
}
