// ─────────────────────────────────────────────────────────────────────────────
// Tweeker Interceptor — Fetch/XHR monkey-patch + DOM MutationObserver
// ─────────────────────────────────────────────────────────────────────────────
// This module runs inside the X.com webview. It intercepts network requests
// to X.com's API to capture tweet data, and observes DOM mutations to detect
// new tweets appearing in the timeline.
//
// All captured data is sent to the Rust backend via the bridge module.
// ─────────────────────────────────────────────────────────────────────────────

(function() {
    'use strict';

    const host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
    const isXDomain = host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');

    if (!isXDomain) {
        console.log('[Tweeker Interceptor] Non-X.com domain detected (' + host + ') — all network interception, DOM observer, and stats injection are disabled.');
        return;
    }

    let isDecoupled = false;
    try {
        isDecoupled = localStorage.getItem('tweeker_decouple_mode') === 'true';
    } catch (e) {}

    if (isDecoupled) {
        console.log('[Tweeker Interceptor] Decoupled mode active — X.com page modifications, fetch/XHR patching, DOM observer, and auto-read pill clicks are disabled.');
        return;
    }

    // Token & QueryId storage for direct X.com API operations
    let capturedAuthToken = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAn%2Bx1%2Bq%2B4t7D43W5a%2F4%2B15DII5w%3D930W2AuSilKhBmAhx526gWgjTZRBBBmoP9GczOfLhWY';
    let capturedCsrfToken = '';
    let capturedCreateTweetQueryId = '5V8HGy9ykoGDjDxTy8HUAQ';
    let capturedUserByScreenNameQueryId = '';
    let capturedUserByScreenNameFeatures = null;
    let capturedUserByScreenNameFieldToggles = null;

    window.__tweeker = window.__tweeker || {};
    window.__tweeker.lazyFetchQueue = window.__tweeker.lazyFetchQueue || new Set();
    let lazyFetchActive = false;
    let lastLazyFetchTime = 0;
    const MIN_LAZY_FETCH_COOLDOWN_MS = 20000;
    const MAX_LAZY_FETCHES_PER_SESSION = 50;
    let lazyFetchCount = 0;
    window.__tweeker.userCache = window.__tweeker.userCache || {};
    window.__tweeker.pendingUserRequests = window.__tweeker.pendingUserRequests || new Set();
    window.__tweeker.tweetCache = window.__tweeker.tweetCache || {};
    window.__tweeker.tweetContentCache = window.__tweeker.tweetContentCache || {};
    window.__tweeker.notificationMap = window.__tweeker.notificationMap || {};
    window.__tweeker.pendingTweetRequests = window.__tweeker.pendingTweetRequests || new Set();
    window.__tweeker.pendingSnippetRequests = window.__tweeker.pendingSnippetRequests || new Set();

    let lastSavedUrl = window.location.href;

    function checkAndSaveCurrentUrl() {
        try {
            const href = window.location.href;
            if (!href || href === 'about:blank') return;
            if (href.startsWith('https://x.com') || href.startsWith('https://twitter.com')) {
                if (href !== lastSavedUrl) {
                    lastSavedUrl = href;
                    localStorage.setItem('tweeker_last_url', href);
                    window.__tweeker.sendMessage('save_last_url', { url: href });
                }
            }
        } catch (e) {}
    }

    window.addEventListener('popstate', checkAndSaveCurrentUrl);
    window.addEventListener('beforeunload', checkAndSaveCurrentUrl);
    setInterval(checkAndSaveCurrentUrl, 2000);

    try {
        const savedUrl = localStorage.getItem('tweeker_last_url');
        if (savedUrl && (window.location.pathname === '/' || window.location.pathname === '') && savedUrl !== window.location.href) {
            if (savedUrl.startsWith('https://x.com') || savedUrl.startsWith('https://twitter.com')) {
                window.location.href = savedUrl;
            }
        }
    } catch (e) {}

    function stripLeadingMentions(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/^(?:@[\w_]+\s*)+/, '').trim();
    }

    function normalizeTweetText(text) {
        if (!text || typeof text !== 'string') return '';
        const clean = stripLeadingMentions(text);
        return clean
            .replace(/https?:\/\/t\.co\/\w+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function cacheTweet(tweet) {
        if (!tweet || !tweet.tweet_id) return;
        window.__tweeker.tweetCache[tweet.tweet_id] = tweet;
        if (tweet.content) {
            const norm = normalizeTweetText(tweet.content);
            if (norm && norm.length >= 8) {
                window.__tweeker.tweetContentCache[norm] = tweet.tweet_id;
                const key = norm.length > 40 ? norm.substring(0, 40) : norm;
                window.__tweeker.tweetContentCache[key] = tweet.tweet_id;
            }
        }
    }

    let debugTwitterEnabled = false;
    let relevantFollowersLimit = 2500;
    let relevantHighlightColor = '#00ba7c';
    let recentTweetDurationMinutes = 3;
    let listMinFollowers = 0;
    let listMinRatio = 0.0;
    let listHighlightVerified = false;
    let listVerifiedColor = '#1d9bf0';
    let listHighlightMega = false;
    let listMegaColor = '#a855f7';

    let userCountsBatchQueue = new Set();
    let userCountsBatchTimer = null;

    function requestUserCounts(handle) {
        if (!handle) return;
        const lowerHandle = handle.toLowerCase();
        if (window.__tweeker.userCache[lowerHandle]) return;
        if (window.__tweeker.pendingUserRequests.has(lowerHandle)) return;

        window.__tweeker.pendingUserRequests.add(lowerHandle);
        userCountsBatchQueue.add(lowerHandle);

        if (userCountsBatchQueue.size >= 50) {
            flushUserCountsBatch();
        } else if (!userCountsBatchTimer) {
            userCountsBatchTimer = setTimeout(flushUserCountsBatch, 150);
        }
    }

    function flushUserCountsBatch() {
        if (userCountsBatchTimer) {
            clearTimeout(userCountsBatchTimer);
            userCountsBatchTimer = null;
        }

        if (userCountsBatchQueue.size === 0) return;

        const handles = Array.from(userCountsBatchQueue);
        userCountsBatchQueue.clear();

        sendDebugLog(`Batch-querying database cache for ${handles.length} user(s)`);
        window.__tweeker.sendMessage('get_users_counts_batch', { handles: handles });
    }

    let tweetStatsBatchQueue = new Set();
    let tweetStatsBatchTimer = null;

    function requestTweetStats(tweetId) {
        if (!tweetId) return;
        if (window.__tweeker.tweetCache[tweetId]) return;
        if (window.__tweeker.pendingTweetRequests.has(tweetId)) return;

        window.__tweeker.pendingTweetRequests.add(tweetId);
        tweetStatsBatchQueue.add(tweetId);

        if (tweetStatsBatchQueue.size >= 50) {
            flushTweetStatsBatch();
        } else if (!tweetStatsBatchTimer) {
            tweetStatsBatchTimer = setTimeout(flushTweetStatsBatch, 150);
        }
    }

    function flushTweetStatsBatch() {
        if (tweetStatsBatchTimer) {
            clearTimeout(tweetStatsBatchTimer);
            tweetStatsBatchTimer = null;
        }

        if (tweetStatsBatchQueue.size === 0) return;

        const tweetIds = Array.from(tweetStatsBatchQueue);
        tweetStatsBatchQueue.clear();

        sendDebugLog(`Batch-querying database cache for ${tweetIds.length} tweet(s)`);
        window.__tweeker.sendMessage('get_tweet_stats_batch', { tweet_ids: tweetIds });
    }

    let tweetSnippetBatchQueue = new Set();
    let tweetSnippetBatchTimer = null;

    function requestTweetContentSnippet(snippet) {
        if (!snippet) return;
        const norm = normalizeTweetText(snippet);
        if (!norm || norm.length < 8) return;
        const key = norm.length > 40 ? norm.substring(0, 40) : norm;

        if (window.__tweeker.tweetContentCache[key]) return;
        if (window.__tweeker.pendingSnippetRequests.has(key)) return;

        window.__tweeker.pendingSnippetRequests.add(key);
        tweetSnippetBatchQueue.add(key);

        if (tweetSnippetBatchQueue.size >= 50) {
            flushTweetSnippetBatch();
        } else if (!tweetSnippetBatchTimer) {
            tweetSnippetBatchTimer = setTimeout(flushTweetSnippetBatch, 150);
        }
    }

    function flushTweetSnippetBatch() {
        if (tweetSnippetBatchTimer) {
            clearTimeout(tweetSnippetBatchTimer);
            tweetSnippetBatchTimer = null;
        }

        if (tweetSnippetBatchQueue.size === 0) return;

        const snippets = Array.from(tweetSnippetBatchQueue);
        tweetSnippetBatchQueue.clear();

        sendDebugLog(`Batch-querying database by content snippet for ${snippets.length} item(s)`);
        window.__tweeker.sendMessage('get_tweets_by_content_batch', { snippets: snippets });
    }

    function sendDebugLog(text) {
        window.__tweeker.sendMessage('debug_log', { text: text });
    }

    function formatCount(num) {
        if (num === undefined || num === null) return '?';
        const n = Number(num);
        if (isNaN(n)) return '?';
        if (n >= 1e6) {
            return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (n >= 1e3) {
            return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return n.toString();
    }

    function extractUsersFromJSON(obj, usersMap) {
        if (!obj || typeof obj !== 'object') return;

        let handle = null;
        let name = null;
        let followers = null;
        let following = null;
        let description = null;
        let location = null;
        let verified = null;
        let tweetCount = null;
        let createdAt = null;

        // Modern X.com format
        if (obj.core && typeof obj.core === 'object') {
            handle = obj.core.screen_name || (obj.legacy && obj.legacy.screen_name);
            name = obj.core.name || (obj.legacy && obj.legacy.name);
        }
        if (obj.legacy && typeof obj.legacy === 'object') {
            if (!handle) handle = obj.legacy.screen_name;
            if (!name) name = obj.legacy.name;
            if (obj.legacy.description) description = obj.legacy.description;
            if (obj.legacy.location) location = obj.legacy.location;
            if (obj.legacy.verified !== undefined) verified = !!obj.legacy.verified;
            if (obj.legacy.statuses_count !== undefined) tweetCount = parseInt(obj.legacy.statuses_count, 10);
            if (obj.legacy.created_at) createdAt = obj.legacy.created_at;
            if (obj.legacy.followers_count !== undefined) followers = parseInt(obj.legacy.followers_count, 10);
            if (obj.legacy.friends_count !== undefined) following = parseInt(obj.legacy.friends_count, 10);
        }
        if (obj.relationship_counts && typeof obj.relationship_counts === 'object') {
            if (obj.relationship_counts.followers !== undefined) followers = parseInt(obj.relationship_counts.followers, 10);
            if (obj.relationship_counts.following !== undefined) following = parseInt(obj.relationship_counts.following, 10);
        }

        if (typeof obj.screen_name === 'string') {
            if (!handle) handle = obj.screen_name;
            if (!name && obj.name) name = obj.name;
            if (description === null && obj.description) description = obj.description;
            if (location === null && obj.location) location = obj.location;
            if (verified === null && obj.verified !== undefined) verified = !!obj.verified;
            if (tweetCount === null && obj.statuses_count !== undefined) tweetCount = parseInt(obj.statuses_count, 10);
            if (createdAt === null && obj.created_at) createdAt = obj.created_at;
            if (followers === null && obj.followers_count !== undefined) followers = parseInt(obj.followers_count, 10);
            if (following === null && obj.friends_count !== undefined) following = parseInt(obj.friends_count, 10);
        }
        if (obj.is_blue_verified !== undefined && verified === null) {
            verified = !!obj.is_blue_verified;
        }

        if (typeof handle === 'string' && (followers !== null || following !== null || name !== null)) {
            const lowerHandle = handle.toLowerCase();
            const existing = usersMap[lowerHandle] || {};
            usersMap[lowerHandle] = {
                following: following !== null && !isNaN(following) ? following : (existing.following || 0),
                followers: followers !== null && !isNaN(followers) ? followers : (existing.followers || 0),
                name: name || existing.name || null,
                description: description || existing.description || null,
                location: location || existing.location || null,
                verified: verified !== null ? verified : (existing.verified || null),
                tweet_count: tweetCount !== null && !isNaN(tweetCount) ? tweetCount : (existing.tweet_count || null),
                created_at: createdAt || existing.created_at || null,
                updated_at: new Date().toISOString(),
            };
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                extractUsersFromJSON(item, usersMap);
            }
        } else {
            for (const key of Object.keys(obj)) {
                extractUsersFromJSON(obj[key], usersMap);
            }
        }
    }

    function findScreenNamePaths(obj, path, parentObj) {
        if (!obj || typeof obj !== 'object') return;
        path = path || 'root';

        if (typeof obj.screen_name === 'string') {
            const keys = Object.keys(obj);
            let parentMsg = '';
            if (parentObj) {
                const parentKeys = Object.keys(parentObj);
                parentMsg = `. Parent keys: ${parentKeys.join(', ')}`;
                if (parentObj.legacy && typeof parentObj.legacy === 'object') {
                    const legacyKeys = Object.keys(parentObj.legacy);
                    parentMsg += `. Parent.legacy keys: ${legacyKeys.join(', ')}`;
                }
                if (parentObj.relationship_counts && typeof parentObj.relationship_counts === 'object') {
                    const relKeys = Object.keys(parentObj.relationship_counts);
                    parentMsg += `. Parent.relationship_counts: ${JSON.stringify(parentObj.relationship_counts)}`;
                }
                if (parentObj.tweet_counts && typeof parentObj.tweet_counts === 'object') {
                    parentMsg += `. Parent.tweet_counts: ${JSON.stringify(parentObj.tweet_counts)}`;
                }
            }
            sendDebugLog(`Found screen_name at: ${path}. Sibling keys: ${keys.join(', ')}${parentMsg}`);
        }

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                findScreenNamePaths(obj[i], `${path}[${i}]`, obj);
            }
        } else {
            for (const key of Object.keys(obj)) {
                findScreenNamePaths(obj[key], `${path}.${key}`, obj);
            }
        }
    }

    function injectUserStats(parentEl, avatarEl, handle, following, followers) {
        if (!parentEl || !avatarEl) return null;

        let statsEl = parentEl.querySelector('.tweeker-tweet-user-stats');
        if (!statsEl) {
            statsEl = document.createElement('div');
            statsEl.className = 'tweeker-tweet-user-stats';
            parentEl.insertBefore(statsEl, avatarEl.nextSibling);
        }

        const formattedFollowing = formatCount(following);
        const formattedFollowers = formatCount(followers);

        let ratioText = '?';
        let classColorClass = 'status-casual';
        let classLabel = 'Casual';

        if (following !== undefined && followers !== undefined && following !== null && followers !== null) {
            const rawRatio = followers / Math.max(following, 1);
            ratioText = rawRatio.toFixed(1);

            if (followers < 50 && rawRatio < 0.2) {
                classLabel = 'Spam/Bot';
                classColorClass = 'status-spam';
            } else if (followers > 100000 && rawRatio > 10.0) {
                classLabel = 'Mega-Influencer';
                classColorClass = 'status-mega';
            } else if (followers > 10000 && rawRatio > 5.0) {
                classLabel = 'Influencer';
                classColorClass = 'status-influencer';
            } else if (followers > 1000 && rawRatio >= 0.8 && rawRatio <= 5.0) {
                classLabel = 'Power User';
                classColorClass = 'status-power';
            }
        }

        const cleanHandle = handle ? handle.replace(/^@/, '') : 'user';

        statsEl.innerHTML = `
            <div class="tweeker-stats-following">${formattedFollowing}</div>
            <div class="tweeker-stats-followers">${formattedFollowers}</div>
            <div class="tweeker-stats-ratio">R: ${ratioText}</div>
            <div class="tweeker-stats-tooltip">
                <strong>@${cleanHandle}</strong>
                <div class="tooltip-row">Following: <span>${following !== null && following !== undefined ? following.toLocaleString() : '?'}</span></div>
                <div class="tooltip-row">Followers: <span>${followers !== null && followers !== undefined ? followers.toLocaleString() : '?'}</span></div>
                <div class="tooltip-row">Ratio: <span>${ratioText}</span></div>
                <div class="tooltip-row">Status: <span class="status-badge ${classColorClass}">${classLabel}</span></div>
            </div>
        `;
        return statsEl;
    }

    function renderStatsBelowAvatar(tweetEl, following, followers) {
        const avatar = tweetEl.querySelector('[data-testid="Tweet-User-Avatar"]');
        if (!avatar) return;
        const handle = tweetEl.dataset.tweekerAuthor || '';
        injectUserStats(avatar.parentNode, avatar, handle, following, followers);
    }

    function updateStatsForAuthor(handle) {
        const lowerHandle = handle.toLowerCase();
        const stats = window.__tweeker.userCache[lowerHandle];
        if (!stats) return;

        const tweets = document.querySelectorAll(`article[data-testid="tweet"][data-tweeker-author="${lowerHandle}"]`);
        for (const tweet of tweets) {
            renderStatsBelowAvatar(tweet, stats.following, stats.followers);
            evaluateTweetHighlight(tweet);
        }

        const userCells = document.querySelectorAll(`[data-testid="UserCell"][data-tweeker-author="${lowerHandle}"]`);
        for (const cell of userCells) {
            renderStatsForUserCell(cell, stats.following, stats.followers);
            applyListFiltersToCell(cell);
        }

        highlightAllAvatars();
    }

    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function processUserAvatar(avatarContainer, handle) {
        if (!avatarContainer || !handle) return;
        
        // Guard against accidentally highlighting whole notification/timeline row containers
        if (avatarContainer.offsetWidth > 120 || avatarContainer.offsetHeight > 120) return;

        const lowerHandle = handle.toLowerCase();
        const stats = window.__tweeker.userCache[lowerHandle];

        if (!stats) {
            requestUserCounts(lowerHandle);
            return;
        }

        const isRelevant = typeof stats.followers === 'number' && stats.followers >= relevantFollowersLimit;

        if (isRelevant) {
            const color = relevantHighlightColor;
            const glowColor = hexToRgba(color, 0.5);
            avatarContainer.style.outline = `3.5px solid ${color}`;
            avatarContainer.style.outlineOffset = '0px';
            avatarContainer.style.borderRadius = '50%';
            avatarContainer.style.boxShadow = `0 0 8px ${glowColor}`;
            avatarContainer.title = `@${handle}: ${stats.followers.toLocaleString()} followers (Relevant User)`;
        } else {
            avatarContainer.style.outline = 'none';
            avatarContainer.style.outlineOffset = '0px';
            avatarContainer.style.boxShadow = 'none';
            avatarContainer.title = `@${handle}: ${(stats.followers || 0).toLocaleString()} followers`;
        }
    }

    function highlightAllAvatars() {
        try {
            // ── Notification & UserAvatar containers ──
            const avatarContainers = document.querySelectorAll('[data-testid^="UserAvatar-Container-"]');
            for (const container of avatarContainers) {
                const testId = container.getAttribute('data-testid') || '';
                const handle = testId.replace('UserAvatar-Container-', '');
                if (handle) {
                    processUserAvatar(container, handle);
                }
            }

            // Fallback for notification links containing user profile hrefs
            const notifArticles = document.querySelectorAll('article[data-testid="notification"]');
            for (const notif of notifArticles) {
                const userLinks = notif.querySelectorAll('a[href^="/"]');
                for (const link of userLinks) {
                    const href = link.getAttribute('href') || '';
                    const parts = href.split('/').filter(Boolean);
                    if (parts.length === 1) {
                        const handle = parts[0];
                        if (handle && !['home', 'notifications', 'explore', 'messages', 'settings', 'i', 'compose', 'search', 'tos', 'privacy', 'status'].includes(handle.toLowerCase())) {
                            const img = link.querySelector('img');
                            if (img) {
                                const imgContainer = img.closest('[data-testid^="UserAvatar-Container-"]') || img.closest('[data-testid="Tweet-User-Avatar"]') || img.parentElement;
                                if (imgContainer) {
                                    processUserAvatar(imgContainer, handle);
                                }
                            }
                        }
                    }
                }
            }

            // ── Timeline tweet avatars ──
            const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
            for (const tweet of tweetArticles) {
                const author = tweet.dataset.tweekerAuthor;
                if (!author) continue;
                const avatarLink = tweet.querySelector('[data-testid="Tweet-User-Avatar"]');
                if (avatarLink) {
                    const img = avatarLink.querySelector('img');
                    const imgContainer = img ? (img.closest('[data-testid^="UserAvatar-Container-"]') || img.closest('[data-testid="Tweet-User-Avatar"]') || img.parentElement) : null;
                    if (imgContainer) {
                        processUserAvatar(imgContainer, author);
                    }
                }
            }
        } catch (e) {
            console.debug('[Tweeker Interceptor] Avatar highlight error:', e);
        }
    }

    function getHeaderValue(headers, name) {
        if (!headers) return null;
        if (typeof headers.get === 'function') {
            return headers.get(name) || headers.get(name.toLowerCase());
        }
        if (typeof headers === 'object') {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === name.toLowerCase()) {
                    return headers[key];
                }
            }
        }
        return null;
    }

    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
        try {
            const options = args[1] || {};
            const headers = options.headers || (args[0] && typeof args[0] === 'object' ? args[0].headers : null);
            if (headers) {
                const auth = getHeaderValue(headers, 'authorization');
                if (auth && auth.startsWith('Bearer ')) {
                    capturedAuthToken = auth;
                }
                const csrf = getHeaderValue(headers, 'x-csrf-token');
                if (csrf) {
                    capturedCsrfToken = csrf;
                }
            }

            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if (url.includes('/CreateTweet')) {
                const match = url.match(/\/graphql\/([^\/]+)\/CreateTweet/);
                if (match && match[1]) {
                    capturedCreateTweetQueryId = match[1];
                }
            }
            if (url.includes('/UserByScreenName') || url.includes('/UserResultByScreenName')) {
                const match = url.match(/\/graphql\/([^\/]+)\/(UserByScreenName|UserResultByScreenName)/);
                if (match && match[1]) {
                    capturedUserByScreenNameQueryId = match[1];
                }
                try {
                    const parsedUrl = new URL(url);
                    const featuresParam = parsedUrl.searchParams.get('features');
                    if (featuresParam) {
                        capturedUserByScreenNameFeatures = JSON.parse(featuresParam);
                    }
                    const fieldTogglesParam = parsedUrl.searchParams.get('fieldToggles');
                    if (fieldTogglesParam) {
                        capturedUserByScreenNameFieldToggles = JSON.parse(fieldTogglesParam);
                    }
                } catch (err) {}
            }
        } catch (e) {}

        const response = await originalFetch.apply(this, args);
        
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            
            // Intercept timeline and tweet-related API endpoints
            if (isTimelineEndpoint(url)) {
                const opName = url.split('/graphql/')[1]?.split('?')[0] || url.split('/').pop()?.split('?')[0] || 'Unknown';
                sendDebugLog(`Intercepted GraphQL request: ${opName} (URL: ${url})`);

                // Clone the response so we don't consume it
                const clone = response.clone();
                
                clone.json().then(function(data) {
                    sendDebugLog(`Parsed JSON for operation: ${opName}`);
                    try {
                        const tweets = parseApiResponse(data);
                        if (tweets.length > 0) {
                            for (const t of tweets) {
                                cacheTweet(t);
                            }
                            window.__tweeker.sendTweets(tweets);
                            sendDebugLog(`Extracted and cached ${tweets.length} tweet(s) from operation ${opName}`);
                        }
                        updateNotificationTweetStats();
                    } catch (e) {
                        sendDebugLog(`Parse error for ${opName}: ${e.message}`);
                    }

                    try {
                        findScreenNamePaths(data);
                    } catch (e) {}

                    try {
                        const users = {};
                        extractUsersFromJSON(data, users);
                        if (Object.keys(users).length > 0) {
                            window.__tweeker.sendMessage('add_users', { users: users });
                            sendDebugLog(`Extracted ${Object.keys(users).length} user(s) stats from operation ${opName}`);
                            for (const [h, counts] of Object.entries(users)) {
                                window.__tweeker.userCache[h] = counts;
                                updateStatsForAuthor(h);
                            }
                        } else {
                            sendDebugLog(`No user profiles found in JSON of operation ${opName}`);
                        }
                    } catch (e) {
                        sendDebugLog(`User extract error for ${opName}: ${e.message}`);
                    }
                }).catch(function(err) {
                    sendDebugLog(`Failed to parse response body as JSON for operation ${opName}: ${err.message}`);
                });
            }
        } catch (e) {
            // Never break the original fetch
            console.debug('[Tweeker Interceptor] Fetch intercept error:', e.message);
        }

        return response;
    };

    // ── XMLHttpRequest interceptor ──
    // Some X.com requests may still use XHR.

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._tweeker_url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        if (this._tweeker_url && isTimelineEndpoint(this._tweeker_url)) {
            const url = this._tweeker_url;
            const opName = url.split('/graphql/')[1]?.split('?')[0] || url.split('/').pop()?.split('?')[0] || 'Unknown';
            sendDebugLog(`Intercepted GraphQL XHR: ${opName} (URL: ${url})`);

            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    sendDebugLog(`Parsed XHR JSON for operation: ${opName}`);
                    const tweets = parseApiResponse(data);
                    if (tweets.length > 0) {
                        for (const t of tweets) {
                            cacheTweet(t);
                        }
                        window.__tweeker.sendTweets(tweets);
                        sendDebugLog(`Extracted and cached ${tweets.length} tweet(s) from XHR operation ${opName}`);
                    }
                    updateNotificationTweetStats();

                    try {
                        findScreenNamePaths(data);
                    } catch (e) {}

                    const users = {};
                    extractUsersFromJSON(data, users);
                    if (Object.keys(users).length > 0) {
                        window.__tweeker.sendMessage('add_users', { users: users });
                        sendDebugLog(`Extracted ${Object.keys(users).length} user(s) stats from XHR operation ${opName}`);
                        for (const [h, counts] of Object.entries(users)) {
                            window.__tweeker.userCache[h] = counts;
                            updateStatsForAuthor(h);
                        }
                    } else {
                        sendDebugLog(`No user profiles found in XHR JSON of operation ${opName}`);
                    }
                } catch (e) {
                    sendDebugLog(`XHR parse/extract error for ${opName}: ${e.message}`);
                }
            });
        }
        return originalXHRSend.apply(this, args);
    };

    // ── DOM MutationObserver ──
    // Watch for new tweet elements being added to the timeline with debouncing & deduplication.

    let observerStarted = false;
    let mutationDebounceTimer = null;
    const pendingNodesToScan = new Set();

    function processPendingDOMNodes() {
        if (pendingNodesToScan.size === 0) return;

        const nodes = Array.from(pendingNodesToScan);
        pendingNodesToScan.clear();

        for (const node of nodes) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.closest) {
                if (node.closest('#tweeker-overlay-container')) continue;
                if (node.closest('[data-testid="tweetTextarea_0"]')) continue;
                if (node.closest('[role="textbox"]')) continue;
                if (node.closest('.DraftEditor-root')) continue;
                if (node.closest('input, textarea, [contenteditable="true"]')) continue;
            }

            if (node.matches) {
                if (node.matches('[data-testid="tweet"]')) {
                    parseDOMTweet(node);
                } else if (node.matches('[data-testid="UserCell"]')) {
                    parseDOMUserCell(node);
                } else if (node.matches('[data-testid="notification"]')) {
                    parseDOMNotification(node);
                }
            }
            if (node.querySelectorAll) {
                const articles = node.querySelectorAll('[data-testid="tweet"]');
                for (const article of articles) {
                    parseDOMTweet(article);
                }
                const userCells = node.querySelectorAll('[data-testid="UserCell"]');
                for (const cell of userCells) {
                    parseDOMUserCell(cell);
                }
                const notifications = node.querySelectorAll('[data-testid="notification"]');
                for (const notif of notifications) {
                    parseDOMNotification(notif);
                }
            }
        }
    }

    function startDOMObserver() {
        if (observerStarted) return;

        const checkInterval = setInterval(function() {
            const timeline = document.querySelector('[data-testid="primaryColumn"]') ||
                             document.querySelector('main[role="main"]') ||
                             document.querySelector('main');

            if (timeline) {
                clearInterval(checkInterval);
                observerStarted = true;

                const observer = new MutationObserver(function(mutations) {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.closest) {
                    if (node.closest('#tweeker-overlay-container')) continue;
                    if (node.closest('[data-testid="tweetTextarea_0"]')) continue;
                    if (node.closest('[role="textbox"]')) continue;
                    if (node.closest('.DraftEditor-root')) continue;
                    if (node.closest('input, textarea, [contenteditable="true"]')) continue;
                }
                pendingNodesToScan.add(node);
            }
                        }
                    }

                    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
                    mutationDebounceTimer = setTimeout(processPendingDOMNodes, 300);
                });

                observer.observe(timeline, {
                    childList: true,
                    subtree: true,
                });

                console.log('[Tweeker Interceptor] DOM observer started on timeline');
            }
        }, 1000);
    }

    // ── Auto Read feature ──
    // Automatically clicks X.com "New Tweets" pill when visible and processes all timeline messages.

    let autoReadEnabled = false;
    let autoReadIntervalTimer = null;
    let lastAutoReadClickTime = 0;
    let autoReadPendingClickTimer = null;
    const MIN_AUTO_READ_COOLDOWN_MS = 5000; // Minimum 5 seconds between auto-clicks

    function isUserTyping() {
        const active = document.activeElement;
        if (!active) return false;
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true;
        if (active.isContentEditable) return true;
        if (active.closest && (active.closest('[role="textbox"]') || active.closest('.DraftEditor-root'))) return true;
        return false;
    }

    function triggerAutoReadCheck() {
        if (!autoReadEnabled) return;
        // Never interfere while the user is actively typing a tweet, reply, or form input
        if (isUserTyping()) return;
        // Never trigger clicks when the page is hidden or blurred
        if (document.hidden) return;

        try {
            // 1. Search strictly for X.com new tweets pill button
            const pillLabel = document.querySelector('[data-testid="pillLabel"]');
            let pillBtn = null;

            if (pillLabel) {
                pillBtn = pillLabel.closest ? (pillLabel.closest('[role="button"]') || pillLabel) : pillLabel;
            } else {
                // Strict query for floating new posts notification pills only (never generic buttons)
                pillBtn = document.querySelector('[aria-label*="New posts"]')
                    || document.querySelector('[aria-label*="See new posts"]')
                    || document.querySelector('[aria-label*="Show new tweets"]');
            }

            if (pillBtn && typeof pillBtn.click === 'function') {
                const isComposerBtn = pillBtn.closest && (
                    pillBtn.closest('[data-testid="tweetTextarea_0"]') ||
                    pillBtn.closest('[role="textbox"]') ||
                    pillBtn.closest('.DraftEditor-root') ||
                    pillBtn.closest('#tweeker-overlay-container')
                );
                if (!isComposerBtn) {
                    const now = Date.now();
                    // Anti-abuse guardrail: enforce minimum cooldown between clicks (min 5s)
                    if (now - lastAutoReadClickTime >= MIN_AUTO_READ_COOLDOWN_MS && !autoReadPendingClickTimer) {
                        // Human reaction jitter (800ms - 2200ms delay) to mimic natural human reading/notice time
                        const humanJitterMs = Math.floor(800 + Math.random() * 1400);
                        sendDebugLog(`[Guardrails] Auto-read pill detected. Scheduling human-simulated click in ${humanJitterMs}ms...`);

                        autoReadPendingClickTimer = setTimeout(function() {
                            autoReadPendingClickTimer = null;
                            if (!autoReadEnabled || isUserTyping() || document.hidden) return;
                            
                            // Re-verify pill button is still present in DOM before clicking
                            if (document.body.contains(pillBtn)) {
                                lastAutoReadClickTime = Date.now();
                                sendDebugLog('[Guardrails] Auto-read: executing human-simulated click');
                                pillBtn.click();
                            }
                        }, humanJitterMs);
                    }
                }
            }

            // 2. Scan timeline DOM for any unparsed tweets
            const timeline = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
            if (timeline) {
                const articles = timeline.querySelectorAll('[data-testid="tweet"]');
                for (const article of articles) {
                    parseDOMTweet(article);
                }
            }
        } catch (e) {
            console.debug('[Tweeker Interceptor] Auto read check error:', e);
        }
    }

    function updateAutoReadState(enabled) {
        autoReadEnabled = !!enabled;
        if (autoReadIntervalTimer) {
            clearInterval(autoReadIntervalTimer);
            autoReadIntervalTimer = null;
        }

        if (autoReadEnabled) {
            console.log('[Tweeker Interceptor] Auto read ACTIVE');
            triggerAutoReadCheck();
            autoReadIntervalTimer = setInterval(triggerAutoReadCheck, 2000);
        } else {
            console.log('[Tweeker Interceptor] Auto read INACTIVE');
        }
    }

    function triggerLazyFetchLoop() {
        if (lazyFetchActive) return;
        if (window.__tweeker.lazyFetchQueue.size === 0) return;
        if (lazyFetchCount >= MAX_LAZY_FETCHES_PER_SESSION) {
            console.debug('[Tweeker Lazy Fetch] Max session fetch limit reached. Stopping.');
            return;
        }

        lazyFetchActive = true;
        processNextLazyFetch();
    }

    async function processNextLazyFetch() {
        if (window.__tweeker.lazyFetchQueue.size === 0 || lazyFetchCount >= MAX_LAZY_FETCHES_PER_SESSION) {
            lazyFetchActive = false;
            return;
        }

        // Yield immediately if typing or page is hidden
        if (isUserTyping() || document.hidden) {
            setTimeout(processNextLazyFetch, 5000);
            return;
        }

        const handle = window.__tweeker.lazyFetchQueue.values().next().value;
        window.__tweeker.lazyFetchQueue.delete(handle);

        if (!handle) {
            setTimeout(processNextLazyFetch, 1000);
            return;
        }

        if (window.__tweeker.userCache[handle]) {
            processNextLazyFetch();
            return;
        }

        if (!capturedAuthToken || !capturedCsrfToken || !capturedUserByScreenNameQueryId) {
            window.__tweeker.lazyFetchQueue.add(handle);
            console.debug('[Tweeker Lazy Fetch] Awaiting UserByScreenName credentials/queryId...');
            setTimeout(processNextLazyFetch, 10000);
            return;
        }

        const now = Date.now();
        const elapsed = now - lastLazyFetchTime;
        if (elapsed < MIN_LAZY_FETCH_COOLDOWN_MS) {
            const waitTime = MIN_LAZY_FETCH_COOLDOWN_MS - elapsed;
            setTimeout(processNextLazyFetch, waitTime);
            return;
        }

        // Anti-abuse: Randomized human jitter (5s - 15s)
        const jitter = Math.floor(5000 + Math.random() * 10000);
        await new Promise(r => setTimeout(r, jitter));

        try {
            console.log(`[Tweeker Lazy Fetch] Requesting profile stats for @${handle}...`);
            const variables = {
                screen_name: handle,
                withSafetyModeUserFields: true
            };
            const features = capturedUserByScreenNameFeatures || {
                hidden_profile_likes_enabled: true,
                hidden_profile_subscriptions_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                subscriptions_verification_info_is_identity_verified_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true
            };
            const fieldToggles = capturedUserByScreenNameFieldToggles || {
                withAuxiliaryUserProperties: false
            };

            const url = `https://x.com/i/api/graphql/${capturedUserByScreenNameQueryId}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

            const res = await originalFetch(url, {
                method: 'GET',
                headers: {
                    'authorization': capturedAuthToken,
                    'x-csrf-token': capturedCsrfToken,
                    'x-twitter-auth-type': 'OAuth2Session',
                    'x-twitter-active-user': 'yes'
                },
                credentials: 'include'
            });

            lastLazyFetchTime = Date.now();
            lazyFetchCount++;

            if (res.ok) {
                const data = await res.json().catch(() => null);
                if (data) {
                    const extractedUsers = {};
                    extractUsersFromJSON(data, extractedUsers);
                    const counts = extractedUsers[handle];
                    if (counts) {
                        console.log(`[Tweeker Lazy Fetch] Successfully fetched profile stats for @${handle}: ${counts.followers} followers`);
                        window.__tweeker.userCache[handle] = counts;
                        updateStatsForAuthor(handle);
                        window.__tweeker.sendMessage('add_users', { users: { [handle]: counts } });
                    } else {
                        window.__tweeker.userCache[handle] = { followers: 0, following: 0, dummy: true };
                        updateStatsForAuthor(handle);
                    }
                }
            } else if (res.status === 429) {
                window.__tweeker.lazyFetchQueue.add(handle);
                console.warn('[Tweeker Lazy Fetch] Rate limited (429). Backing off for 2 minutes.');
                setTimeout(processNextLazyFetch, 120000);
                return;
            } else {
                console.warn(`[Tweeker Lazy Fetch] HTTP error ${res.status} fetching @${handle}`);
            }
        } catch (err) {
            console.error('[Tweeker Lazy Fetch] Error:', err);
        }

        setTimeout(processNextLazyFetch, MIN_LAZY_FETCH_COOLDOWN_MS);
    }

    // Listen for Auto Read toggle & Direct API Tweet events from overlay app.js
    window.addEventListener('message', async function(event) {
        if (!event.data || !event.data.__tweeker) return;

        if (event.data.type === 'purge_storage') {
            window.__tweeker.userCache = {};
            window.__tweeker.tweetCache = {};
            window.__tweeker.tweetContentCache = {};
            window.__tweeker.notificationMap = {};
            sendDebugLog('Interceptor cache purged successfully');
        }

        if (event.data.type === 'set_auto_read') {
            updateAutoReadState(event.data.enabled);
        }

        if (event.data.type === 'set_debug_twitter') {
            debugTwitterEnabled = !!event.data.enabled;
        }

        if (event.data.type === 'set_recent_settings') {
            recentTweetDurationMinutes = typeof event.data.duration === 'number' ? event.data.duration : 3;
            const timeline = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main');
            if (timeline) {
                const articles = timeline.querySelectorAll('[data-testid="tweet"]');
                for (const article of articles) {
                    evaluateTweetHighlight(article);
                }
            }
        }

        if (event.data.type === 'set_notif_stats_colors') {
            const colors = event.data.colors || {};
            const root = document.documentElement;
            if (colors.bg) root.style.setProperty('--tweeker-notif-bg', colors.bg);
            if (colors.likes) root.style.setProperty('--tweeker-notif-likes', colors.likes);
            if (colors.retweets) root.style.setProperty('--tweeker-notif-retweets', colors.retweets);
            if (colors.replies) root.style.setProperty('--tweeker-notif-replies', colors.replies);
            if (colors.views) root.style.setProperty('--tweeker-notif-views', colors.views);
        }

        if (event.data.type === 'set_relevant_followers_limit') {
            relevantFollowersLimit = typeof event.data.limit === 'number' ? event.data.limit : 2500;
            if (typeof event.data.color === 'string' && event.data.color) {
                relevantHighlightColor = event.data.color;
            }
            highlightAllAvatars();
        }

        if (event.data.type === 'set_relevant_highlight_color') {
            if (typeof event.data.color === 'string' && event.data.color) {
                relevantHighlightColor = event.data.color;
            }
            highlightAllAvatars();
        }

        if (event.data.type === 'set_list_filter_settings') {
            const config = event.data.config || {};
            listMinFollowers = typeof config.minFollowers === 'number' ? config.minFollowers : 0;
            listMinRatio = typeof config.minRatio === 'number' ? config.minRatio : 0.0;
            listHighlightVerified = !!config.highlightVerified;
            listVerifiedColor = typeof config.verifiedColor === 'string' ? config.verifiedColor : '#1d9bf0';
            listHighlightMega = !!config.highlightMega;
            listMegaColor = typeof config.megaColor === 'string' ? config.megaColor : '#a855f7';
            applyListFiltersToAllCells();
        }

        if (event.data.type === 'user_counts_response') {
            const { handle, counts } = event.data.payload;
            if (handle) {
                const lowerHandle = handle.toLowerCase();
                window.__tweeker.pendingUserRequests.delete(lowerHandle);
                if (counts) {
                    sendDebugLog(`Found cached stats in database for @${lowerHandle}: ${counts.followers} followers, ${counts.following} following`);
                    window.__tweeker.userCache[lowerHandle] = counts;
                    updateStatsForAuthor(lowerHandle);
                } else {
                    if (!window.__tweeker.userCache[lowerHandle]) {
                        window.__tweeker.lazyFetchQueue.add(lowerHandle);
                        triggerLazyFetchLoop();
                    }
                }
            }
        }

        if (event.data.type === 'user_counts_batch_response') {
            const users = event.data.payload && event.data.payload.users;
            if (users && typeof users === 'object') {
                let foundCount = 0;
                for (const [handle, counts] of Object.entries(users)) {
                    const lowerHandle = handle.toLowerCase();
                    window.__tweeker.pendingUserRequests.delete(lowerHandle);
                    if (counts) {
                        foundCount++;
                        window.__tweeker.userCache[lowerHandle] = counts;
                        updateStatsForAuthor(lowerHandle);
                    } else {
                        if (!window.__tweeker.userCache[lowerHandle]) {
                            window.__tweeker.lazyFetchQueue.add(lowerHandle);
                            triggerLazyFetchLoop();
                        }
                    }
                }
                if (foundCount > 0) {
                    sendDebugLog(`Batch query returned stats for ${foundCount} user(s)`);
                    applyListFiltersToAllCells();
                    highlightAllAvatars();
                }
            }
        }

        if (event.data.type === 'tweet_stats_batch_response') {
            const tweets = event.data.payload && event.data.payload.tweets;
            if (tweets && typeof tweets === 'object') {
                let foundCount = 0;
                for (const [tweetId, tweetObj] of Object.entries(tweets)) {
                    window.__tweeker.pendingTweetRequests.delete(tweetId);
                    if (tweetObj) {
                        foundCount++;
                        cacheTweet(tweetObj);
                    }
                }
                if (foundCount > 0) {
                    sendDebugLog(`Batch query returned stats for ${foundCount} tweet(s)`);
                    updateNotificationTweetStats();
                }
            }
        }

        if (event.data.type === 'tweets_by_content_batch_response') {
            const tweetsMap = event.data.payload && event.data.payload.tweets;
            if (tweetsMap && typeof tweetsMap === 'object') {
                let foundCount = 0;
                for (const [snippetKey, tweetObj] of Object.entries(tweetsMap)) {
                    window.__tweeker.pendingSnippetRequests.delete(snippetKey);
                    if (tweetObj && tweetObj.tweet_id) {
                        foundCount++;
                        cacheTweet(tweetObj);
                    }
                }
                if (foundCount > 0) {
                    sendDebugLog(`Content snippet batch query returned ${foundCount} tweet(s)`);
                    updateNotificationTweetStats();
                }
            }
        }

        if (event.data.type === 'bulk_tweet_cache') {
            const tweets = event.data.payload && event.data.payload.tweets;
            if (tweets && typeof tweets === 'object') {
                let count = 0;
                for (const [tweetId, tweetObj] of Object.entries(tweets)) {
                    if (tweetObj) {
                        cacheTweet(tweetObj);
                        count++;
                    }
                }
                if (count > 0) {
                    sendDebugLog(`Bulk-loaded ${count} tweets into cache`);
                    updateNotificationTweetStats();
                }
            }
        }

        // Bulk-load persisted user cache from SQLite on startup
        if (event.data.type === 'bulk_user_cache') {
            const users = event.data.payload && event.data.payload.users;
            if (users && typeof users === 'object') {
                let count = 0;
                for (const [handle, stats] of Object.entries(users)) {
                    const lh = handle.toLowerCase();
                    if (!window.__tweeker.userCache[lh]) {
                        window.__tweeker.userCache[lh] = stats;
                        count++;
                    }
                }
                if (count > 0) {
                    sendDebugLog(`Bulk-loaded ${count} users from persistent cache`);
                }
            }
        }

        if (event.data.type === 'post_tweet_api') {
            const requestId = event.data.requestId;
            const content = event.data.content;
            const result = await postTweetViaApi(content);

            window.postMessage({
                __tweeker: true,
                type: 'post_tweet_api_response',
                requestId: requestId,
                result: result
            }, '*');
        }
    });

    let lastPostTweetTime = 0;
    const MIN_POST_TWEET_COOLDOWN_MS = 15000; // Anti-abuse: minimum 15s between automated posts

    /**
     * Post a tweet directly using X.com's native CreateTweet GraphQL endpoint.
     */
    async function postTweetViaApi(content) {
        if (!content) return { success: false, error: 'Empty content' };

        // Anti-abuse guardrail: enforce minimum cooldown between consecutive posts
        const now = Date.now();
        const elapsed = now - lastPostTweetTime;
        if (lastPostTweetTime > 0 && elapsed < MIN_POST_TWEET_COOLDOWN_MS) {
            const waitTime = MIN_POST_TWEET_COOLDOWN_MS - elapsed;
            sendDebugLog(`[Guardrails] Post rate limit active. Delaying automated post by ${Math.ceil(waitTime / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Anti-abuse guardrail: randomized human typing/submission delay jitter (1.5s - 3.5s)
        const postJitterMs = Math.floor(1500 + Math.random() * 2000);
        sendDebugLog(`[Guardrails] Adding ${postJitterMs}ms human submission jitter before posting...`);
        await new Promise(resolve => setTimeout(resolve, postJitterMs));

        lastPostTweetTime = Date.now();

        // Ensure CSRF token is available
        let csrf = capturedCsrfToken;
        if (!csrf) {
            const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]*)/);
            if (match && match[1]) csrf = match[1];
        }

        if (!csrf) {
            console.warn('[Tweeker Interceptor] CSRF token (ct0 cookie) not found for API tweet');
            return { success: false, error: 'CSRF token not found' };
        }

        const queryId = capturedCreateTweetQueryId || '5V8HGy9ykoGDjDxTy8HUAQ';
        const endpointUrl = `https://x.com/i/api/graphql/${queryId}/CreateTweet`;

        const payload = {
            variables: {
                tweet_text: content,
                dark_request: false,
                media: {
                    media_entities: [],
                    possibly_sensitive: false
                },
                semantic_annotation_ids: []
            },
            features: {
                tweetypie_unmention_optimization_enabled: true,
                responsive_web_edit_tweet_api_enabled: true,
                graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                view_counts_everywhere_api_enabled: true,
                longform_notetweets_consumption_enabled: true,
                responsive_web_twitter_article_tweet_consumption_enabled: true,
                tweet_awards_web_tipping_enabled: false,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                freedom_of_speech_not_reach_fetch_enabled: true,
                standardized_nudges_misinfo: true,
                tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
                responsive_web_enhance_cards_enabled: false
            },
            queryId: queryId
        };

        try {
            console.log('[Tweeker Interceptor] Posting tweet via X.com API...');
            const res = await originalFetch(endpointUrl, {
                method: 'POST',
                headers: {
                    'authorization': capturedAuthToken,
                    'x-csrf-token': csrf,
                    'x-twitter-auth-type': 'OAuth2Session',
                    'x-twitter-active-user': 'yes',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'include'
            });

            if (res.ok) {
                const json = await res.json().catch(() => ({}));
                if (!json.errors || json.errors.length === 0) {
                    const tweetResult = json?.data?.create_tweet?.tweet_results?.result;
                    const restId = tweetResult?.rest_id || tweetResult?.legacy?.id_str;
                    if (restId && /^\d+$/.test(restId)) {
                        console.log('[Tweeker Interceptor] Direct X.com API Tweet successfully posted! ID:', restId);
                        return { success: true, tweet_id: restId };
                    }
                }
                console.warn('[Tweeker Interceptor] GraphQL CreateTweet response contained errors or missing numeric ID:', json);
            } else {
                console.warn('[Tweeker Interceptor] GraphQL CreateTweet HTTP ' + res.status);
            }
        } catch (err) {
            console.error('[Tweeker Interceptor] Direct API Tweet exception:', err);
        }

        return await postTweetViaRestApiFallback(content, csrf);
    }

    async function postTweetViaRestApiFallback(content, csrf) {
        try {
            const fallbackUrl = 'https://x.com/1.1/statuses/update.json';
            const bodyParams = new URLSearchParams();
            bodyParams.append('status', content);

            const res = await originalFetch(fallbackUrl, {
                method: 'POST',
                headers: {
                    'authorization': capturedAuthToken,
                    'x-csrf-token': csrf,
                    'x-twitter-auth-type': 'OAuth2Session',
                    'x-twitter-active-user': 'yes',
                    'content-type': 'application/x-www-form-urlencoded'
                },
                body: bodyParams.toString(),
                credentials: 'include'
            });

            if (res.ok) {
                const json = await res.json().catch(() => ({}));
                const idStr = json.id_str || json.id;
                if (idStr && /^\d+$/.test(String(idStr))) {
                    console.log('[Tweeker Interceptor] REST v1.1 Tweet successfully posted! ID:', idStr);
                    return { success: true, tweet_id: String(idStr) };
                }
            }
        } catch (e) {}

        return { success: false, error: 'Direct API posting failed' };
    }

    // ── Helper functions ──

    /**
     * Check if a URL is a timeline-related API endpoint.
     */
    function isTimelineEndpoint(url) {
        if (!url) return false;
        if (url.includes('viewer_context')) return false;
        return url.includes('/graphql/') || url.includes('/api/graphql');
    }

    function createNotifKey(headerText, tweetText) {
        const cleanHeader = (headerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const cleanTweet = (tweetText || '').replace(/https?:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const snippetHeader = cleanHeader.substring(0, 40);
        const snippetTweet = cleanTweet.substring(0, 40);
        return `${snippetHeader}|${snippetTweet}`;
    }

    function parseNotificationApiObjects(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 15) return;

        let msgText = '';
        if (typeof obj.message === 'string') msgText = obj.message;
        else if (obj.message && typeof obj.message.text === 'string') msgText = obj.message.text;
        else if (obj.heading && typeof obj.heading.text === 'string') msgText = obj.heading.text;
        else if (obj.text && typeof obj.text === 'string') msgText = obj.text;

        const targetRes = obj.target_tweet_results?.result || obj.tweet_results?.result || obj.target_root_tweet_results?.result || obj.tweet?.result || obj.tweet;
        if (targetRes) {
            const tweetObj = extractTweetFromResult(targetRes);
            if (tweetObj) {
                cacheTweet(tweetObj);
                if (msgText) {
                    const notifKey = createNotifKey(msgText, tweetObj.content);
                    window.__tweeker.notificationMap[notifKey] = tweetObj;
                }
            }
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                parseNotificationApiObjects(item, depth + 1);
            }
        } else {
            for (const key of Object.keys(obj)) {
                parseNotificationApiObjects(obj[key], depth + 1);
            }
        }
    }

    /**
     * Parse X.com's GraphQL API response to extract tweet data.
     * X.com's API format is deeply nested; this extracts what we need defensively.
     */
    function parseApiResponse(data) {
        const tweets = [];

        try {
            // Walk the response tree looking for tweet results
            findTweetsInObject(data, tweets, 0);
            parseNotificationApiObjects(data, 0);
        } catch (e) {
            // API format changed, fail silently
        }

        return tweets;
    }

    /**
     * Recursively search an object for tweet-like structures.
     * X.com nests tweets under various keys depending on the endpoint.
     */
    function findTweetsInObject(obj, tweets, depth) {
        if (!obj || typeof obj !== 'object' || depth > 15) return;

        // Check if this object looks like a tweet result
        if (obj.rest_id && obj.core && obj.legacy) {
            const tweet = extractTweetFromResult(obj);
            if (tweet) {
                tweets.push(tweet);
                return; // Don't recurse into this tweet's children
            }
        }

        // Also check for the "result" wrapper pattern
        if (obj.__typename === 'Tweet' && obj.rest_id) {
            const tweet = extractTweetFromResult(obj);
            if (tweet) {
                tweets.push(tweet);
                return;
            }
        }

        // Recurse into arrays and objects
        if (Array.isArray(obj)) {
            for (const item of obj) {
                findTweetsInObject(item, tweets, depth + 1);
            }
        } else {
            for (const key of Object.keys(obj)) {
                findTweetsInObject(obj[key], tweets, depth + 1);
            }
        }
    }

    /**
     * Extract a normalized tweet object from an X.com API result object.
     */
    function extractTweetFromResult(result) {
        try {
            if (!result || typeof result !== 'object') return null;

            const tweetData = (result.__typename === 'TweetWithVisibilityResults' && result.tweet) ? result.tweet : result;

            const legacy = tweetData.legacy || (tweetData.tweet && tweetData.tweet.legacy);
            if (!legacy) return null;

            const restId = tweetData.rest_id || legacy.id_str || (tweetData.tweet && tweetData.tweet.rest_id) || '';
            if (!restId) return null;

            const core = tweetData.core || (tweetData.tweet && tweetData.tweet.core);
            const userResults = core?.user_results?.result?.legacy || core?.user_results?.result?.tweet?.legacy;

            const authorHandle = userResults?.screen_name || legacy.screen_name || '';
            const authorName = userResults?.name || legacy.name || authorHandle;

            const viewsCount = tweetData.views?.count || (tweetData.tweet && tweetData.tweet.views?.count);

            const tweetObj = {
                tweet_id: String(restId),
                author_handle: authorHandle,
                author_name: authorName,
                content: legacy.full_text || legacy.text || '',
                timestamp: legacy.created_at
                    ? new Date(legacy.created_at).toISOString()
                    : new Date().toISOString(),
                likes: typeof legacy.favorite_count === 'number' ? legacy.favorite_count : 0,
                retweets: typeof legacy.retweet_count === 'number' ? legacy.retweet_count : 0,
                replies: typeof legacy.reply_count === 'number' ? legacy.reply_count : 0,
                views: viewsCount !== null && viewsCount !== undefined ? parseInt(viewsCount, 10) : null,
                captured_at: new Date().toISOString(),
            };

            cacheTweet(tweetObj);
            return tweetObj;
        } catch (e) {
            return null;
        }
    }

    function injectUserInfoButton(parentEl, siblingEl, handle, lowerHandle) {
        if (!parentEl) return;
        if (parentEl.querySelector('.tweeker-user-info-btn')) return;

        const infoBtn = document.createElement('button');
        infoBtn.className = 'tweeker-user-info-btn';
        infoBtn.title = 'Dump user info to log';

        infoBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
        `;

        infoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const stats = window.__tweeker.userCache[lowerHandle];
            let domDisplayName = null;
            try {
                const nameEl = parentEl.closest('[data-testid="tweet"]')?.querySelector('[data-testid="User-Name"] span') ||
                               parentEl.closest('[data-testid="UserCell"]')?.querySelector('[data-testid="UserCell"] span') ||
                               document.querySelector(`a[href="/${handle}"] span`);
                if (nameEl) domDisplayName = nameEl.textContent.trim();
            } catch (err) {}

            const displayName = (stats && stats.name) || domDisplayName || handle;

            let parts = [`[User Info @${handle}] Name: "${displayName}"`];
            if (stats) {
                if (stats.followers !== undefined) parts.push(`Followers: ${stats.followers.toLocaleString()}`);
                if (stats.following !== undefined) parts.push(`Following: ${stats.following.toLocaleString()}`);
                if (stats.tweet_count) parts.push(`Posts: ${stats.tweet_count.toLocaleString()}`);
                if (stats.verified !== undefined && stats.verified !== null) parts.push(`Verified: ${stats.verified ? 'Yes' : 'No'}`);
                if (stats.location) parts.push(`Location: "${stats.location}"`);
                if (stats.created_at) parts.push(`Joined: ${stats.created_at}`);
                if (stats.description) parts.push(`Bio: "${stats.description}"`);
                if (stats.updated_at) parts.push(`Cached at: ${stats.updated_at}`);
            } else {
                parts.push('No detailed stats cached yet.');
            }

            const text = parts.join(' | ');

            console.log(`[Tweeker] ${text}`);
            window.__tweeker.sendMessage('log', {
                type: 'info',
                text: text
            });
        });

        if (siblingEl) {
            parentEl.insertBefore(infoBtn, siblingEl.nextSibling);
        } else {
            parentEl.appendChild(infoBtn);
        }
    }

    function addInfoButtonToHeader(tweetEl, handle, lowerHandle) {
        try {
            const avatar = tweetEl.querySelector('[data-testid="Tweet-User-Avatar"]');
            if (!avatar) return;

            const parentCol = avatar.parentNode;
            if (!parentCol) return;

            const statsWidget = parentCol.querySelector('.tweeker-tweet-user-stats');
            injectUserInfoButton(parentCol, statsWidget || avatar, handle, lowerHandle);
        } catch (e) {
            console.debug('[Tweeker Interceptor] Error adding info button:', e);
        }
    }

    function renderStatsForUserCell(userCellEl, following, followers) {
        const avatarContainer = userCellEl.querySelector('[data-testid^="UserAvatar-Container-"]');
        if (!avatarContainer) return;

        let avatarWrapper = avatarContainer;
        if (avatarContainer.closest('a[role="link"]')) {
            avatarWrapper = avatarContainer.closest('a[role="link"]');
        }

        const handle = userCellEl.dataset.tweekerAuthor || '';
        const statsEl = injectUserStats(avatarWrapper.parentNode, avatarWrapper, handle, following, followers);

        const parentCol = avatarWrapper.parentNode;
        const infoBtn = parentCol.querySelector('.tweeker-user-info-btn');
        if (infoBtn && statsEl) {
            parentCol.insertBefore(infoBtn, statsEl.nextSibling);
        }
    }

    function applyListFiltersToCell(userCellEl) {
        try {
            const handle = userCellEl.dataset.tweekerAuthor;
            if (!handle) return;

            const stats = window.__tweeker.userCache[handle];
            if (!stats) return;

            const followers = stats.followers || 0;
            const following = stats.following || 0;
            const ratio = followers / Math.max(following, 1);
            const verified = !!stats.verified;
            const isMega = followers >= 100000;

            if (followers < listMinFollowers) {
                userCellEl.style.display = 'none';
                return;
            } else {
                userCellEl.style.display = '';
            }

            if (ratio < listMinRatio) {
                userCellEl.style.opacity = '0.35';
                userCellEl.style.transition = 'opacity 0.2s';
            } else {
                userCellEl.style.opacity = '1.0';
            }

            userCellEl.style.border = 'none';
            userCellEl.style.borderRadius = '0px';
            userCellEl.style.margin = '0px';
            userCellEl.style.boxShadow = 'none';

            if (isMega && listHighlightMega) {
                userCellEl.style.border = `2.5px solid ${listMegaColor}`;
                userCellEl.style.borderRadius = '12px';
                userCellEl.style.margin = '6px 0';
                userCellEl.style.boxShadow = `0 4px 12px ${hexToRgba(listMegaColor, 0.2)}`;
            } else if (verified && listHighlightVerified) {
                userCellEl.style.border = `2px solid ${listVerifiedColor}`;
                userCellEl.style.borderRadius = '12px';
                userCellEl.style.margin = '6px 0';
                userCellEl.style.boxShadow = `0 4px 12px ${hexToRgba(listVerifiedColor, 0.2)}`;
            }
        } catch (e) {
            console.debug('[Tweeker Interceptor] Error applying filters to user cell:', e);
        }
    }

    function applyListFiltersToAllCells() {
        try {
            const userCells = document.querySelectorAll('[data-testid="UserCell"]');
            for (const cell of userCells) {
                applyListFiltersToCell(cell);
            }
        } catch (e) {}
    }

    function addInfoButtonToUserCell(userCellEl, handle, lowerHandle) {
        try {
            const avatarContainer = userCellEl.querySelector('[data-testid^="UserAvatar-Container-"]');
            if (!avatarContainer) return;

            let avatarWrapper = avatarContainer;
            if (avatarContainer.closest('a[role="link"]')) {
                avatarWrapper = avatarContainer.closest('a[role="link"]');
            }

            const parentCol = avatarWrapper.parentNode;
            if (!parentCol) return;

            const statsWidget = parentCol.querySelector('.tweeker-tweet-user-stats');
            injectUserInfoButton(parentCol, statsWidget || avatarWrapper, handle, lowerHandle);
        } catch (e) {
            console.debug('[Tweeker Interceptor] Error adding info button to UserCell:', e);
        }
    }

    function parseDOMUserCell(userCellEl) {
        try {
            if (!userCellEl || userCellEl.dataset.tweekerParsed) return;
            userCellEl.dataset.tweekerParsed = 'true';

            const avatarContainer = userCellEl.querySelector('[data-testid^="UserAvatar-Container-"]');
            if (!avatarContainer) return;

            const testId = avatarContainer.getAttribute('data-testid') || '';
            const handle = testId.replace('UserAvatar-Container-', '');
            if (!handle) return;

            const lowerHandle = handle.toLowerCase();
            userCellEl.dataset.tweekerAuthor = lowerHandle;

            // Unconditionally add the info button
            addInfoButtonToUserCell(userCellEl, handle, lowerHandle);

            // Render stats if cached
            if (window.__tweeker.userCache[lowerHandle]) {
                const c = window.__tweeker.userCache[lowerHandle];
                renderStatsForUserCell(userCellEl, c.following, c.followers);
                
                // Highlight avatar container if relevant
                const avatarImg = avatarContainer.querySelector('img');
                const avatarImgContainer = avatarImg ? avatarImg.closest('[data-testid^="UserAvatar-Container-"]') || avatarImg.parentElement : null;
                if (avatarImgContainer) {
                    processUserAvatar(avatarImgContainer, lowerHandle);
                }

                applyListFiltersToCell(userCellEl);
            } else {
                requestUserCounts(lowerHandle);
            }
        } catch (e) {
            console.debug('[Tweeker Interceptor] Error parsing UserCell:', e);
        }
    }

    function isAllNotificationsPage() {
        const path = window.location.pathname.toLowerCase();
        const isNotif = path.includes('/notifications');
        const isMentions = path.includes('/mentions');
        const isVerified = path.includes('/verified');
        return isNotif && !isMentions && !isVerified;
    }

    function findTweetIdByText(text) {
        if (!text) return null;
        const norm = normalizeTweetText(text);
        if (!norm || norm.length < 8) return null;

        if (window.__tweeker.tweetContentCache[norm]) {
            return window.__tweeker.tweetContentCache[norm];
        }

        for (const len of [40, 30, 25, 20, 15, 12, 10, 8]) {
            if (norm.length >= len) {
                const prefix = norm.substring(0, len);
                if (window.__tweeker.tweetContentCache[prefix]) {
                    return window.__tweeker.tweetContentCache[prefix];
                }
            }
        }

        for (const [id, tweet] of Object.entries(window.__tweeker.tweetCache)) {
            if (tweet && tweet.content) {
                const tweetNorm = normalizeTweetText(tweet.content);
                if (tweetNorm) {
                    if (tweetNorm.startsWith(norm) || norm.startsWith(tweetNorm) || (norm.length >= 10 && tweetNorm.includes(norm)) || (tweetNorm.length >= 10 && norm.includes(tweetNorm))) {
                        return id;
                    }
                }
            }
        }

        return null;
    }

    function parseNotificationMessageEngagement(msgText) {
        if (!msgText) return null;
        const cleanText = msgText.replace(/\s+/g, ' ').trim();
        let likes = null;
        let retweets = null;

        const likeCountMatch = cleanText.match(/(?:and\s+)?([\d,]+)\s+others?\s+liked\b/i);
        if (likeCountMatch) {
            const num = parseInt(likeCountMatch[1].replace(/,/g, ''), 10);
            likes = isNaN(num) ? 1 : num + 1;
        } else if (/\bliked\b/i.test(cleanText)) {
            likes = 1;
        }

        const retweetCountMatch = cleanText.match(/(?:and\s+)?([\d,]+)\s+others?\s+(?:reposted|retweeted)\b/i);
        if (retweetCountMatch) {
            const num = parseInt(retweetCountMatch[1].replace(/,/g, ''), 10);
            retweets = isNaN(num) ? 1 : num + 1;
        } else if (/\b(?:reposted|retweeted)\b/i.test(cleanText)) {
            retweets = 1;
        }

        if (likes !== null || retweets !== null) {
            return { likes, retweets, replies: null, views: null };
        }
        return null;
    }

    function injectNotificationTweetStats(articleEl, tweetStats, keyId) {
        if (!articleEl) return null;

        let statsEl = articleEl.querySelector('.tweeker-notification-tweet-stats');
        if (!statsEl) {
            statsEl = document.createElement('div');
            statsEl.className = 'tweeker-notification-tweet-stats';

            const textEl = articleEl.querySelector('#notification-tweet-text') ||
                           articleEl.querySelector('[data-testid="tweetText"]') ||
                           articleEl.querySelector('#notification-message-text');

            if (textEl) {
                const parent = textEl.parentNode;
                if (textEl.nextSibling) {
                    parent.insertBefore(statsEl, textEl.nextSibling);
                } else {
                    parent.appendChild(statsEl);
                }
            } else {
                articleEl.appendChild(statsEl);
            }
        }

        if (keyId) statsEl.dataset.tweetId = keyId;

        const replies = tweetStats && tweetStats.replies !== undefined && tweetStats.replies !== null ? formatCount(tweetStats.replies) : '?';
        const retweets = tweetStats && tweetStats.retweets !== undefined && tweetStats.retweets !== null ? formatCount(tweetStats.retweets) : '?';
        const likes = tweetStats && tweetStats.likes !== undefined && tweetStats.likes !== null ? formatCount(tweetStats.likes) : '?';
        const views = tweetStats && tweetStats.views !== undefined && tweetStats.views !== null ? formatCount(tweetStats.views) : '—';

        statsEl.innerHTML = `
            <div class="tweeker-notif-stat-item stat-replies" title="Replies">💬 <span>${replies}</span></div>
            <div class="tweeker-notif-stat-item stat-retweets" title="Retweets">🔁 <span>${retweets}</span></div>
            <div class="tweeker-notif-stat-item stat-likes" title="Likes">❤️ <span>${likes}</span></div>
            <div class="tweeker-notif-stat-item stat-views" title="Views">👁 <span>${views}</span></div>
        `;
        return statsEl;
    }

    function parseDOMNotification(notifEl) {
        try {
            if (!notifEl) return;
            if (!isAllNotificationsPage()) return;

            const msgTextEl = notifEl.querySelector('#notification-message-text') ||
                              notifEl.querySelector('[data-testid="notification-message-text"]') ||
                              notifEl.querySelector('div[dir="auto"]:not([data-testid="tweetText"])');
            const msgText = msgTextEl ? msgTextEl.textContent : '';

            const tweetTextEl = notifEl.querySelector('#notification-tweet-text') || notifEl.querySelector('[data-testid="tweetText"]');
            const text = tweetTextEl ? tweetTextEl.textContent : '';

            let foundTweetId = null;
            let stats = null;
            let matchSource = null;

            if (msgText || text) {
                const notifKey = createNotifKey(msgText, text);
                if (window.__tweeker.notificationMap[notifKey]) {
                    stats = window.__tweeker.notificationMap[notifKey];
                    foundTweetId = stats.tweet_id;
                    matchSource = 'notificationMap';
                }
            }

            if (!stats) {
                const statusLinks = notifEl.querySelectorAll('a[href*="/status/"]');
                if (statusLinks && statusLinks.length > 0) {
                    for (const sLink of statusLinks) {
                        const href = sLink.getAttribute('href') || '';
                        const match = href.match(/\/status\/(\d+)/);
                        if (match && match[1]) {
                            foundTweetId = match[1];
                            if (window.__tweeker.tweetCache[foundTweetId]) {
                                stats = window.__tweeker.tweetCache[foundTweetId];
                                matchSource = 'statusLinkCache';
                            } else {
                                matchSource = 'statusLinkUncached';
                            }
                            break;
                        }
                    }
                }
            }

            if (!stats && text) {
                const matchedId = findTweetIdByText(text);
                if (matchedId && window.__tweeker.tweetCache[matchedId]) {
                    foundTweetId = matchedId;
                    stats = window.__tweeker.tweetCache[matchedId];
                    matchSource = 'textSnippetMatch';
                } else {
                    const norm = normalizeTweetText(text);
                    const key = norm.length > 40 ? norm.substring(0, 40) : norm;
                    if (norm && norm.length >= 10) {
                        requestTweetContentSnippet(key);
                        matchSource = 'textSnippetRequested';
                    }
                }
            }

            const msgStats = msgText ? parseNotificationMessageEngagement(msgText) : null;

            let finalStats = stats ? { ...stats } : null;

            if (!finalStats && msgStats) {
                finalStats = { ...msgStats };
                if (!matchSource) matchSource = 'headerMsgEngagement';
            } else if (finalStats && msgStats) {
                if ((!finalStats.likes || finalStats.likes === 0) && msgStats.likes) {
                    finalStats.likes = msgStats.likes;
                }
                if ((!finalStats.retweets || finalStats.retweets === 0) && msgStats.retweets) {
                    finalStats.retweets = msgStats.retweets;
                }
            }

            if (!finalStats && (text || msgText)) {
                finalStats = { replies: null, retweets: null, likes: null, views: null };
                if (!matchSource) matchSource = 'fallbackNulls';
            }

            if (finalStats) {
                if (foundTweetId && matchSource !== 'fallbackNulls') {
                    notifEl.dataset.tweekerNotifStatsParsed = 'true';
                }
                injectNotificationTweetStats(notifEl, finalStats, foundTweetId);
                sendDebugLog(`[NotifStats] Card parsed (Src: ${matchSource || 'unknown'}, TweetID: ${foundTweetId || 'none'}) -> Likes: ${finalStats.likes}, Retweets: ${finalStats.retweets}, Replies: ${finalStats.replies}, Views: ${finalStats.views}`);
            }
        } catch (e) {
            sendDebugLog(`[NotifStats] Error parsing notification card: ${e.message}`);
        }
    }

    function updateNotificationTweetStats() {
        try {
            const isAllNotif = isAllNotificationsPage();
            const path = window.location.pathname;

            if (!isAllNotif) {
                const existingStats = document.querySelectorAll('.tweeker-notification-tweet-stats');
                if (existingStats.length > 0) {
                    sendDebugLog(`[NotifStats] Navigated away from All tab (path: ${path}). Cleared ${existingStats.length} notification stats badges.`);
                    for (const el of existingStats) el.remove();
                }
                return;
            }

            const notifElements = document.querySelectorAll('article[data-testid="notification"], [data-testid="notification"], #notification-message-text, #notification-tweet-text');
            const processedContainers = new Set();

            sendDebugLog(`[NotifStats] Scanning notifications timeline at ${path}... Found ${notifElements.length} notification element(s).`);

            for (const el of notifElements) {
                const container = el.closest('[data-testid="notification"]') || el.closest('.r-136ojw6') || el.closest('article') || el;
                if (container && !processedContainers.has(container)) {
                    processedContainers.add(container);
                    parseDOMNotification(container);
                }
            }
        } catch (e) {
            sendDebugLog(`[NotifStats] Error in updateNotificationTweetStats: ${e.message}`);
        }
    }

    /**
     * Parse a tweet directly from the DOM when the API interceptor misses it.
     * This is a fallback and less reliable than API interception.
     */
    function parseDOMTweet(articleEl) {
        try {
            if (!articleEl || articleEl.dataset.tweekerParsed) return;
            articleEl.dataset.tweekerParsed = 'true';

            // Extract basic info from DOM structure, prioritizing specific user containers
            const userLink = articleEl.querySelector('[data-testid="User-Name"] a[role="link"]') ||
                             articleEl.querySelector('[data-testid="Tweet-User-Avatar"] a[role="link"]') ||
                             articleEl.querySelector('a[role="link"]');
            if (userLink) {
                const href = userLink.getAttribute('href') || '';
                let handle = '';
                try {
                    const urlPath = href.startsWith('http') ? new URL(href).pathname : href;
                    const parts = urlPath.split('/').filter(Boolean);
                    if (parts.length > 0) {
                        handle = parts[0];
                    }
                } catch (e) {}

                if (handle && 
                    !['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose', 'trends', 'tos', 'privacy', 'hashtag', 'intent', 'share', 'status'].includes(handle.toLowerCase())) {
                    const lowerHandle = handle.toLowerCase();
                    articleEl.dataset.tweekerAuthor = lowerHandle;

                    addInfoButtonToHeader(articleEl, handle, lowerHandle);

                    if (window.__tweeker.userCache[lowerHandle]) {
                        const c = window.__tweeker.userCache[lowerHandle];
                        renderStatsBelowAvatar(articleEl, c.following, c.followers);
                        // Highlight timeline avatar if relevant
                        const tweetAvatarLink = articleEl.querySelector('[data-testid="Tweet-User-Avatar"]');
                        if (tweetAvatarLink) {
                            const tweetImg = tweetAvatarLink.querySelector('img');
                            const tweetImgContainer = tweetImg ? tweetImg.closest('[data-testid^="UserAvatar-Container-"]') || tweetImg.parentElement : null;
                            if (tweetImgContainer) {
                                processUserAvatar(tweetImgContainer, lowerHandle);
                            }
                        }
                    } else {
                        requestUserCounts(lowerHandle);
                    }
                }
            }

            const textEl = articleEl.querySelector('[data-testid="tweetText"]');
            if (!userLink || !textEl) return;

            const handle = userLink.getAttribute('href')?.replace('/', '') || '';
            const content = textEl.textContent || '';

            // Extract actual numeric tweet ID from status permalink link (e.g. /username/status/18123456789)
            let tweetId = '';
            const statusLinks = articleEl.querySelectorAll('a[href*="/status/"]');
            for (const sLink of statusLinks) {
                const href = sLink.getAttribute('href') || '';
                const match = href.match(/\/status\/(\d+)/);
                if (match && match[1]) {
                    tweetId = match[1];
                    break;
                }
            }

            if (!tweetId) {
                tweetId = 'dom-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
            }

            if (handle && content) {
                window.__tweeker.sendTweets([{
                    tweet_id: tweetId,
                    author_handle: handle,
                    author_name: handle,
                    content: content,
                    timestamp: new Date().toISOString(),
                    likes: 0,
                    retweets: 0,
                    replies: 0,
                    views: null,
                    captured_at: new Date().toISOString(),
                }]);
            }
            evaluateTweetHighlight(articleEl);
        } catch (e) {
            // DOM structure changed, fail silently
        }
    }

    function evaluateTweetHighlight(articleEl) {
        try {
            if (!articleEl) return;
            const handle = articleEl.dataset.tweekerAuthor;
            if (!handle) return;

            const lowerHandle = handle.toLowerCase();
            const stats = window.__tweeker.userCache[lowerHandle];
            if (!stats) {
                articleEl.classList.remove('tweeker-highlighted-tweet');
                const badge = articleEl.querySelector('.tweeker-recent-relevant-badge');
                if (badge) badge.remove();
                return;
            }

            // Check if user is relevant: verified OR follower count exceeds threshold
            const isVerified = !!stats.verified;
            const hasHighFollowers = typeof stats.followers === 'number' && stats.followers >= relevantFollowersLimit;
            const isRelevant = isVerified || hasHighFollowers;

            if (!isRelevant) {
                articleEl.classList.remove('tweeker-highlighted-tweet');
                const badge = articleEl.querySelector('.tweeker-recent-relevant-badge');
                if (badge) badge.remove();
                return;
            }

            // Check if tweet is recent (within configured duration)
            const timeEl = articleEl.querySelector('time');
            const datetimeStr = timeEl ? timeEl.getAttribute('datetime') : null;
            if (!datetimeStr) return;

            const tweetTime = new Date(datetimeStr).getTime();
            if (isNaN(tweetTime)) return;

            const ageMs = Date.now() - tweetTime;
            const thresholdMs = recentTweetDurationMinutes * 60 * 1000;

            if (ageMs >= -60000 && ageMs <= thresholdMs) {
                // Apply visual highlight wrapper
                if (!articleEl.classList.contains('tweeker-highlighted-tweet')) {
                    articleEl.classList.add('tweeker-highlighted-tweet');
                }
                
                // Inject outstanding lightning badge next to display name/handle
                const userNameDiv = articleEl.querySelector('[data-testid="User-Name"]');
                if (userNameDiv && !userNameDiv.querySelector('.tweeker-recent-relevant-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'tweeker-recent-relevant-badge';
                    badge.innerHTML = '⚡';
                    badge.style.marginLeft = '4px';
                    badge.title = `Recent tweet from @${handle} (${recentTweetDurationMinutes}m threshold)`;
                    userNameDiv.appendChild(badge);
                }
            } else {
                // Reached duration limit, remove highlight & badge
                articleEl.classList.remove('tweeker-highlighted-tweet');
                const badge = articleEl.querySelector('.tweeker-recent-relevant-badge');
                if (badge) badge.remove();
            }
        } catch (e) {
            console.debug('[Tweeker Interceptor] Highlight evaluation error:', e);
        }
    }

    // Start the observer after a delay to let X.com render
    setTimeout(startDOMObserver, 2000);

    // Periodic scanner to scan initially present tweets and ensure no tweets are missed
    setInterval(function() {
        try {
            const timeline = document.querySelector('[data-testid="primaryColumn"]') ||
                             document.querySelector('main[role="main"]') ||
                             document.querySelector('main');
            if (timeline) {
                const articles = timeline.querySelectorAll('[data-testid="tweet"]:not([data-tweeker-parsed="true"])');
                for (const article of articles) {
                    parseDOMTweet(article);
                }
                const allArticles = timeline.querySelectorAll('[data-testid="tweet"]');
                for (const article of allArticles) {
                    evaluateTweetHighlight(article);
                }
                const userCells = timeline.querySelectorAll('[data-testid="UserCell"]:not([data-tweeker-parsed="true"])');
                for (const cell of userCells) {
                    parseDOMUserCell(cell);
                }
                const notifications = timeline.querySelectorAll('article[data-testid="notification"]');
                for (const notif of notifications) {
                    parseDOMNotification(notif);
                }
            }
            highlightAllAvatars();
        } catch (e) {
            console.debug('[Tweeker Interceptor] Periodic scanner error:', e);
        }
    }, 2000);

    console.log('[Tweeker Interceptor] Network interceptors and DOM observer initialized');
})();
