use std::sync::Mutex;
use chrono::{DateTime, Utc};
use crate::models::{InterceptedTweet, Alarm, ScheduledTweet, TimelineStats, AuthorCount};
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
        }
    }

    /// Compute timeline statistics from the current tweet buffer.
    pub fn compute_stats(&self) -> TimelineStats {
        let tweets = self.tweets.lock().unwrap();
        let session_start = self.session_start.lock().unwrap();

        if tweets.is_empty() {
            return TimelineStats {
                session_start: *session_start,
                ..Default::default()
            };
        }

        let mut author_counts: HashMap<String, (String, u64)> = HashMap::new();
        let mut total_likes: u64 = 0;
        let mut total_retweets: u64 = 0;
        let mut total_replies: u64 = 0;

        for tweet in tweets.iter() {
            let entry = author_counts
                .entry(tweet.author_handle.clone())
                .or_insert_with(|| (tweet.author_name.clone(), 0));
            entry.1 += 1;

            total_likes += tweet.likes;
            total_retweets += tweet.retweets;
            total_replies += tweet.replies;
        }

        let unique_authors = author_counts.len() as u64;

        let mut top_authors: Vec<AuthorCount> = author_counts
            .into_iter()
            .map(|(handle, (name, count))| AuthorCount { handle, name, count })
            .collect();
        top_authors.sort_by(|a, b| b.count.cmp(&a.count));
        top_authors.truncate(10);

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
