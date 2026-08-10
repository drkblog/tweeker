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

*   **Frontend (Control Panel)**: Vanilla HTML5, CSS3, JavaScript (ES6+). A glassmorphism overlay drawer that slides over X.com when toggled. The overlay's open/closed state is persisted in `localStorage` across app restarts.
*   **Backend (Rust / Tauri v2)**: Modular Rust backend with SQLite persistence, tokio-based scheduler, and JavaScript injection engine.
*   **X.com Integration**: The X.com webview loads the real site. Injected JavaScript intercepts `fetch`/`XHR` API responses and uses `MutationObserver` to capture tweet data, which is relayed to the Rust backend.
*   **Database Statistics & Persistence**: On startup, a system log line records database statistics (cached users, tweets, alarms, scheduled tweets, DB file size). Settings tab displays the read-only SQLite database path. New features that add persistence must update `DbStats` and the startup log line.
*   **Info-widget** (`tweeker-tweet-user-stats`): A compact following/followers stats widget injected below the user avatar in each tweet. Below it, an info button (ℹ) dumps comprehensive cached user metadata to the Logs console.

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

### Video Download Architecture & Security
Tweeker provides an integrated video download manager directly inside the X.com timeline.

#### 1. Downloader Architecture
*   **DOM Injection**: The injected script scans the timeline for video players and overlays a glassmorphic download button (`📥`).
*   **Cobalt Integration**: Clicking the button sends the public tweet URL to the Rust backend, which contacts the **Cobalt API**—a stateless, open-source media downloader engine. The backend sends a request to resolve the direct media source URL.
*   **Sequential Mirror Fallbacks**: Because public Cobalt instances often enable Cloudflare WAF protection or require Turnstile JWT tokens (to prevent bot scraping overload), Tweeker implements a self-healing sequential mirror rotation. It tries the official API first (with browser-like `User-Agent` headers), and falls back to a checklist of active community mirrors (`dog.kittycat.boo`, `cobaltapi.cjs.nz`, etc.) if a mirror returns a rate-limit or auth error.
*   **Web Fallback**: If all community mirrors are down or blocked, the application automatically launches a new browser tab pre-filled with the tweet URL at `twitsave.com`, allowing the user to perform a single-click manual download.
*   **Chunked Stream Downloader**: When a mirror returns a valid media link, Tweeker prompts the user with a native file dialog (`rfd`) to choose a destination. Bytes are streamed chunk-by-chunk over HTTPS directly to disk to prevent RAM spikes.

#### 2. Security & Privacy Considerations
*   **Is there any security concern?** No. 
*   **Sandboxed Isolation**: The video download process runs entirely within the Rust host process (`src-tauri`), maintaining the complete isolation of the X.com webview sandbox. The webview never accesses local file paths or triggers system writes.
*   **Zero Leakage of Credentials**: The app only sends the public tweet URL (e.g., `https://x.com/username/status/12345`) to Cobalt mirrors. No user cookies, authentication headers, or local session data are ever exposed or transmitted.
*   **Safe File Dialog**: File path selection is handled via a native OS File Dialog, ensuring the application cannot write to arbitrary directories without user consent.

### Selection Floating Toolbar (Feature K)
Tweeker renders an elegant, glassmorphic floating action toolbar directly above the text selection when the user highlights text on screen.

*   **Trigger Mechanics**: Highlighting text inside the webview renders a small, floating action bubble above the range bounding box. This toolbar sits close to the selection for easy access. Right-clicking is left entirely untouched, ensuring the user retains full access to native OS/browser right-click context menu options (such as Look Up, Translate, Speech, Services, and Inspect Element).
*   **Google Search Integration ("Google")**: Clicking the Google button triggers a native Tauri backend command to launch a new sandboxed `WebviewWindow` displaying Google Search results for the selected phrase.
*   **Copy Selection ("Copy")**: Copies the selected text directly to the system clipboard.
*   **Non-Interference**: Bypassed inside editable text nodes (inputs, textareas, compose editors) to prevent overlays on input actions. Fully respects the `browser.context_menu.enabled` configuration.

---

## License

MIT — see [LICENSE](LICENSE).
