#![allow(dead_code)]

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
            notify INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS user_cache (
            handle TEXT PRIMARY KEY,
            following INTEGER NOT NULL DEFAULT 0,
            followers INTEGER NOT NULL DEFAULT 0,
            name TEXT,
            description TEXT,
            location TEXT,
            verified INTEGER,
            tweet_count INTEGER,
            created_at TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(author_handle);
        CREATE INDEX IF NOT EXISTS idx_tweets_timestamp ON tweets(timestamp);
        CREATE INDEX IF NOT EXISTS idx_scheduled_for ON scheduled_tweets(scheduled_for);
        ",
    )
    .map_err(|e| format!("Migration failed: {}", e))?;

    // Auto-migrate columns for existing databases
    conn.execute_batch("ALTER TABLE alarms ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;").ok();
    conn.execute_batch("
        ALTER TABLE user_cache ADD COLUMN name TEXT;
        ALTER TABLE user_cache ADD COLUMN description TEXT;
        ALTER TABLE user_cache ADD COLUMN location TEXT;
        ALTER TABLE user_cache ADD COLUMN verified INTEGER;
        ALTER TABLE user_cache ADD COLUMN tweet_count INTEGER;
        ALTER TABLE user_cache ADD COLUMN created_at TEXT;
    ").ok();

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

pub fn load_all_tweets(conn: &Connection) -> Result<Vec<InterceptedTweet>, String> {
    let mut stmt = conn
        .prepare("SELECT tweet_id, author_handle, author_name, content, timestamp, likes, retweets, replies, views, captured_at FROM tweets ORDER BY captured_at DESC LIMIT 5000")
        .map_err(|e| format!("Failed to prepare tweets query: {}", e))?;

    let tweets = stmt
        .query_map([], |row| {
            let ts_str: String = row.get(4)?;
            let cap_str: String = row.get(9)?;
            let likes_int: i64 = row.get(5)?;
            let retweets_int: i64 = row.get(6)?;
            let replies_int: i64 = row.get(7)?;
            let views_int: Option<i64> = row.get(8)?;

            Ok(InterceptedTweet {
                tweet_id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content: row.get(3)?,
                timestamp: chrono::DateTime::parse_from_rfc3339(&ts_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                likes: likes_int as u64,
                retweets: retweets_int as u64,
                replies: replies_int as u64,
                views: views_int.map(|v| v as u64),
                captured_at: chrono::DateTime::parse_from_rfc3339(&cap_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })
        .map_err(|e| format!("Failed to query tweets: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tweets: {}", e))?;

    Ok(tweets)
}

pub fn get_tweets_by_ids(conn: &Connection, ids: &[String]) -> Result<Vec<InterceptedTweet>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
    let query = format!(
        "SELECT tweet_id, author_handle, author_name, content, timestamp, likes, retweets, replies, views, captured_at FROM tweets WHERE tweet_id IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare tweets by ids query: {}", e))?;

    let params_vec: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let tweets = stmt
        .query_map(params_vec.as_slice(), |row| {
            let ts_str: String = row.get(4)?;
            let cap_str: String = row.get(9)?;
            let likes_int: i64 = row.get(5)?;
            let retweets_int: i64 = row.get(6)?;
            let replies_int: i64 = row.get(7)?;
            let views_int: Option<i64> = row.get(8)?;

            Ok(InterceptedTweet {
                tweet_id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content: row.get(3)?,
                timestamp: chrono::DateTime::parse_from_rfc3339(&ts_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                likes: likes_int as u64,
                retweets: retweets_int as u64,
                replies: replies_int as u64,
                views: views_int.map(|v| v as u64),
                captured_at: chrono::DateTime::parse_from_rfc3339(&cap_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })
        .map_err(|e| format!("Failed to query tweets by ids: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tweets by ids: {}", e))?;

    Ok(tweets)
}

pub fn get_tweets_by_content_snippets(conn: &Connection, snippets: &[String]) -> Result<Vec<InterceptedTweet>, String> {
    if snippets.is_empty() {
        return Ok(Vec::new());
    }
    let mut tweets = Vec::new();
    let mut stmt = conn
        .prepare("SELECT tweet_id, author_handle, author_name, content, timestamp, likes, retweets, replies, views, captured_at FROM tweets WHERE content LIKE ?1 LIMIT 5")
        .map_err(|e| format!("Failed to prepare snippet query: {}", e))?;

    for snippet in snippets {
        let pattern = format!("%{}%", snippet);
        if let Ok(rows) = stmt.query_map(params![pattern], |row| {
            let ts_str: String = row.get(4)?;
            let cap_str: String = row.get(9)?;
            let likes_int: i64 = row.get(5)?;
            let retweets_int: i64 = row.get(6)?;
            let replies_int: i64 = row.get(7)?;
            let views_int: Option<i64> = row.get(8)?;

            Ok(InterceptedTweet {
                tweet_id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content: row.get(3)?,
                timestamp: chrono::DateTime::parse_from_rfc3339(&ts_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                likes: likes_int as u64,
                retweets: retweets_int as u64,
                replies: replies_int as u64,
                views: views_int.map(|v| v as u64),
                captured_at: chrono::DateTime::parse_from_rfc3339(&cap_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        }) {
            for r in rows.flatten() {
                if !tweets.iter().any(|t: &InterceptedTweet| t.tweet_id == r.tweet_id) {
                    tweets.push(r);
                }
            }
        }
    }

    Ok(tweets)
}

// ── Alarm CRUD ──

pub fn load_alarms(conn: &Connection) -> Result<Vec<Alarm>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, alarm_type, pattern, enabled, notify, created_at, last_triggered FROM alarms ORDER BY created_at DESC")
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
            let notify_int: i32 = row.get(5).unwrap_or(0);
            let created_str: String = row.get(6)?;
            let triggered_str: Option<String> = row.get(7)?;

            Ok(Alarm {
                id: row.get(0)?,
                name: row.get(1)?,
                alarm_type,
                pattern: row.get(3)?,
                enabled: enabled_int != 0,
                notify: notify_int != 0,
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
        "INSERT INTO alarms (id, name, alarm_type, pattern, enabled, notify, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            alarm.id,
            alarm.name,
            alarm_type_str,
            alarm.pattern,
            alarm.enabled as i32,
            alarm.notify as i32,
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

pub fn toggle_alarm_notify_by_id(conn: &Connection, id: &str, notify: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE alarms SET notify = ?1 WHERE id = ?2",
        params![notify as i32, id],
    )
    .map_err(|e| format!("Failed to toggle alarm notify: {}", e))?;
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

// ── User cache persistence ──

pub fn load_user_cache(conn: &Connection) -> Result<std::collections::HashMap<String, crate::models::TwitterUser>, String> {
    let mut stmt = conn
        .prepare("SELECT handle, following, followers, name, description, location, verified, tweet_count, created_at, updated_at FROM user_cache")
        .map_err(|e| format!("Failed to prepare user_cache query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let handle: String = row.get(0)?;
            let following: u64 = row.get::<_, i64>(1).map(|v| v as u64)?;
            let followers: u64 = row.get::<_, i64>(2).map(|v| v as u64)?;
            let name: Option<String> = row.get(3)?;
            let description: Option<String> = row.get(4)?;
            let location: Option<String> = row.get(5)?;
            let verified_int: Option<i32> = row.get(6)?;
            let tweet_count: Option<u64> = row.get::<_, Option<i64>>(7)?.map(|v| v as u64);
            let created_at: Option<String> = row.get(8)?;
            let updated_at: Option<String> = row.get(9)?;

            Ok((handle, crate::models::TwitterUser {
                following,
                followers,
                name,
                description,
                location,
                verified: verified_int.map(|v| v != 0),
                tweet_count,
                created_at,
                updated_at,
                last_accessed: Some(Utc::now()),
            }))
        })
        .map_err(|e| format!("Failed to query user_cache: {}", e))?;

    let mut map = std::collections::HashMap::new();
    for row in rows {
        if let Ok((handle, user)) = row {
            map.insert(handle, user);
        }
    }

    Ok(map)
}

pub fn save_user_cache_batch(
    conn: &Connection,
    users: &std::collections::HashMap<String, crate::models::TwitterUser>,
) -> Result<usize, String> {
    let now = Utc::now().to_rfc3339();
    let mut count = 0usize;

    for (handle, user) in users {
        let updated_time = user.updated_at.clone().unwrap_or_else(|| now.clone());
        conn.execute(
            "INSERT OR REPLACE INTO user_cache (handle, following, followers, name, description, location, verified, tweet_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                handle,
                user.following as i64,
                user.followers as i64,
                user.name,
                user.description,
                user.location,
                user.verified.map(|v| if v { 1i32 } else { 0i32 }),
                user.tweet_count.map(|v| v as i64),
                user.created_at,
                updated_time,
            ],
        )
        .map_err(|e| format!("Failed to upsert user_cache for {}: {}", handle, e))?;
        count += 1;
    }

    Ok(count)
}

pub fn db_path_string(app: &tauri::AppHandle) -> String {
    db_path(app).to_string_lossy().to_string()
}

pub fn get_db_stats(app: &tauri::AppHandle, conn: &Connection) -> Result<crate::models::DbStats, String> {
    let db_p = db_path(app);
    let db_path_str = db_p.to_string_lossy().to_string();
    let db_size_bytes = std::fs::metadata(&db_p).map(|m| m.len()).unwrap_or(0);

    let total_tweets: u64 = conn
        .query_row("SELECT COUNT(*) FROM tweets", [], |r| r.get::<_, i64>(0))
        .map(|v| v as u64)
        .unwrap_or(0);
    let total_alarms: u64 = conn
        .query_row("SELECT COUNT(*) FROM alarms", [], |r| r.get::<_, i64>(0))
        .map(|v| v as u64)
        .unwrap_or(0);
    let total_scheduled_tweets: u64 = conn
        .query_row("SELECT COUNT(*) FROM scheduled_tweets", [], |r| r.get::<_, i64>(0))
        .map(|v| v as u64)
        .unwrap_or(0);
    let cached_users_count: u64 = conn
        .query_row("SELECT COUNT(*) FROM user_cache", [], |r| r.get::<_, i64>(0))
        .map(|v| v as u64)
        .unwrap_or(0);

    Ok(crate::models::DbStats {
        db_path: db_path_str,
        db_size_bytes,
        total_tweets,
        total_alarms,
        total_scheduled_tweets,
        cached_users_count,
    })
}
