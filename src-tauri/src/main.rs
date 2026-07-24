#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod interceptor;
mod models;
mod scheduler;
mod state;
mod storage;

use state::AppState;
use tauri::Manager;

fn main() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::get_connection_status,
            commands::get_timeline_stats,
            commands::get_alarms,
            commands::create_alarm,
            commands::delete_alarm,
            commands::toggle_alarm,
            commands::get_scheduled_tweets,
            commands::create_scheduled_tweet,
            commands::delete_scheduled_tweet,
            commands::toggle_overlay,
            commands::get_auto_read,
            commands::set_auto_read,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Initialize database ──
            if let Ok(conn) = storage::open_db(&handle) {
                if let Err(e) = storage::run_migrations(&conn) {
                    eprintln!("[Tweeker] Database migration failed: {}", e);
                }
            } else {
                eprintln!("[Tweeker] Failed to open database");
            }

            // ── Create the main WebviewWindow loading X.com with injected scripts ──
            let injection_script = interceptor::build_injection_script();

            let _main_window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External("https://x.com".parse().unwrap()),
            )
            .title("Tweeker")
            .inner_size(1280.0, 900.0)
            .initialization_script(&injection_script)
            .on_navigation(|url| {
                let host = url.host_str().unwrap_or("");
                host == "x.com"
                    || host.ends_with(".x.com")
                    || host == "twitter.com"
                    || host.ends_with(".twitter.com")
                    || host.ends_with(".twimg.com")
                    || host == "api.x.com"
                    || host == "api.twitter.com"
            })
            .build()?;

            // ── Start background services ──
            let scheduler_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                scheduler::start_scheduler(scheduler_handle).await;
            });

            let heartbeat_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                scheduler::start_heartbeat_monitor(heartbeat_handle).await;
            });

            // Mark connection as loaded
            if let Some(state) = app.try_state::<AppState>() {
                let mut conn = state.connection.lock().unwrap();
                conn.x_webview_loaded = true;
                let mut session = state.session_start.lock().unwrap();
                *session = Some(chrono::Utc::now());
            }

            println!("[Tweeker] Application initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tweeker");
}
