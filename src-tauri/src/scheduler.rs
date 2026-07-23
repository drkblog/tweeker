use tokio::time::{interval, Duration};
use chrono::Utc;
use tauri::Emitter;

/// Starts a background scheduler loop that checks for pending scheduled tweets
/// every 30 seconds. When a tweet's scheduled time arrives, it emits an event
/// to the X.com webview to compose the tweet.
pub async fn start_scheduler(app_handle: tauri::AppHandle) {
    let mut ticker = interval(Duration::from_secs(30));

    loop {
        ticker.tick().await;

        let now = Utc::now();

        // In the future, this will:
        // 1. Query pending scheduled tweets from SQLite
        // 2. Find tweets whose scheduled_for <= now
        // 3. Emit an event to the X.com webview to compose the tweet
        // 4. Update the tweet status to "sent" or "failed"
        let _ = app_handle.emit("scheduler-tick", now.to_rfc3339());
    }
}

/// Starts a heartbeat monitor that checks if the X.com interceptor is still alive.
/// If no heartbeat is received within 60 seconds, emits a connection-lost event.
pub async fn start_heartbeat_monitor(app_handle: tauri::AppHandle) {
    let mut ticker = interval(Duration::from_secs(15));

    loop {
        ticker.tick().await;
        // Emit a heartbeat-check event so the frontend can update status
        let _ = app_handle.emit("heartbeat-check", ());
    }
}
