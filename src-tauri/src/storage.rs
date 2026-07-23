use rusqlite::{Connection, params};
use std::path::PathBuf;
use crate::models::{Alarm, AlarmType, ScheduledTweet, TweetStatus, InterceptedTweet};
use chrono::Utc;

use tauri::Manager;

/// Returns the path to the SQLite database file in the app data directory.
fn db_path(app: &tauri::AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data directory");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("tweeker.db")
}

/// Open a connection to the SQLite database, creating it if necessary.
pub fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app);
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;

    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    Ok(conn)
}

/// Run database migrations to create tables if they don't exist.
pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tweets (
            tweet_id TEXT PRIMARY KEY,
            author_handle TEXT NOT NULL,
            author_name TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            likes INTEGER NOT NULL DEFAULT 0,
            retweets INTEGER NOT NULL DEFAULT 0,
            replies INTEGER NOT NULL DEFAULT 0,
            views INTEGER,
            captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alarms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            alarm_type TEXT NOT NULL,
            pattern TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            last_triggered TEXT
        );

        CREATE TABLE IF NOT EXISTS scheduled_tweets (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            scheduled_for TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(author_handle);
        CREATE INDEX IF NOT EXISTS idx_tweets_timestamp ON tweets(timestamp);
        CREATE INDEX IF NOT EXISTS idx_scheduled_for ON scheduled_tweets(scheduled_for);
        ",
    )
    .map_err(|e| format!("Migration failed: {}", e))?;

    Ok(())
}

// ── Tweet persistence ──

pub fn insert_tweet(conn: &Connection, tweet: &InterceptedTweet) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO tweets (tweet_id, author_handle, author_name, content, timestamp, likes, retweets, replies, views, captured_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            tweet.tweet_id,
            tweet.author_handle,
            tweet.author_name,
            tweet.content,
            tweet.timestamp.to_rfc3339(),
            tweet.likes,
            tweet.retweets,
            tweet.replies,
            tweet.views,
            tweet.captured_at.to_rfc3339(),
        ],
    )
    .map_err(|e| format!("Failed to insert tweet: {}", e))?;
    Ok(())
}

// ── Alarm CRUD ──

pub fn load_alarms(conn: &Connection) -> Result<Vec<Alarm>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, alarm_type, pattern, enabled, created_at, last_triggered FROM alarms ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare alarm query: {}", e))?;

    let alarms = stmt
        .query_map([], |row| {
            let alarm_type_str: String = row.get(2)?;
            let alarm_type = match alarm_type_str.as_str() {
                "keyword" => AlarmType::Keyword,
                "user" => AlarmType::User,
                "mention" => AlarmType::Mention,
                "engagement" => AlarmType::Engagement,
                _ => AlarmType::Keyword,
            };

            let enabled_int: i32 = row.get(4)?;
            let created_str: String = row.get(5)?;
            let triggered_str: Option<String> = row.get(6)?;

            Ok(Alarm {
                id: row.get(0)?,
                name: row.get(1)?,
                alarm_type,
                pattern: row.get(3)?,
                enabled: enabled_int != 0,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                last_triggered: triggered_str.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .map(|dt| dt.with_timezone(&Utc))
                        .ok()
                }),
            })
        })
        .map_err(|e| format!("Failed to query alarms: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect alarms: {}", e))?;

    Ok(alarms)
}

pub fn insert_alarm(conn: &Connection, alarm: &Alarm) -> Result<(), String> {
    let alarm_type_str = match alarm.alarm_type {
        AlarmType::Keyword => "keyword",
        AlarmType::User => "user",
        AlarmType::Mention => "mention",
        AlarmType::Engagement => "engagement",
    };

    conn.execute(
        "INSERT INTO alarms (id, name, alarm_type, pattern, enabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            alarm.id,
            alarm.name,
            alarm_type_str,
            alarm.pattern,
            alarm.enabled as i32,
            alarm.created_at.to_rfc3339(),
        ],
    )
    .map_err(|e| format!("Failed to insert alarm: {}", e))?;
    Ok(())
}

pub fn delete_alarm_by_id(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM alarms WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete alarm: {}", e))?;
    Ok(())
}

pub fn toggle_alarm_by_id(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE alarms SET enabled = ?1 WHERE id = ?2",
        params![enabled as i32, id],
    )
    .map_err(|e| format!("Failed to toggle alarm: {}", e))?;
    Ok(())
}

// ── Scheduled tweet CRUD ──

pub fn load_scheduled_tweets(conn: &Connection) -> Result<Vec<ScheduledTweet>, String> {
    let mut stmt = conn
        .prepare("SELECT id, content, scheduled_for, status, created_at FROM scheduled_tweets ORDER BY scheduled_for ASC")
        .map_err(|e| format!("Failed to prepare scheduled tweet query: {}", e))?;

    let tweets = stmt
        .query_map([], |row| {
            let status_str: String = row.get(3)?;
            let status = match status_str.as_str() {
                "pending" => TweetStatus::Pending,
                "sent" => TweetStatus::Sent,
                "failed" => TweetStatus::Failed,
                "cancelled" => TweetStatus::Cancelled,
                _ => TweetStatus::Pending,
            };

            let scheduled_str: String = row.get(2)?;
            let created_str: String = row.get(4)?;

            Ok(ScheduledTweet {
                id: row.get(0)?,
                content: row.get(1)?,
                scheduled_for: chrono::DateTime::parse_from_rfc3339(&scheduled_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                status,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })
        .map_err(|e| format!("Failed to query scheduled tweets: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect scheduled tweets: {}", e))?;

    Ok(tweets)
}

pub fn insert_scheduled_tweet(conn: &Connection, tweet: &ScheduledTweet) -> Result<(), String> {
    conn.execute(
        "INSERT INTO scheduled_tweets (id, content, scheduled_for, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            tweet.id,
            tweet.content,
            tweet.scheduled_for.to_rfc3339(),
            "pending",
            tweet.created_at.to_rfc3339(),
        ],
    )
    .map_err(|e| format!("Failed to insert scheduled tweet: {}", e))?;
    Ok(())
}

pub fn delete_scheduled_tweet_by_id(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM scheduled_tweets WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete scheduled tweet: {}", e))?;
    Ok(())
}
