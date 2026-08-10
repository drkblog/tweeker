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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::get_connection_status,
            commands::get_timeline_stats,
            commands::get_alarms,
            commands::create_alarm,
            commands::delete_alarm,
            commands::toggle_alarm,
            commands::toggle_alarm_notify,
            commands::get_scheduled_tweets,
            commands::create_scheduled_tweet,
            commands::delete_scheduled_tweet,
            commands::toggle_overlay,
            commands::get_auto_read,
            commands::set_auto_read,
            commands::get_user_cache_limit,
            commands::set_user_cache_limit,
            commands::get_cached_user,
            commands::get_users_counts_batch,
            commands::get_all_cached_users,
            commands::add_multiple_to_user_cache,
            commands::get_db_path,
            commands::get_db_stats,
            commands::save_tweets,
            commands::get_tweet_stats_batch,
            commands::get_tweets_by_content_batch,
            commands::save_last_url,
            commands::get_decouple_mode,
            commands::set_decouple_mode,
            commands::clear_browser_cache,
            commands::clear_site_data,
            commands::export_backup,
            commands::import_backup,
            commands::purge_user_and_tweet_storage,
            commands::get_diagnostic_system_info,
            commands::save_diagnostic_report,
            commands::factory_reset,
            commands::download_video_stream,
            commands::open_google_search_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Native OS Menu setup ──
            if let Ok(conn) = storage::open_db(&handle) {
                let is_decoupled = storage::get_setting(&conn, "decouple_x_ui")
                    .ok()
                    .flatten()
                    .map(|v| v == "true")
                    .unwrap_or(false);

                if let Ok(decouple_item) = tauri::menu::CheckMenuItemBuilder::new("Decoupled Mode (No Page Modifications)")
                    .id("toggle_decoupled_mode")
                    .checked(is_decoupled)
                    .build(app)
                {
                    let app_menu_opt = tauri::menu::SubmenuBuilder::new(app, "Tweeker")
                        .about(None)
                        .separator()
                        .item(&decouple_item)
                        .separator()
                        .services()
                        .separator()
                        .hide()
                        .hide_others()
                        .show_all()
                        .separator()
                        .quit()
                        .build();

                    let edit_menu_opt = tauri::menu::SubmenuBuilder::new(app, "Edit")
                        .undo()
                        .redo()
                        .separator()
                        .cut()
                        .copy()
                        .paste()
                        .select_all()
                        .build();

                    let mut window_menu = tauri::menu::SubmenuBuilder::new(app, "Window");
                    if let Ok(item) = tauri::menu::PredefinedMenuItem::minimize(app, None) { window_menu = window_menu.item(&item); }
                    if let Ok(item) = tauri::menu::PredefinedMenuItem::fullscreen(app, None) { window_menu = window_menu.item(&item); }
                    if let Ok(item) = tauri::menu::PredefinedMenuItem::close_window(app, None) { window_menu = window_menu.item(&item); }
                    window_menu = window_menu.separator();
                    if let Ok(item) = tauri::menu::PredefinedMenuItem::bring_all_to_front(app, None) { window_menu = window_menu.item(&item); }
                    let window_menu_opt = window_menu.build();

                    if let (Ok(app_menu), Ok(edit_menu), Ok(window_menu)) = (app_menu_opt, edit_menu_opt, window_menu_opt) {
                        if let Ok(menu) = tauri::menu::MenuBuilder::new(app)
                            .items(&[&app_menu, &edit_menu, &window_menu])
                            .build()
                        {
                            let _ = app.set_menu(menu);
                        }
                    }

                    app.on_menu_event(move |app_handle, event| {
                        if event.id() == "toggle_decoupled_mode" {
                            if let Ok(conn) = storage::open_db(app_handle) {
                                let cur = storage::get_setting(&conn, "decouple_x_ui")
                                    .ok()
                                    .flatten()
                                    .map(|v| v == "true")
                                    .unwrap_or(false);
                                let new_val = !cur;
                                if storage::set_setting(&conn, "decouple_x_ui", if new_val { "true" } else { "false" }).is_ok() {
                                    let _ = decouple_item.set_checked(new_val);
                                    println!("[Tweeker] Decoupled mode set to {} via OS menu, reloading window...", new_val);
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        let script = format!(
                                            "try {{ localStorage.setItem('tweeker_decouple_mode', '{}'); }} catch(e){{}} window.__TWEEKER_DECOUPLED__ = {}; window.location.reload();",
                                            if new_val { "true" } else { "false" },
                                            new_val
                                        );
                                        let _ = window.eval(&script);
                                    }
                                }
                            }
                        }
                    });
                }
            }

            let mut start_url = "https://x.com".to_string();

            // ── Initialize database ──
            if let Ok(conn) = storage::open_db(&handle) {
                if let Err(e) = storage::run_migrations(&conn) {
                    eprintln!("[Tweeker] Database migration failed: {}", e);
                }

                // Check for saved last URL
                if let Ok(Some(saved_url)) = storage::get_setting(&conn, "last_url") {
                    let clean = saved_url.trim();
                    if clean.starts_with("https://x.com") || clean.starts_with("https://twitter.com") {
                        start_url = clean.to_string();
                        println!("[Tweeker] Restoring last URL on startup: {}", start_url);
                    }
                }

                // Load persisted user cache from SQLite into in-memory HashMap
                match storage::load_user_cache(&conn) {
                    Ok(cached_users) => {
                        if !cached_users.is_empty() {
                            let count = cached_users.len();
                            let state = app.state::<AppState>();
                            let mut cache = state.user_cache.lock().unwrap();
                            *cache = cached_users;
                            println!("[Tweeker] Loaded {} users from persistent cache", count);
                        }
                    }
                    Err(e) => {
                        eprintln!("[Tweeker] Failed to load user cache: {}", e);
                    }
                }

                // Load persisted tweets from SQLite into AppState
                match storage::load_all_tweets(&conn) {
                    Ok(tweets) => {
                        if !tweets.is_empty() {
                            let count = tweets.len();
                            let state = app.state::<AppState>();
                            let mut state_tweets = state.tweets.lock().unwrap();
                            *state_tweets = tweets;
                            println!("[Tweeker] Loaded {} tweets from persistent storage", count);
                        }
                    }
                    Err(e) => {
                        eprintln!("[Tweeker] Failed to load tweets: {}", e);
                    }
                }
            } else {
                eprintln!("[Tweeker] Failed to open database");
            }

            // ── Create the main WebviewWindow loading X.com with injected scripts ──
            let injection_script = interceptor::build_injection_script(&handle);

            let _main_window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(start_url.parse().unwrap()),
            )
            .title("Tweeker")
            .inner_size(1280.0, 900.0)
            .initialization_script(&injection_script)
            .on_navigation(|url| {
                let scheme = url.scheme();
                scheme == "http" || scheme == "https"
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
