# Tweeker Feature Roadmap

This document tracks upcoming power-user features and improvements to the Tweeker desktop client. Agents picking up a task from this roadmap must update its status in this file.

## Features & Implementation Status

| Feature ID | Feature Name | Status | Developer/Agent | Session Date |
| :--- | :--- | :--- | :--- | :--- |
| **A** | Followers-to-Following (F/F) Ratio & Custom Tooltips | **Completed** | Antigravity | 2026-07-29 |
| **B** | IPC Batching for Bulk Scrolling (`get_users_counts_batch`) | **Completed** | Antigravity | 2026-07-30 |
| **C** | List Page Highlighting & Filtering Controls | **Completed** | Antigravity | 2026-07-29 |
| **D** | Lazy API Fetching for Uncached Profiles | **Pending** | - | - |

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
