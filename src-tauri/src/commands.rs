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
pub fn export_backup(
    app: tauri::AppHandle,
    payload: String,
    filename_hint: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let file_path = rfd::FileDialog::new()
            .add_filter("JSON Backup", &["json"])
            .set_file_name(&filename_hint)
            .save_file();
        let _ = tx.send(file_path);
    }).map_err(|e| format!("Failed to run on main thread: {}", e))?;

    let file_path = rx.recv().map_err(|e| format!("Failed to receive file path: {}", e))?;

    if let Some(path) = file_path {
        std::fs::write(&path, payload)
            .map_err(|e| format!("Failed to write backup file: {}", e))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn import_backup(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let file_path = rfd::FileDialog::new()
            .add_filter("JSON Backup", &["json"])
            .pick_file();
        let _ = tx.send(file_path);
    }).map_err(|e| format!("Failed to run on main thread: {}", e))?;

    let file_path = rx.recv().map_err(|e| format!("Failed to receive file path: {}", e))?;

    if let Some(path) = file_path {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read backup file: {}", e))?;
        Ok(Some((content, path.to_string_lossy().into_owned())))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn purge_user_and_tweet_storage(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = storage::open_db(&app)?;
    storage::purge_database(&conn)?;

    let mut tweets = state.tweets.lock().unwrap();
    tweets.clear();

    let mut user_cache = state.user_cache.lock().unwrap();
    user_cache.clear();

    println!("[Tweeker] Purged user cache and intercepted tweets storage");
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DiagnosticSystemInfo {
    pub os: String,
    pub arch: String,
    pub app_version: String,
    pub db_path: String,
}

#[tauri::command]
pub fn get_diagnostic_system_info(app: tauri::AppHandle) -> DiagnosticSystemInfo {
    DiagnosticSystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        db_path: storage::db_path_string(&app),
    }
}

#[tauri::command]
pub fn save_diagnostic_report(
    app: tauri::AppHandle,
    payload: String,
    filename_hint: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let file_path = rfd::FileDialog::new()
            .add_filter("Diagnostic Report", &["json", "txt"])
            .set_file_name(&filename_hint)
            .save_file();
        let _ = tx.send(file_path);
    }).map_err(|e| format!("Failed to run on main thread: {}", e))?;

    let file_path = rx.recv().map_err(|e| format!("Failed to receive file path: {}", e))?;

    if let Some(path) = file_path {
        std::fs::write(&path, payload)
            .map_err(|e| format!("Failed to write diagnostic file: {}", e))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
#[allow(unreachable_code)]
pub fn factory_reset(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 1. Wipe database
    let conn = storage::open_db(&app)?;
    storage::factory_reset(&conn)?;

    // 2. Wipe AppState in-memory structures
    state.tweets.lock().unwrap().clear();
    state.alarms.lock().unwrap().clear();
    state.scheduled_tweets.lock().unwrap().clear();
    state.user_cache.lock().unwrap().clear();

    println!("[Tweeker] Factory reset complete, restarting application...");
    
    // 3. Restart application
    app.restart();
    Ok(())
}

#[derive(serde::Serialize)]
struct CobaltRequest {
    url: String,
}

#[derive(serde::Deserialize)]
struct CobaltResponse {
    status: Option<String>,
    url: Option<String>,
    text: Option<String>,
}

#[tauri::command]
pub async fn download_video_stream(
    app: tauri::AppHandle,
    tweet_url: String,
) -> Result<Option<String>, String> {
    println!("[Tweeker Backend] Requesting video download for URL: {}", tweet_url);

    let status_id = tweet_url
        .split("/status/")
        .nth(1)
        .and_then(|s| s.split('?').next())
        .unwrap_or("video");
    let filename_hint = format!("tweeker_video_{}.mp4", status_id);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let apis = vec![
        "https://api.cobalt.tools/api/json",
        "https://api.cobalt.tools/",
        "https://dog.kittycat.boo",
        "https://cobaltapi.cjs.nz",
        "https://cobaltapi.kittycat.boo",
        "https://rue-cobalt.xenon.zone",
    ];

    let mut download_url = None;
    let mut last_error = "No API endpoints configured".to_string();

    for api_url in apis {
        println!("[Tweeker Backend] Trying Cobalt API endpoint: {}", api_url);
        let res_result = client
            .post(api_url)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&CobaltRequest { url: tweet_url.clone() })
            .send()
            .await;

        match res_result {
            Ok(res) => {
                if res.status().is_success() {
                    if let Ok(parsed) = res.json::<CobaltResponse>().await {
                        if let Some(status) = &parsed.status {
                            if status == "error" {
                                let msg = parsed.text.clone().unwrap_or_else(|| "Unknown API error".to_string());
                                last_error = format!("Endpoint {} returned error status: {}", api_url, msg);
                                continue;
                            }
                        }
                        if let Some(url) = parsed.url {
                            download_url = Some(url);
                            println!("[Tweeker Backend] Successfully resolved stream URL from: {}", api_url);
                            break;
                        } else {
                            last_error = format!("Endpoint {} response had no download URL", api_url);
                        }
                    } else {
                        last_error = format!("Failed to parse response JSON from {}", api_url);
                    }
                } else {
                    let status = res.status();
                    let err_text = res.text().await.unwrap_or_default();
                    last_error = format!("Endpoint {} returned status code {}: {}", api_url, status, err_text);
                }
            }
            Err(e) => {
                last_error = format!("Failed to reach endpoint {}: {}", api_url, e);
            }
        }
    }

    let download_url = match download_url {
        Some(url) => url,
        None => return Err(format!("All Cobalt mirrors failed. Last error: {}", last_error)),
    };

    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let file_path = rfd::FileDialog::new()
            .add_filter("MP4 Video", &["mp4"])
            .set_file_name(&filename_hint)
            .save_file();
        let _ = tx.send(file_path);
    })
    .map_err(|e| format!("Failed to prompt file dialog on main thread: {}", e))?;

    let file_path = rx
        .recv()
        .map_err(|e| format!("Failed to receive file path: {}", e))?;

    let path = match file_path {
        Some(p) => p,
        None => return Ok(None),
    };

    println!("[Tweeker Backend] Downloading video stream to: {}", path.display());

    let mut download_res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch video stream: {}", e))?;

    if !download_res.status().is_success() {
        return Err(format!(
            "Failed to fetch video stream: status code {}",
            download_res.status()
        ));
    }

    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create local destination file: {}", e))?;

    while let Some(chunk) = download_res.chunk().await.map_err(|e| format!("Failed to read stream chunk: {}", e))? {
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
    }

    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn open_google_search_window(
    app: tauri::AppHandle,
    query_encoded: String,
) -> Result<(), String> {
    println!("[Tweeker Backend] Opening Google Search window for encoded query: {}", query_encoded);

    let search_url = format!("https://www.google.com/search?q={}", query_encoded);
    let window_id = format!("search_{}", uuid::Uuid::new_v4().to_string());
    
    tauri::WebviewWindowBuilder::new(
        &app,
        &window_id,
        tauri::WebviewUrl::External(search_url.parse().unwrap()),
    )
    .title(format!("Google Search"))
    .inner_size(900.0, 700.0)
    .build()
    .map_err(|e| format!("Failed to build search window: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn open_gemini_grammar_window(
    app: tauri::AppHandle,
    text: String,
) -> Result<(), String> {
    println!("[Tweeker Backend] Opening Gemini window for text: {}", text);

    let gemini_url = "https://gemini.google.com/app";
    let window_id = format!("gemini_{}", uuid::Uuid::new_v4().to_string());

    let escaped_text = serde_json::to_string(&format!("Fix grammar: {}", text))
        .map_err(|e| format!("Failed to serialize text: {}", e))?;

    let init_script = format!(
        r#"
        (function() {{
            const promptText = {};
            console.log("[Tweeker Gemini] Injected init script. Prompt:", promptText);

            function tryInject() {{
                const input = document.querySelector('rich-textarea div[contenteditable="true"], div[contenteditable="true"]');
                if (input) {{
                    console.log("[Tweeker Gemini] Found input area. Injecting prompt.");
                    input.focus();
                    input.textContent = '';
                    document.execCommand('insertText', false, promptText);
                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));

                    setTimeout(() => {{
                        const btn = document.querySelector('button[aria-label*="Send"], button[aria-label*="prompt"], button[aria-label*="Submit"], .send-button-container button');
                        if (btn && !btn.disabled) {{
                            console.log("[Tweeker Gemini] Found send button. Clicking.");
                            btn.click();
                        }} else {{
                            console.log("[Tweeker Gemini] Send button not clickable. Dispatching Enter key.");
                            const enterEvent = new KeyboardEvent('keydown', {{
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true,
                                cancelable: true
                            }});
                            input.dispatchEvent(enterEvent);
                        }}
                    }}, 800);

                    clearInterval(injectInterval);
                }}
            }}

            const injectInterval = setInterval(tryInject, 1000);

            setTimeout(() => {{
                clearInterval(injectInterval);
            }}, 15000);
        }})();
        "#,
        escaped_text
    );

    tauri::WebviewWindowBuilder::new(
        &app,
        &window_id,
        tauri::WebviewUrl::External(gemini_url.parse().unwrap()),
    )
    .title(format!("Gemini Helper"))
    .inner_size(1000.0, 750.0)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("Failed to build Gemini helper window: {}", e))?;

    Ok(())
}









