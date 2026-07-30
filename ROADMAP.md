# Tweeker Feature Roadmap

This document tracks upcoming power-user features and improvements to the Tweeker desktop client. Agents picking up a task from this roadmap must update its status in this file.

## Features & Implementation Status

| Feature ID | Feature Name | Status | Developer/Agent | Session Date |
| :--- | :--- | :--- | :--- | :--- |
| **A** | Followers-to-Following (F/F) Ratio & Custom Tooltips | **Completed** | Antigravity | 2026-07-29 |
| **B** | IPC Batching for Bulk Scrolling (`get_users_counts_batch`) | **Completed** | Antigravity | 2026-07-30 |
| **C** | List Page Highlighting & Filtering Controls | **Completed** | Antigravity | 2026-07-29 |
| **D** | Lazy API Fetching for Uncached Profiles | **Pending** | - | - |
| **E** | Tweet Stats on Notifications & Mentions Screen | **Pending** | - | - |

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

### [Feature E] Tweet Stats on Notifications & Mentions Screen
- **Description**: When the user is browsing X.com's `/notifications` or `/notifications/mentions` pages, inject a compact tweet-engagement stats bar (replies, retweets, likes, views) below each notification item that references a tweet. This mirrors the existing `tweeker-tweet-user-stats` user widget pattern but shows *tweet-level* engagement data instead of *user-level* follower/following data.

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
