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

- **Current Version**: `1.0.0`
- **Single Source of Truth**: The app version is set in `src-tauri/Cargo.toml` (`version = "1.0.0"`) and mirrored in `src-tauri/tauri.conf.json`.
- **Incrementing Version**: To increment the version, edit `version` in `Cargo.toml` and `tauri.conf.json`. The backend `get_app_version()` command uses `env!("CARGO_PKG_VERSION")` and updates automatically across the app.

## Code Style & Guidelines

### Frontend (HTML / CSS / JS)
- All CSS in `src-frontend/style.css` **MUST be scoped strictly** to `#tweeker-overlay-container` (e.g. `#tweeker-overlay-container *, #tweeker-overlay-container .class`).
- **NEVER** apply `pointer-events: none`, `overflow: hidden`, or global resets (`* { margin: 0 }`) directly to `body` or X.com elements.
- The control panel is a **floating glass drawer** with inset margins (`top: 16px; right: 16px; bottom: 16px; height: calc(100vh - 32px)`), rounded corners (`border-radius: 16px`), and width `380px`.
- The floating toggle button (`.overlay-toggle`) is **draggable by the user** so they can uncover UI elements behind it. Drag position is saved in `localStorage` (`tweeker_toggle_pos`).
- Header includes a **Copy URL button** (`#copy-url-btn`) that copies `window.location.href` to clipboard with a visual feedback toast (`#copy-url-toast`).
- The status bar contains an **Auto read toggle** (`#auto-read-toggle`), off by default. A startup setting in Settings ("Auto read on app start", stored in `localStorage` as `tweeker_autoread_on_start`) automatically activates Auto read when the app opens.
- When **Auto read** is enabled, `interceptor.js` automatically clicks X.com floating "New Tweets" pill buttons as they appear and processes all incoming timeline messages immediately.

### Backend (Rust / Tauri v2)
- Retain proper error handling (`Result<T, String>`) for all `#[tauri::command]` handlers.
- Background async tasks started in `setup()` **MUST use `tauri::async_runtime::spawn`**, NEVER direct `tokio::spawn` (which causes Tokio reactor panics on the GUI thread).
- Use `AppState` in `state.rs` as the single shared state managed by Tauri.
- All database operations go through `storage.rs`. Do not use raw SQL in command handlers.

### Injected Scripts (src-inject/)
- Keep injection scripts minimal, defensive, and non-blocking.
- The DOM `MutationObserver` **MUST be debounced** (300ms queue) and ignore nodes inside `#tweeker-overlay-container`.
- Parsed tweet elements **MUST be deduplicated** via `dataset.tweekerParsed = 'true'` markers so elements are parsed at most once.

### Security
- Navigation in the X.com webview is locked to `x.com`, `twitter.com`, and related CDN/API domains via `on_navigation`.
- Never expose sensitive authentication data or cookies.

## Build & Verification Commands
- Frontend & Desktop Dev: `cargo tauri dev`
- Rust Typecheck / Lint: `cd src-tauri && cargo check`
- Production Build (macOS): `./package/macos/package.sh`
- Production Build (Windows): `powershell -ExecutionPolicy Bypass -File .\package\windows\package.ps1`
