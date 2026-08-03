# Project Guidelines & Agent Rules for Tweeker

`Tweeker` is a cross-platform desktop application built with Tauri v2 (Rust) and a Vanilla JS/CSS frontend that wraps X.com (Twitter) with power-user features: timeline interception, statistics, alarms, scheduled tweets, and extensible automation.

## Technology Stack & Architecture

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+). The control panel is a floating glassmorphism overlay drawer injected directly over the X.com webview.
- **Backend**: Rust with Tauri v2 (`src-tauri`), Tokio async runtime (`tauri::async_runtime`), SQLite via `rusqlite` for persistence.
- **X.com Integration**: Native Tauri `WebviewWindow` loading X.com directly as an external URL. JavaScript injection via `initialization_script` bundles:
  - `bridge.js` (message channel: webview → Rust backend / local listeners)
  - `interceptor.js` (fetch/XHR monkey-patch + debounced DOM MutationObserver)
  - `style.css` (overlay styling scoped strictly to `#tweeker-overlay-container`)
  - `index.html` overlay DOM elements & `app.js` (control panel state manager)

## Project Structure

```
src-tauri/src/
├── main.rs           # Entry point, Tauri builder, WebviewWindow setup
├── commands.rs       # All #[tauri::command] IPC handlers
├── state.rs          # Shared AppState with Mutex-wrapped fields
├── models.rs         # Serde-serializable data models
├── storage.rs        # SQLite persistence (migrations, CRUD)
├── scheduler.rs      # Async tweet scheduler & heartbeat monitor
└── interceptor.rs    # Bundles injected scripts + overlay DOM/CSS/JS

src-inject/           # JS scripts injected into X.com webview
├── interceptor.js    # fetch/XHR monkey-patch + debounced DOM MutationObserver
└── bridge.js         # Message bridge via window.postMessage

src-frontend/         # Local control panel overlay UI & styling
├── index.html        # Overlay panel template
├── style.css         # Design system & widget styles
└── app.js            # Overlay state management, tab logic & IPC handlers
```

## Versioning & Releases

