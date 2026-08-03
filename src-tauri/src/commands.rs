use crate::models::*;
use crate::state::AppState;
use crate::storage;
use chrono::Utc;
use tauri::Manager;
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
pub fn get_users_counts_batch(
    state: tauri::State<'_, AppState>,
    handles: Vec<String>,
) -> std::collections::HashMap<String, Option<TwitterUser>> {
    let mut cache = state.user_cache.lock().unwrap();
    let now = Utc::now();
    let mut result = std::collections::HashMap::new();

    for handle in handles {
        let lower = handle.to_lowercase();
        if let Some(user) = cache.get_mut(&lower) {
            user.last_accessed = Some(now);
            result.insert(lower, Some(user.clone()));
        } else {
            result.insert(lower, None);
        }
    }

    result
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

#[tauri::command]
pub fn save_tweets(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    tweets: Vec<InterceptedTweet>,
) -> Result<usize, String> {
    let mut state_tweets = state.tweets.lock().unwrap();
    for tweet in &tweets {
        if !state_tweets.iter().any(|t| t.tweet_id == tweet.tweet_id) {
            state_tweets.push(tweet.clone());
        }
    }
    drop(state_tweets);

    let conn = storage::open_db(&app)?;
    let mut count = 0;
    for tweet in &tweets {
        if storage::insert_tweet(&conn, tweet).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
pub fn get_tweet_stats_batch(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    tweet_ids: Vec<String>,
) -> std::collections::HashMap<String, Option<InterceptedTweet>> {
    let mut result = std::collections::HashMap::new();
    let state_tweets = state.tweets.lock().unwrap();
    let mut missing_ids = Vec::new();

    for id in &tweet_ids {
        if let Some(tweet) = state_tweets.iter().find(|t| &t.tweet_id == id) {
            result.insert(id.clone(), Some(tweet.clone()));
        } else {
            missing_ids.push(id.clone());
        }
    }
    drop(state_tweets);

    if !missing_ids.is_empty() {
        if let Ok(conn) = storage::open_db(&app) {
            if let Ok(db_tweets) = storage::get_tweets_by_ids(&conn, &missing_ids) {
                for tweet in db_tweets {
                    result.insert(tweet.tweet_id.clone(), Some(tweet));
                }
            }
        }
    }

    for id in tweet_ids {
        result.entry(id).or_insert(None);
    }

    result
}

#[tauri::command]
pub fn get_tweets_by_content_batch(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    snippets: Vec<String>,
) -> std::collections::HashMap<String, Option<InterceptedTweet>> {
    let mut result = std::collections::HashMap::new();
    let state_tweets = state.tweets.lock().unwrap();

    for snippet in &snippets {
        let clean_snippet = snippet.trim().to_lowercase();
        if clean_snippet.is_empty() {
            continue;
        }

        let found = state_tweets.iter().find(|t| {
            t.content.to_lowercase().contains(&clean_snippet)
        });

        if let Some(tweet) = found {
            result.insert(snippet.clone(), Some(tweet.clone()));
        }
    }
    drop(state_tweets);

    let missing_snippets: Vec<String> = snippets
        .iter()
        .filter(|s| !result.contains_key(*s))
        .cloned()
        .collect();

    if !missing_snippets.is_empty() {
        if let Ok(conn) = storage::open_db(&app) {
            if let Ok(db_tweets) = storage::get_tweets_by_content_snippets(&conn, &missing_snippets) {
                for snippet in &missing_snippets {
                    let clean_snippet = snippet.trim().to_lowercase();
                    let found = db_tweets.iter().find(|t| {
                        t.content.to_lowercase().contains(&clean_snippet)
                    });
                    if let Some(tweet) = found {
                        result.insert(snippet.clone(), Some(tweet.clone()));
                    }
                }
            }
        }
    }

    for snippet in snippets {
        result.entry(snippet).or_insert(None);
    }

    result
}

#[tauri::command]
pub fn save_last_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let clean_url = url.trim();
    if !clean_url.starts_with("https://x.com") && !clean_url.starts_with("https://twitter.com") {
        return Ok(());
    }

    if let Ok(conn) = storage::open_db(&app) {
        storage::set_setting(&conn, "last_url", clean_url)?;
    }
    Ok(())
}

// ── Decoupled Mode commands ──

#[tauri::command]
pub fn get_decouple_mode(app: tauri::AppHandle) -> bool {
    if let Ok(conn) = storage::open_db(&app) {
        if let Ok(Some(val)) = storage::get_setting(&conn, "decouple_x_ui") {
            return val == "true";
        }
    }
    false
}

#[tauri::command]
pub fn set_decouple_mode(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let conn = storage::open_db(&app)?;
    let val = if enabled { "true" } else { "false" };
    storage::set_setting(&conn, "decouple_x_ui", val)?;
    Ok(enabled)
}

// ── Manager commands ──

#[tauri::command]
pub fn clear_browser_cache(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let script = r#"
            try {
                if ('caches' in window) {
                    caches.keys().then(function(names) {
                        for (var name of names) caches.delete(name);
                    });
                }
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(function(registrations) {
                        for (var r of registrations) r.unregister();
                    });
                }
            } catch(e) {}
        "#;
        let _ = window.eval(script);
    }
    println!("[Tweeker] Browser cache cleared");
    Ok(())
}

#[tauri::command]
pub fn clear_site_data(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let script = r#"
            try {
                localStorage.clear();
                sessionStorage.clear();
                if (window.indexedDB && window.indexedDB.databases) {
                    window.indexedDB.databases().then(function(dbs) {
                        for (var db of dbs) {
                            if (db.name) window.indexedDB.deleteDatabase(db.name);
                        }
                    });
                }
            } catch(e) {}
        "#;
        let _ = window.eval(script);
    }
    println!("[Tweeker] Site data erased");
    Ok(())
}

#[tauri::command]
pub fn export_backup(payload: String, filename_hint: String) -> Result<Option<String>, String> {
    let file_path = rfd::FileDialog::new()
        .add_filter("JSON Backup", &["json"])
        .set_file_name(&filename_hint)
        .save_file();

    if let Some(path) = file_path {
        std::fs::write(&path, payload)
            .map_err(|e| format!("Failed to write backup file: {}", e))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn import_backup() -> Result<Option<(String, String)>, String> {
    let file_path = rfd::FileDialog::new()
        .add_filter("JSON Backup", &["json"])
        .pick_file();

    if let Some(path) = file_path {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read backup file: {}", e))?;
        Ok(Some((content, path.to_string_lossy().into_owned())))
    } else {
        Ok(None)
    }
}






