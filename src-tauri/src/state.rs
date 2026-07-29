use std::sync::Mutex;
use chrono::{DateTime, Utc};
use crate::models::{InterceptedTweet, Alarm, ScheduledTweet, TimelineStats, AuthorCount, TwitterUser};
use std::collections::HashMap;

/// Central application state managed by Tauri.
/// All fields are wrapped in Mutex for thread-safe interior mutability.
pub struct AppState {
    pub overlay_visible: Mutex<bool>,
    pub auto_read: Mutex<bool>,
    pub connection: Mutex<ConnectionState>,
    pub tweets: Mutex<Vec<InterceptedTweet>>,
    pub alarms: Mutex<Vec<Alarm>>,
    pub scheduled_tweets: Mutex<Vec<ScheduledTweet>>,
    pub session_start: Mutex<Option<DateTime<Utc>>>,
    pub user_cache: Mutex<HashMap<String, TwitterUser>>,
    pub user_cache_limit: Mutex<usize>,
}

pub struct ConnectionState {
    pub x_webview_loaded: bool,
    pub interceptor_active: bool,
    pub last_heartbeat: Option<DateTime<Utc>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            overlay_visible: Mutex::new(false),
            auto_read: Mutex::new(false),
            connection: Mutex::new(ConnectionState {
                x_webview_loaded: false,
                interceptor_active: false,
                last_heartbeat: None,
            }),
            tweets: Mutex::new(Vec::new()),
            alarms: Mutex::new(Vec::new()),
            scheduled_tweets: Mutex::new(Vec::new()),
            session_start: Mutex::new(None),
            user_cache: Mutex::new(HashMap::new()),
            user_cache_limit: Mutex::new(10000),
        }
    }

    /// Compute timeline statistics from the current tweet buffer & user cache.
    pub fn compute_stats(&self) -> TimelineStats {
        let tweets = self.tweets.lock().unwrap();
        let session_start = self.session_start.lock().unwrap();

        let mut author_counts: HashMap<String, (String, u64)> = HashMap::new();
        let mut total_likes: u64 = 0;
        let mut total_retweets: u64 = 0;
        let mut total_replies: u64 = 0;

        for tweet in tweets.iter() {
            let handle_clean = tweet.author_handle.trim().trim_start_matches('@').to_lowercase();
            if handle_clean.is_empty() {
                continue;
            }
            let display_name = if !tweet.author_name.trim().is_empty() {
                tweet.author_name.clone()
            } else {
                handle_clean.clone()
            };

            let entry = author_counts
                .entry(handle_clean)
                .or_insert_with(|| (display_name, 0));
            entry.1 += 1;
            if !tweet.author_name.trim().is_empty() {
                entry.0 = tweet.author_name.clone();
            }

            total_likes += tweet.likes;
            total_retweets += tweet.retweets;
            total_replies += tweet.replies;
        }

        let unique_authors = author_counts.len() as u64;

        let cache = self.user_cache.lock().unwrap();
        let top_authors: Vec<AuthorCount> = if !cache.is_empty() {
            let mut cached_users: Vec<AuthorCount> = cache
                .iter()
                .map(|(handle, user)| {
                    let name = user.name.clone().unwrap_or_else(|| handle.clone());
                    AuthorCount {
                        handle: handle.clone(),
                        name,
                        count: user.followers,
                    }
                })
                .collect();
            cached_users.sort_by(|a, b| b.count.cmp(&a.count));
            cached_users.truncate(5);
            cached_users
        } else {
            let mut tweet_authors: Vec<AuthorCount> = author_counts
                .into_iter()
                .map(|(handle, (name, count))| AuthorCount { handle, name, count })
                .collect();
            tweet_authors.sort_by(|a, b| b.count.cmp(&a.count));
            tweet_authors.truncate(5);
            tweet_authors
        };

        TimelineStats {
            total_tweets_seen: tweets.len() as u64,
            unique_authors,
            total_likes,
            total_retweets,
            total_replies,
            session_start: *session_start,
            top_authors,
        }
    }
}