- **Current Version**: `1.0.1`
- **Single Source of Truth**: The app version is set in `src-tauri/Cargo.toml` (`version = "1.0.0"`) and mirrored in `src-tauri/tauri.conf.json`.
- **Incrementing Version**: To increment the version, edit `version` in `Cargo.toml` and `tauri.conf.json`. The backend `get_app_version()` command uses `env!("CARGO_PKG_VERSION")` and updates automatically across the app.
- **Roadmap & Feature Tracking**: Future features, optimizations, and developmental tasks are tracked in [ROADMAP.md](file:///c:/Users/Leandro/repos/tweeker/ROADMAP.md) at the repository root. Any agent implementing a feature from the roadmap MUST update its status in `ROADMAP.md` accordingly.

## Code Style & Guidelines

### Frontend (HTML / CSS / JS)
- All CSS in `src-frontend/style.css` **MUST be scoped strictly** to `#tweeker-overlay-container` (e.g. `#tweeker-overlay-container *, #tweeker-overlay-container .class`), with the sole exception of injected markup styling targeting elements outside the overlay (like `.tweeker-tweet-user-stats` and `.tweeker-user-info-btn`), which must be prefixed with `tweeker-` to prevent collisions.
- **NEVER** apply `pointer-events: none`, `overflow: hidden`, or global resets (`* { margin: 0 }`) directly to `body` or X.com elements.
- The control panel is a **floating glass drawer** with inset margins (`top: 16px; right: 16px; bottom: 16px; height: calc(100vh - 32px)`), rounded corners (`border-radius: 16px`), and width `380px`.
- The floating toggle button (`.overlay-toggle`) is **draggable by the user** so they can uncover UI elements behind it. Drag position is saved in `localStorage` (`tweeker_toggle_pos`).
- The **overlay panel open/closed state** is persisted in `localStorage` (`tweeker_panel_open`) and automatically restored when the app restarts.
- Header includes a **Copy URL button** (`#copy-url-btn`) that copies `window.location.href` to clipboard with a visual feedback toast (`#copy-url-toast`).
- The status bar contains an **Auto read toggle** (`#auto-read-toggle`), off by default. A startup setting in Settings ("Auto read on app start", stored in `localStorage` as `tweeker_autoread_on_start`) automatically activates Auto read when the app opens.
- When **Auto read** is enabled, `interceptor.js` automatically clicks X.com floating "New Tweets" pill buttons as they appear and processes all incoming timeline messages immediately.
- The **Manager tab** (`data-tab="manager"`, `#content-manager`) positioned after Settings houses application management actions, including **Clean cache** (`#clean-cache-btn`), **Delete site data** (`#delete-site-data-btn`, requiring confirmation modal `#tweeker-modal-overlay`), and the **Database & Diagnostics** section (`#settings-db-path`, `#dump-db-stats-btn`).

### Backend (Rust / Tauri v2)
- Retain proper error handling (`Result<T, String>`) for all `#[tauri::command]` handlers.
- Background async tasks started in `setup()` **MUST use `tauri::async_runtime::spawn`**, NEVER direct `tokio::spawn` (which causes Tokio reactor panics on the GUI thread).
- Use `AppState` in `state.rs` as the single shared state managed by Tauri.
- All database operations go through `storage.rs`. Do not use raw SQL in command handlers.
- **Database Statistics & Persistence Guidelines**: On startup, `app.js` queries `get_db_stats` and emits a system log line containing database statistics (`cached_users_count`, `total_tweets`, `total_alarms`, `total_scheduled_tweets`, `db_size_bytes`). **New features that add database entities or persistence MUST update `DbStats` in `storage.rs` and the startup database statistics log line in `app.js` to include relevant statistics for the new entity.** Manager tab displays the read-only SQLite database path (`#settings-db-path`) and database statistics dump action (`#dump-db-stats-btn`).

### Injected Scripts (src-inject/)
- Keep injection scripts minimal, defensive, and non-blocking.
- The DOM `MutationObserver` **MUST be debounced** (300ms queue) and ignore nodes inside `#tweeker-overlay-container`.
- Parsed tweet elements **MUST be deduplicated** via `dataset.tweekerParsed = 'true'` markers so elements are parsed at most once.
- **Info-widget** (`tweeker-tweet-user-stats`): A compact following/followers stats widget rendered below the user avatar in each tweet's DOM and user list card (`[data-testid="UserCell"]`). It is injected by `renderStatsBelowAvatar()` / `renderStatsForUserCell()` using the modular `injectUserStats()` helper in `interceptor.js`. Below the info-widget, an **info button** (`.tweeker-user-info-btn`, ℹ icon) is injected via `injectUserInfoButton()`, which dumps cached user stats to the Logs console.

### Security
- Navigation in the X.com webview is locked to `x.com`, `twitter.com`, and related CDN/API domains via `on_navigation`.
- Never expose sensitive authentication data or cookies.

## Anti-Abuse, Rate-Limiting & Human Simulation Policy

Tweeker wraps X.com's web interface to provide power-user capabilities while strictly prioritizing account safety and preventing anti-automation triggers on X.com servers. All developers and AI agents MUST adhere to these guidelines:

1. **Passive Interception First**:
   - Prefer passive interception of existing network traffic and DOM elements over making active automated API requests.
2. **Human Simulation & Randomized Jitter**:
   - Any automated interaction with X.com (such as Auto-read timeline pill clicks or scheduled tweet execution) MUST incorporate randomized delay jitter (e.g., 800ms–2500ms) rather than executing instantly at fixed intervals or exact sub-second timestamps.
3. **Action Rate-Limiting & Cooldowns**:
   - **Auto-read Pill Clicks**: Throttled to a minimum cooldown interval (at least 5.0 seconds between clicks).
   - **Automated / Scheduled Tweets**: Enforce a minimum cooldown interval (at least 15.0 seconds between posts) to prevent rapid multi-tweet bursts.
4. **User Preemption (Non-Interference)**:
   - Automated actions MUST immediately yield and cancel if the user is actively typing in a form input, composing a post, scrolling, or if the window is hidden/blurred.
5. **No Endpoint Hammering**:
   - Never issue automated API requests in tight loops. All DOM MutationObservers and background state checks MUST be debounced (minimum 300ms–500ms).

## Build & Verification Commands
- Frontend & Desktop Dev: `cargo tauri dev`
- Rust Typecheck / Lint: `cd src-tauri && cargo check`
- Production Build (macOS): `./package/macos/package.sh`
- Production Build (Windows): `powershell -ExecutionPolicy Bypass -File .\package\windows\package.ps1`
