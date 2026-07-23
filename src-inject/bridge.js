// ─────────────────────────────────────────────────────────────────────────────
// Tweeker Bridge — Message channel from X.com webview to Rust backend
// ─────────────────────────────────────────────────────────────────────────────
// This module runs inside the X.com webview. It has NO access to Tauri IPC.
// Communication to Rust happens via window.postMessage, which Tauri captures
// through the webview's message handler.
// ─────────────────────────────────────────────────────────────────────────────

window.__tweeker = window.__tweeker || {};

/**
 * Send a message to the Rust backend via postMessage.
 * The Rust side listens for messages with the '__tweeker' prefix.
 * @param {string} type - Message type identifier
 * @param {object} payload - Message data
 */
window.__tweeker.sendMessage = function(type, payload) {
    try {
        window.postMessage({
            __tweeker: true,
            type: type,
            payload: payload,
            timestamp: new Date().toISOString()
        }, '*');
    } catch (e) {
        console.warn('[Tweeker Bridge] Failed to send message:', e);
    }
};

/**
 * Send a heartbeat to confirm the interceptor is still alive.
 */
window.__tweeker.heartbeat = function() {
    window.__tweeker.sendMessage('heartbeat', {});
};

/**
 * Send intercepted tweet data to the Rust backend.
 * @param {Array} tweets - Array of parsed tweet objects
 */
window.__tweeker.sendTweets = function(tweets) {
    if (tweets && tweets.length > 0) {
        window.__tweeker.sendMessage('tweet_data', { tweets: tweets });
    }
};

/**
 * Report an error from the interceptor.
 * @param {string} message - Error description
 */
window.__tweeker.reportError = function(message) {
    window.__tweeker.sendMessage('error', { message: message });
};

// Start heartbeat interval (every 10 seconds)
window.__tweeker._heartbeatInterval = setInterval(function() {
    window.__tweeker.heartbeat();
}, 10000);

// Send initial heartbeat
window.__tweeker.heartbeat();

console.log('[Tweeker Bridge] Message bridge initialized');
