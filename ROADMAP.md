# Tweeker Feature Roadmap

This document tracks upcoming power-user features and improvements to the Tweeker desktop client. Agents picking up a task from this roadmap MUST update its status in this file and strictly adhere to the Anti-Abuse, Rate-Limiting & Human Simulation Policy defined in [AGENTS.md](file:///Users/drkbugs/repos/tweeker/AGENTS.md).

## Features & Implementation Status

| Feature ID | Feature Name | Status | Developer/Agent | Session Date |
| :--- | :--- | :--- | :--- | :--- |
| **A** | Followers-to-Following (F/F) Ratio & Custom Tooltips | **Completed** | Antigravity | 2026-07-29 |
| **B** | IPC Batching for Bulk Scrolling (`get_users_counts_batch`) | **Completed** | Antigravity | 2026-07-30 |
| **C** | List Page Highlighting & Filtering Controls | **Completed** | Antigravity | 2026-07-29 |
| **D** | Lazy API Fetching for Uncached Profiles | **Completed** | Antigravity | 2026-08-03 |
| **E** | Tweet Stats on Notifications Screen ("All" Tab Only) | **Completed** | Antigravity | 2026-07-30 |
| **F** | Decoupled Mode (No Page Modifications) | **Completed** | Antigravity | 2026-07-31 |
| **G1** | Export Application Data & Backup | **Completed** | Antigravity | 2026-08-03 |
| **G2** | Import / Restore Application Data | **Completed** | Antigravity | 2026-08-03 |
| **G3** | Purge User Cache & Intercepted Tweets Storage | **Completed** | Antigravity | 2026-08-03 |
| **G4** | Reset Application Settings to Defaults | **Completed** | Antigravity | 2026-08-03 |
| **G5** | Hard Reset / Factory Wipe | **Completed** | Antigravity | 2026-08-03 |
| **G6** | Download Diagnostic System Bundle | **Completed** | Antigravity | 2026-08-03 |
| **H** | Real-Time Relevant & Recent Tweet Highlights | **Completed** | Antigravity | 2026-08-03 |
| **I** | Advanced Configuration Editor & Custom Stats Styling | **Completed** | Antigravity | 2026-08-03 |
| **J** | Timeline Video Downloader & Queue Manager | **Completed** | Antigravity | 2026-08-06 |
| **K** | Selection Floating Toolbar | **Completed** | Antigravity | 2026-08-10 |
| **L** | Editor Helper Bar | **Completed** | Antigravity | 2026-08-10 |

---

## Detailed Feature Descriptions

### [Feature A] Followers-to-Following (F/F) Ratio & Custom Tooltips
- **Description**: Add a calculated **F/F Ratio** metric to the stats widget (e.g. `Ratio: 2.5`). Replace standard browser `title` tooltips with a custom CSS-styled glassmorphism micro-tooltip showing the ratio, actual raw counts, and an automatic classification (e.g., *Spam/Bot*, *Casual*, *Power User*, *Influencer*).
- **Design & User Experience**: 
  - Tooltips should use the glassmorphism theme (`backdrop-filter`, dark transparency, border glow).
  - Classification criteria:
    - *Spam / Low Activity*: Followers < 50 and F/F Ratio < 0.2 (except new accounts)
    - *Influencer*: Followers > 10,000 and F/F Ratio > 5.0
    - *Mega-Influencer*: Followers > 100,000 and F/F Ratio > 10.0
    - *Power User*: Followers > 1,000 and F/F Ratio between 0.8 and 5.0
    - *Casual*: Standard user not fitting above categories

### [Feature B] IPC Batching for Bulk Scrolling (`get_users_counts_batch`)
- **Description**: When scrolling quickly through follower or following lists, many user cells are parsed at once. Currently, each cell sends an individual `get_user_counts` IPC message to the Rust SQLite backend. We can batch requests by queuing handle lookups for `150ms` and requesting them in a single `get_users_counts_batch` query.
- **Benefits**: Drastically reduces IPC message overhead, prevents UI micro-stutters during fast scrolling, and optimizes database lock times.

### [Feature C] List Page Highlighting & Filtering Controls
- **Description**: Add controls to the settings tab to configure dynamic filters specifically for follower/following lists (e.g., auto-hide users with `< 100` followers, dim users with a ratio `< 0.5`, or highlight users with verified status or mega-following with customized borders).
- **Benefits**: Transforms the follower lists page into an actionable dashboard for cleaning up timeline noise or identifying high-value accounts.

### [Feature D] Lazy API Fetching for Uncached Profiles
- **Description**: Currently, if a user card displays but has never been seen in a timeline tweet or network payload, the database has no counts, and the widget displays `?` until X.com happens to fetch that user data. We can implement a lazy, rate-limited request using the intercepted credentials to query X.com's backend for missing profiles automatically when they are displayed on screen.
- **Benefits**: Guarantees that stats are eventually loaded and shown for *every* user on the screen, even if the app was just launched or the user hasn't tweeted recently.

### [Feature E] Tweet Stats on Notifications Screen ("All" Tab Only)
- **Description**: When the user is browsing X.com's `/notifications` ("All" tab) page, inject a compact tweet-engagement stats bar (replies, retweets, likes, views) below each notification item that references a tweet. This mirrors the existing `tweeker-tweet-user-stats` user widget pattern but shows *tweet-level* engagement data instead of *user-level* follower/following data.

- **Data Sources**:
  - **Primary (API interception)**: The existing `isTimelineEndpoint()` filter in `interceptor.js` (line ~907) already matches `/graphql/` requests, which includes the `Notifications` GraphQL endpoint. The `extractTweetFromResult()` function (line ~970) already extracts `likes`, `retweets`, `replies`, and `views` from the `legacy` and `views` fields of tweet result objects. The intercepted tweet data is sent to the Rust backend via `sendTweets()` and stored in `storage.rs` (SQLite `tweets` table).
  - **Secondary (in-memory cache)**: Maintain a lightweight JS-side `window.__tweeker.tweetCache` (keyed by `tweet_id`) so that once a notification page's API response is parsed, tweet stats are immediately available for DOM injection without a round-trip IPC call. This cache should be populated both from `extractTweetFromResult()` during API interception and from the Rust-side tweet store on startup (similar to the existing `bulk_user_cache` flow).

- **DOM Injection Strategy**:
  - **Target elements**: `article[data-testid="notification"]` elements on the notifications page.
  - **Tweet ID extraction**: Each notification `article` may contain an embedded tweet. Look for `a[href*="/status/"]` links within the notification to extract the tweet ID from the URL pattern `/username/status/<tweet_id>`.
  - **Injection point**: Below the notification article's text content, insert a new `<div class="tweeker-notification-tweet-stats">` element with a compact inline layout showing: 💬 replies · 🔁 retweets · ❤️ likes · 👁 views.
  - **Deduplication**: Mark processed notification articles with `dataset.tweekerNotifStatsParsed = 'true'` to avoid re-processing.
  - **Re-rendering**: When new tweet stats arrive from API interception, call a new `updateNotificationTweetStats()` function that re-scans notification articles and updates any stale or missing stats widgets.

- **Implementation Steps**:
  1. **`interceptor.js`**: Add `window.__tweeker.tweetCache = {}` alongside the existing `window.__tweeker.userCache` initialization (line ~20). Populate it during `extractTweetFromResult()` calls in the fetch/XHR intercept handlers (lines ~420–510). Create a new `parseDOMNotification(articleEl)` function that:
     - Checks for `data-tweeker-notif-stats-parsed` marker.
     - Extracts `tweet_id` from embedded `/status/<id>` links.
     - Looks up stats in `window.__tweeker.tweetCache`.
     - Injects the stats bar via a new `injectNotificationTweetStats(parentEl, tweetStats)` helper.
  2. **`interceptor.js` (MutationObserver)**: Update `processPendingDOMNodes()` (line ~525) to also scan for `[data-testid="notification"]` elements and call `parseDOMNotification()`. Update the periodic scanner (line ~1306) to also process unscanned notification articles.
  3. **`interceptor.js` (batch response)**: In the `user_counts_batch_response` handler and the `findTweetsInObject` callback, after populating `tweetCache`, trigger a `updateNotificationTweetStats()` pass to render stats for any notification items that were waiting for tweet data.
  4. **`style.css`**: Add `.tweeker-notification-tweet-stats` styles scoped outside the overlay (matching the existing `tweeter-tweet-user-stats` pattern), using compact font sizes (~11px), muted secondary text color, and inline flexbox layout. Use emoji or SVG icons for each metric.
  5. **`app.js` (optional)**: Consider adding a `get_tweet_stats_batch` IPC message handler similar to `get_users_counts_batch` for cases where the notification page loads tweets that were captured in a prior session but aren't in the JS-side `tweetCache` yet.

- **Key Considerations**:
  - Not all notification items reference tweets (e.g., "X followed you" has no tweet). The injection function must gracefully skip notifications without embedded tweet links.
  - X.com's notification DOM uses `article[data-testid="notification"]` — **not** `article[data-testid="tweet"]` — so the existing `parseDOMTweet` function should NOT be reused directly; a separate function is needed.
  - The `processUserAvatar()` 120px dimension guard and `.r-1adg3ll` exclusion fixes from the notification highlight work must be preserved.
  - Notification articles may contain *multiple* embedded tweets (e.g., "X liked 3 of your posts"). The implementation should handle injecting stats for each referenced tweet or show stats only for the first/primary one.

- **Affected Files**:
  - `src-inject/interceptor.js` — New `tweetCache`, `parseDOMNotification()`, `injectNotificationTweetStats()`, MutationObserver updates, periodic scanner updates.
  - `src-frontend/style.css` — New `.tweeker-notification-tweet-stats` styles (scoped outside overlay, prefixed with `tweeker-`).
  - `src-frontend/app.js` — Optional: `get_tweet_stats_batch` IPC message handler.
  - `src-tauri/src/commands.rs` — Optional: `get_tweet_stats_batch` Tauri command.
  - `src-tauri/src/main.rs` — Optional: Register new command in `invoke_handler!`.

- **Benefits**: Gives power users instant visibility into how their tweets are performing directly from the notifications screen, without needing to click into each individual tweet. Aligns with Tweeker's philosophy of surfacing hidden metadata in-context.

### [Feature F] Decoupled Mode (No Page Modifications)
- **Description**: Add a toggle setting to run X.com without page modifications, network interceptors, DOM observers, or avatar stats injections, while preserving the overlay drawer for read-only access to SQLite database/memory stats and app settings.
- **Access Points**: Settable via the Tweeker overlay **Settings** tab (`#decouple-mode-toggle`) or directly from the Mac OS application menu (**Tweeker > Decoupled Mode (No Page Modifications)**).
- **Benefits**: Allows offline testing, DOM comparison, and non-invasive browsing without modifying X.com's webview page script context.

### [Feature G] Manager Tab Action Proposals

#### [Feature G1] Export Application Data & Backup
- **Description**: Add an "Export Data" button in the Manager tab that compiles all active alarms, scheduled tweets, cached user stats, intercepted tweet metadata, and application configuration settings into a timestamped `.json` or `.zip` backup file.
- **Benefits**: Allows power users to back up their local Tweeker data before system updates or transfer data to another machine.

#### [Feature G2] Import / Restore Application Data
- **Description**: Add an "Import Data" button with file picker to upload and restore previously exported backup files.
- **Benefits**: Enables seamless data restoration or cross-device profile migration without losing alarms or tweet history.

#### [Feature G3] Purge User Cache & Intercepted Tweets Storage
- **Description**: Add a "Purge User & Tweet Storage" button to clean up SQLite database tables (`cached_users` and `tweets`) to free up disk space while preserving active alarms, scheduled tweets, and user settings.
- **Benefits**: Helps maintain minimal disk footprint for long-running Tweeker installations without losing configuration.

#### [Feature G4] Reset Application Settings to Defaults
- **Description**: Add a "Reset Settings to Defaults" button in the Manager tab to restore all UI configuration toggles, list filter thresholds, and logging settings to their factory default values.
- **Benefits**: Provides an easy one-click recovery path if list filters or threshold settings cause unexpected UI behavior.

#### [Feature G5] Hard Reset / Factory Wipe
- **Description**: Add a "Factory Reset" button (with red warning modal confirmation) that completely wipes all SQLite tables, clears `localStorage`, `sessionStorage`, `IndexedDB`, browser cache, and restarts the application to a pristine state.
- **Benefits**: Serves as the ultimate recovery tool for corrupted database states or deep troubleshooting.

#### [Feature G6] Download Diagnostic System Bundle
- **Description**: Add a "Download Diagnostic Report" button that packages recent system logs, SQLite stats, webview version, OS specifications, and network interceptor status into a single text/JSON diagnostic file for GitHub issue reporting.
- **Benefits**: Simplifies troubleshooting and bug reporting for developers and power users.

#### [Feature H] Real-Time Relevant & Recent Tweet Highlights
- **Description**: Wipes the timeline noise by highlighting fresh tweets (e.g. published within a configurable duration, default 3 minutes) coming from relevant users (verified or exceeding follower count limits). Inserts a custom outstanding badge/icon indicator (e.g., a glowing lightning bolt ⚡) next to the user's name or avatar inside the timeline.
- **Settings configuration**: Add a setting in the Settings panel to let users set the "recent tweet duration" in minutes via a slide/number input.
- **Benefits**: Focuses user attention on real-time activity from accounts they care about.

#### [Feature I] Advanced Configuration Editor & Custom Stats Styling
- **Description**: Add an "Advanced..." button at the end of the Settings panel. Clicking it opens a custom modal showing a full key-value editor listing all application settings (loaded from `localStorage` and default schemas), with a live text filter box to search for settings by name.
- **In-Place Editing**: Allow editing configuration values inline with immediate feedback (updates are saved to `localStorage` and sent down to the injected script).
- **Hidden Styling Settings**: Introduce new styling settings for customizing the colors of notification statistics added to tweets. These are not visible on the standard Settings page and are only customizable via the Advanced editor:
  - `notifications.statistics.background-color` (default stats box background color)
  - `notifications.statistics.likes-color` (default color for likes count text/icon)
  - `notifications.statistics.retweets-color` (default color for retweets count text/icon)
  - `notifications.statistics.replies-color` (default color for replies count text/icon)
  - `notifications.statistics.views-color` (default color for views count text/icon)
- **Benefits**: Empowers advanced users with fine-grained configuration control and custom appearance options without cluttering the main settings UI.

#### [Feature J] Timeline Video Downloader & Queue Manager
- **Description**: Add a floating overlay "Download Video" button over video containers in the timeline. Downloads are queried via the Cobalt API and streamed chunk-by-chunk directly to a user-specified path via native file dialogs. If the direct download fails, a fallback manually opens `twitsave.com`.
- **Concurrent Limits**: Restrict parallel downloads via a configurable parameter `tweeker_max_concurrent_downloads` (default: 2) in Advanced Settings, holding extra downloads in a pending state queue.
- **Benefits**: Eliminates the need for external browser extensions or untrusted copy-paste downloader sites by providing native, rate-limited downloads.

#### [Feature K] Selection Floating Toolbar
- **Description**: Render a floating action bubble toolbar containing Copy and Google buttons above highlighted text selections.
- **Benefits**: Retains native browser right-click options (Look Up, Translate, Services) intact, while making Tweeker workflows easily accessible.

#### [Feature L] Editor Helper Bar
- **Description**: Display a floating "Editor helper bar" above active text fields where the user writes tweets or replies. It contains a single button ("✨ Fix grammar") that reads the text from the compose area and opens Google Gemini in a new chat pre-filled with the prompt `"Fix grammar: <text>"` and submits it automatically.
- **Benefits**: Streamlines drafting by bringing real-time AI-powered grammar checking directly inside the X.com tweet composition workflow.




