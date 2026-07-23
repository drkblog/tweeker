# Tweeker — Power-User Desktop Client for X.com

A cross-platform desktop application that wraps X.com (Twitter) with power-user features: real-time timeline statistics, keyword/user alarms, scheduled tweets, and an extensible architecture for future AI integrations.

---

## User-Facing Guide

### Key Features
*   **Full X.com Experience**: Browse X.com exactly as you would in a browser — same login, same interface, same features. Tweeker wraps it, not replaces it.
*   **Overlay Control Panel**: Press `Ctrl+Shift+T` (or click the floating button) to slide open a sleek control panel overlay without leaving your timeline.
*   **Timeline Statistics**: Track tweets seen, unique authors, engagement metrics, and top contributors — all updating in real-time as you scroll.
*   **Keyword & User Alarms**: Set alarms that trigger notifications when specific keywords appear, certain users tweet, or engagement thresholds are reached.
*   **Scheduled Tweets**: Compose tweets and schedule them for future posting directly from the control panel.
*   **Extensible Architecture**: Designed from the ground up to support future features like AI-powered content analysis, multi-account management, and external service integrations.

### How to Use

1.  **Launch Tweeker** — X.com loads automatically in the main window.
2.  **Log in** to your X.com account as usual.
3.  **Open the control panel** by pressing `Ctrl+Shift+T` or clicking the floating button in the bottom-right corner.
4.  **Browse tabs**:
    *   **Stats** — View real-time timeline metrics and top authors
    *   **Alarms** — Create keyword, user, mention, or engagement alarms
    *   **Schedule** — Compose and schedule tweets for later
    *   **Settings** — View connection status, interceptor status, and app info
5.  **Close the panel** with `Escape`, the close button, or `Ctrl+Shift+T` again.

---

## Developer Guide

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Window (main)                   │
│                                                         │
│  ┌──────────────────────┐  ┌─────────────────────────┐  │
│  │   X.com Webview      │  │  Control Panel Overlay  │  │
│  │   (external URL)     │  │  (local HTML/JS/CSS)    │  │
│  │                      │  │  - Stats dashboard      │  │
│  │   + injected JS:     │  │  - Alarms manager       │  │
│  │   · fetch intercept  │  │  - Tweet scheduler      │  │
│  │   · MutationObserver │  │  - Settings             │  │
│  │   · bridge.js        │  │                         │  │
│  └──────────┬───────────┘  └──────────┬──────────────┘  │
│             │ postMessage              │ Tauri IPC       │
│             └──────────┬───────────────┘                 │
│                        ▼                                 │
│              ┌─────────────────────┐                     │
│              │    Rust Backend     │                     │
│              │  · State manager   │                     │
│              │  · SQLite storage  │                     │
│              │  · Scheduler       │                     │
│              │  · JS injector     │                     │
│              └─────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

*   **Frontend (Control Panel)**: Vanilla HTML5, CSS3, JavaScript (ES6+). A glassmorphism overlay drawer that slides over X.com when toggled.
*   **Backend (Rust / Tauri v2)**: Modular Rust backend with SQLite persistence, tokio-based scheduler, and JavaScript injection engine.
*   **X.com Integration**: The X.com webview loads the real site. Injected JavaScript intercepts `fetch`/`XHR` API responses and uses `MutationObserver` to capture tweet data, which is relayed to the Rust backend.

### Project Structure
```
tweeker/
├── AGENTS.md                    # Agent coding guidelines
├── README.md                    # This file
├── LICENSE                      # MIT License
├── .gitignore
│
├── src-tauri/                   # Rust backend (Tauri v2)
│   ├── Cargo.toml               # Dependencies
│   ├── tauri.conf.json           # App config, CSP, window settings
│   ├── build.rs                  # Build script
│   ├── capabilities/default.json # IPC permissions
│   └── src/
│       ├── main.rs               # Entry point, webview setup
│       ├── commands.rs           # IPC command handlers
│       ├── state.rs              # Shared AppState
│       ├── models.rs             # Data models (Tweet, Alarm, etc.)
│       ├── storage.rs            # SQLite persistence layer
│       ├── scheduler.rs          # Tokio-based scheduler
│       └── interceptor.rs        # JS injection generator
│
├── src-frontend/                 # Control panel overlay UI
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── src-inject/                   # JS injected into X.com webview
│   ├── interceptor.js            # fetch/XHR monkey-patch
│   └── bridge.js                 # Message bridge to Rust
│
└── package/                      # Platform packaging scripts
    ├── macos/package.sh
    └── windows/package.ps1
```

### Prerequisites
1.  **Rust Toolchain**: Install via [rustup.rs](https://rustup.rs).
2.  **Tauri CLI**: Install the cargo plugin:
    ```bash
    cargo install tauri-cli --locked
    ```

### Running in Development
```bash
# Execute from the repository root
cargo tauri dev
```

Since the frontend is built from static assets, Tauri loads files directly from `src-frontend/`. No Node.js or npm dev server is required.

### Building Production Bundles

**macOS:**
```bash
cargo tauri build
# Or use the packaging script:
./package/macos/package.sh
```

**Windows:**
```powershell
cargo tauri build
# Or use the packaging script:
powershell -ExecutionPolicy Bypass -File .\package\windows\package.ps1
```

Compiled bundles are output to `src-tauri/target/release/bundle/`. The packaging scripts copy them to `dist/macos/` or `dist/windows/`.

### Security Model
*   The X.com webview is **fully isolated** — it has no access to Tauri IPC commands.
*   Communication from X.com to Rust is one-way via `postMessage` (injected JS → Rust event listener).
*   Only the control panel webview has IPC access to backend commands.
*   Navigation in the X.com webview is restricted to `x.com`, `twitter.com`, and related domains.

---

## License

MIT — see [LICENSE](LICENSE).
