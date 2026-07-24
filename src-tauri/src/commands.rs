use crate::models::*;
use crate::state::AppState;
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

#[tauri::command]
pub fn get_timeline_stats(state: tauri::State<'_, AppState>) -> TimelineStats {
    state.compute_stats()
}

// ── Alarm commands ──

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
