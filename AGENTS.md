# Project Guidelines & Agent Rules for Tweeker

`Tweeker` is a cross-platform desktop application built with Tauri v2 (Rust) and a Vanilla JS/CSS frontend that wraps X.com (Twitter) with power-user features: timeline interception, statistics, alarms, scheduled tweets, and extensible automation.

## Technology Stack & Architecture

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+). The control panel is an overlay drawer that slides over the X.com webview.
- **Backend**: Rust with Tauri v2 (`src-tauri`), Tokio async runtime, SQLite via `rusqlite` for persistence.
- **X.com Integration**: Native Tauri webview loading X.com as an external URL. JavaScript injection via `initialization_script` intercepts `fetch`/`XHR` API calls and uses `MutationObserver` for DOM monitoring.
- **Multi-Webview**: Single window with two webviews — a local control panel overlay and the X.com webview. Uses Tauri v2's unstable `add_child` API.

## Project Structure

```
src-tauri/src/
├── main.rs           # Entry point, Tauri builder, webview setup
├── commands.rs       # All #[tauri::command] IPC handlers
├── state.rs          # Shared AppState with Mutex-wrapped fields
├── models.rs         # Serde-serializable data models
├── storage.rs        # SQLite persistence (migrations, CRUD)
├── scheduler.rs      # Tokio-based tweet scheduler & alarms
└── interceptor.rs    # JS injection script generator (reads src-inject/)

src-inject/           # JS scripts injected into X.com webview
├── interceptor.js    # fetch/XHR monkey-patch + MutationObserver
└── bridge.js         # Message bridge: X.com webview → Rust backend

src-frontend/         # Local control panel overlay UI
├── index.html
├── style.css
└── app.js
```

## Code Style & Guidelines

### Frontend (HTML / CSS / JS)
- Keep CSS clean, modern, and modular in `src-frontend/style.css`.
- Use CSS custom properties (tokens) defined in `:root` for colors, shadows, radii, and transitions.
- Keep `src-frontend/app.js` organized into modular sections (State, DOM Elements, Event Handlers, UI Renderers).
- The control panel is an **overlay drawer** — it slides in/out over X.com. Do not use `iframe` or separate windows.

### Backend (Rust / Tauri)
- Retain proper error handling (`Result<T, String>`) for all `#[tauri::command]` handlers.
- Keep modules small and focused. Each file in `src-tauri/src/` has a single responsibility.
- Use `AppState` in `state.rs` as the single shared state managed by Tauri.
- All database operations go through `storage.rs`. Do not use raw SQL in command handlers.
- Scheduler tasks in `scheduler.rs` use Tokio timers, never `std::thread::sleep`.

### Injected Scripts (src-inject/)
- These scripts run in the X.com webview context. They have NO access to Tauri IPC.
- Communication from injected scripts to Rust goes via `window.postMessage` → Rust event listener.
- Keep injection scripts minimal and defensive — X.com can change their DOM/API at any time.
- Use `MutationObserver` for DOM changes, monkey-patched `fetch` for API interception.

### Security
- The X.com webview must NOT have Tauri IPC capabilities (isolated by capabilities config).
- Only the control panel webview (`main`) has IPC access to Rust commands.
- Navigation in the X.com webview is locked to `x.com` / `twitter.com` domains via `on_navigation`.
- Never expose sensitive data (auth tokens, cookies) to the control panel webview.

## Build & Verification Commands
- Frontend & Desktop Dev: `cargo tauri dev`
- Rust Typecheck / Lint: `cd src-tauri && cargo check`
- Production Build: `cargo tauri build`
