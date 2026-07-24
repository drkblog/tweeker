use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Tweet data captured from X.com timeline ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptedTweet {
    pub tweet_id: String,
    pub author_handle: String,
    pub author_name: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub likes: u64,
    pub retweets: u64,
    pub replies: u64,
    pub views: Option<u64>,
    pub captured_at: DateTime<Utc>,
}

// ── Timeline statistics ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimelineStats {
    pub total_tweets_seen: u64,
    pub unique_authors: u64,
    pub total_likes: u64,
    pub total_retweets: u64,
    pub total_replies: u64,
    pub session_start: Option<DateTime<Utc>>,
    pub top_authors: Vec<AuthorCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorCount {
    pub handle: String,
    pub name: String,
    pub count: u64,
}

// ── Alarms ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alarm {
    pub id: String,
    pub name: String,
    pub alarm_type: AlarmType,
    pub pattern: String, // keyword, username, or regex
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub last_triggered: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlarmType {
    #[serde(alias = "Keyword", alias = "keyword")]
    Keyword,   // triggers when a tweet contains a keyword
    #[serde(alias = "User", alias = "user")]
    User,      // triggers when a specific user tweets
    #[serde(alias = "Mention", alias = "mention")]
    Mention,   // triggers when the logged-in user is mentioned
    #[serde(alias = "Engagement", alias = "engagement")]
    Engagement, // triggers when a tweet exceeds engagement threshold
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlarmRequest {
    pub name: String,
    pub alarm_type: AlarmType,
    pub pattern: String,
}

// ── Scheduled tweets ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTweet {
    pub id: String,
    pub content: String,
    pub scheduled_for: DateTime<Utc>,
    pub status: TweetStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TweetStatus {
    Pending,
    Sent,
    Failed,
    Cancelled,
}

// ── Connection status ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub x_webview_loaded: bool,
    pub interceptor_active: bool,
    pub last_heartbeat: Option<DateTime<Utc>>,
}

// ── Message from injected JS ──

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InterceptorMessage {
    TweetData { tweets: Vec<InterceptedTweet> },
    Heartbeat,
    Error { message: String },
}
