use crate::models::*;
use crate::state::AppState;
use crate::storage;
use chrono::Utc;
use uuid::Uuid;

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_connection_status(state: tauri::State<'_, AppState>) -> ConnectionStatus {
    let conn = state.connection.lock().unwrap();
    ConnectionStatus {
        x_webview_loaded: conn.x_webview_loaded,
        interceptor_active: conn.interceptor_active,
        last_heartbeat: conn.last_heartbeat,
    }
}

// ── Alarm commands ──

#[tauri::command]
pub fn get_timeline_stats(state: tauri::State<'_, AppState>) -> TimelineStats {
    state.compute_stats()
}

#[tauri::command]
pub fn get_alarms(state: tauri::State<'_, AppState>) -> Vec<Alarm> {
    state.alarms.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_alarm(
    state: tauri::State<'_, AppState>,
    request: CreateAlarmRequest,
) -> Result<Alarm, String> {
    let alarm = Alarm {
        id: Uuid::new_v4().to_string(),
        name: request.name,
        alarm_type: request.alarm_type,
        pattern: request.pattern,
        enabled: true,
        notify: request.notify.unwrap_or(false),
        created_at: Utc::now(),
        last_triggered: None,
    };

    state.alarms.lock().unwrap().push(alarm.clone());
    Ok(alarm)
}

#[tauri::command]
pub fn delete_alarm(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut alarms = state.alarms.lock().unwrap();
    let len_before = alarms.len();
    alarms.retain(|a| a.id != id);
    if alarms.len() == len_before {
        return Err(format!("Alarm not found: {}", id));
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_alarm(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut alarms = state.alarms.lock().unwrap();
    if let Some(alarm) = alarms.iter_mut().find(|a| a.id == id) {
        alarm.enabled = enabled;
        Ok(())
    } else {
        Err(format!("Alarm not found: {}", id))
    }
}

#[tauri::command]
pub fn toggle_alarm_notify(
    state: tauri::State<'_, AppState>,
    id: String,
    notify: bool,
) -> Result<(), String> {
    let mut alarms = state.alarms.lock().unwrap();
    if let Some(alarm) = alarms.iter_mut().find(|a| a.id == id) {
        alarm.notify = notify;
        Ok(())
    } else {
        Err(format!("Alarm not found: {}", id))
    }
}

// ── Scheduled tweet commands ──

#[tauri::command]
pub fn get_scheduled_tweets(state: tauri::State<'_, AppState>) -> Vec<ScheduledTweet> {
    state.scheduled_tweets.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_scheduled_tweet(
    state: tauri::State<'_, AppState>,
    content: String,
    scheduled_for: String,
) -> Result<ScheduledTweet, String> {
    let scheduled_time = chrono::DateTime::parse_from_rfc3339(&scheduled_for)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| format!("Invalid date format: {}", e))?;

    if scheduled_time <= Utc::now() {
        return Err("Scheduled time must be in the future".to_string());
    }

    let tweet = ScheduledTweet {
        id: Uuid::new_v4().to_string(),
        content,
        scheduled_for: scheduled_time,
        status: TweetStatus::Pending,
        created_at: Utc::now(),
    };

    state.scheduled_tweets.lock().unwrap().push(tweet.clone());
    Ok(tweet)
}

#[tauri::command]
pub fn delete_scheduled_tweet(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut tweets = state.scheduled_tweets.lock().unwrap();
    let len_before = tweets.len();
    tweets.retain(|t| t.id != id);
    if tweets.len() == len_before {
        return Err(format!("Scheduled tweet not found: {}", id));
    }
    Ok(())
}

// ── Overlay toggle & Auto read ──

#[tauri::command]
pub fn toggle_overlay(state: tauri::State<'_, AppState>) -> bool {
    let mut visible = state.overlay_visible.lock().unwrap();
    *visible = !*visible;
    *visible
}

#[tauri::command]
pub fn get_auto_read(state: tauri::State<'_, AppState>) -> bool {
    *state.auto_read.lock().unwrap()
}

#[tauri::command]
pub fn set_auto_read(state: tauri::State<'_, AppState>, enabled: bool) -> bool {
    let mut auto_read = state.auto_read.lock().unwrap();
    *auto_read = enabled;
    *auto_read
}

// ── Twitter User Cache commands ──

#[tauri::command]
pub fn get_user_cache_limit(state: tauri::State<'_, AppState>) -> usize {
    *state.user_cache_limit.lock().unwrap()
}

#[tauri::command]
pub fn set_user_cache_limit(state: tauri::State<'_, AppState>, limit: usize) {
    let mut cache_limit = state.user_cache_limit.lock().unwrap();
    *cache_limit = limit;

    // If limit decreased, evict excess elements
    let mut cache = state.user_cache.lock().unwrap();
    let now = Utc::now();
    while cache.len() > limit {
        let oldest_key = cache
            .iter()
            .min_by_key(|(_, user)| user.last_accessed.unwrap_or(now))
            .map(|(key, _)| key.clone());

        if let Some(key) = oldest_key {
            cache.remove(&key);
        } else {
            break;
        }
    }
}

#[tauri::command]
pub fn get_cached_user(
    state: tauri::State<'_, AppState>,
    handle: String,
) -> Option<TwitterUser> {
    let mut cache = state.user_cache.lock().unwrap();
    if let Some(user) = cache.get_mut(&handle.to_lowercase()) {
        user.last_accessed = Some(Utc::now());
        Some(user.clone())
    } else {
        None
    }
}

#[tauri::command]
pub fn get_all_cached_users(
    state: tauri::State<'_, AppState>,
) -> std::collections::HashMap<String, TwitterUser> {
    let cache = state.user_cache.lock().unwrap();
    cache.clone()
}

#[tauri::command]
pub fn add_multiple_to_user_cache(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    users: std::collections::HashMap<String, TwitterUser>,
) {
    let mut cache = state.user_cache.lock().unwrap();
    let limit = *state.user_cache_limit.lock().unwrap();
    let now = Utc::now();

    // Collect the new/updated entries for DB persistence
    let mut to_persist = std::collections::HashMap::new();

    for (handle, mut user) in users {
        user.last_accessed = Some(now);
        let lh = handle.to_lowercase();
        to_persist.insert(lh.clone(), user.clone());
        cache.insert(lh, user);
    }

    // Evict if limit exceeded
    while cache.len() > limit {
        let oldest_key = cache
            .iter()
            .min_by_key(|(_, user)| user.last_accessed.unwrap_or(now))
            .map(|(key, _)| key.clone());

        if let Some(key) = oldest_key {
            cache.remove(&key);
        } else {
            break;
        }
    }

    // Write-through: persist new entries to SQLite
    drop(cache); // release lock before DB I/O
    if let Ok(conn) = storage::open_db(&app) {
        if let Err(e) = storage::save_user_cache_batch(&conn, &to_persist) {
            eprintln!("[Tweeker] Failed to persist user cache batch: {}", e);
        }
    }
}

// ── Database Statistics commands ──

#[tauri::command]
pub fn get_db_path(app: tauri::AppHandle) -> String {
    storage::db_path_string(&app)
}

#[tauri::command]
pub fn get_db_stats(app: tauri::AppHandle) -> Result<DbStats, String> {
    let conn = storage::open_db(&app)?;
    storage::get_db_stats(&app, &conn)
}
