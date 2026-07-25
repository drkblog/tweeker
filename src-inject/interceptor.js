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

    // Token & QueryId storage for direct X.com API operations
    let capturedAuthToken = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAn%2Bx1%2Bq%2B4t7D43W5a%2F4%2B15DII5w%3D930W2AuSilKhBmAhx526gWgjTZRBBBmoP9GczOfLhWY';
    let capturedCsrfToken = '';
    let capturedCreateTweetQueryId = '5V8HGy9ykoGDjDxTy8HUAQ';

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
        } catch (e) {}

        const response = await originalFetch.apply(this, args);
        
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            
            // Intercept timeline and tweet-related API endpoints
            if (isTimelineEndpoint(url)) {
                // Clone the response so we don't consume it
                const clone = response.clone();
                
                clone.json().then(function(data) {
                    try {
                        const tweets = parseApiResponse(data);
                        if (tweets.length > 0) {
                            window.__tweeker.sendTweets(tweets);
                        }
                    } catch (e) {
                        // Silently ignore parse errors — X.com API format may change
                        console.debug('[Tweeker Interceptor] Parse error:', e.message);
                    }
                }).catch(function() {
                    // Response wasn't JSON, ignore
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
            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    const tweets = parseApiResponse(data);
                    if (tweets.length > 0) {
                        window.__tweeker.sendTweets(tweets);
                    }
                } catch (e) {
                    // Silently ignore
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

            if (node.matches && node.matches('[data-testid="tweet"]')) {
                parseDOMTweet(node);
            } else if (node.querySelectorAll) {
                const articles = node.querySelectorAll('[data-testid="tweet"]');
                for (const article of articles) {
                    parseDOMTweet(article);
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

    // Start the observer after a delay to let X.com render
    setTimeout(startDOMObserver, 2000);

    // ── Auto Read feature ──
    // Automatically clicks X.com "New Tweets" pill when visible and processes all timeline messages.

    let autoReadEnabled = false;
    let autoReadIntervalTimer = null;

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
                    console.log('[Tweeker Interceptor] Auto read: clicking new tweets pill');
                    pillBtn.click();
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

    // Listen for Auto Read toggle & Direct API Tweet events from overlay app.js
    window.addEventListener('message', async function(event) {
        if (!event.data || !event.data.__tweeker) return;

        if (event.data.type === 'set_auto_read') {
            updateAutoReadState(event.data.enabled);
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

    /**
     * Post a tweet directly using X.com's native CreateTweet GraphQL endpoint.
     */
    async function postTweetViaApi(content) {
        if (!content) return { success: false, error: 'Empty content' };

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
        return url.includes('/api/graphql') &&
            (url.includes('HomeTimeline') ||
             url.includes('HomeLatestTimeline') ||
             url.includes('TweetDetail') ||
             url.includes('UserTweets') ||
             url.includes('SearchTimeline') ||
             url.includes('ListLatestTweetsTimeline'));
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
            const legacy = result.legacy;
            const core = result.core;
            if (!legacy || !core) return null;

            const userResults = core.user_results?.result?.legacy;
            if (!userResults) return null;

            return {
                tweet_id: result.rest_id || legacy.id_str || '',
                author_handle: userResults.screen_name || '',
                author_name: userResults.name || '',
                content: legacy.full_text || '',
                timestamp: legacy.created_at
                    ? new Date(legacy.created_at).toISOString()
                    : new Date().toISOString(),
                likes: legacy.favorite_count || 0,
                retweets: legacy.retweet_count || 0,
                replies: legacy.reply_count || 0,
                views: result.views?.count
                    ? parseInt(result.views.count, 10)
                    : null,
                captured_at: new Date().toISOString(),
            };
        } catch (e) {
            return null;
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

            // Extract basic info from DOM structure
            const userLink = articleEl.querySelector('a[role="link"][href^="/"]');
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
        } catch (e) {
            // DOM structure changed, fail silently
        }
    }

    console.log('[Tweeker Interceptor] Network interceptors and DOM observer initialized');
})();
