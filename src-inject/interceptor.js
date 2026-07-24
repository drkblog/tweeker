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

    // ── Fetch interceptor ──
    // Monkey-patch window.fetch to intercept timeline API responses.

    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
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
            // Ignore mutations originating inside Tweeker overlay container
            if (node.closest && node.closest('#tweeker-overlay-container')) continue;

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

    function triggerAutoReadCheck() {
        if (!autoReadEnabled) return;

        try {
            // 1. Search for X.com new tweets pill button
            const pillLabel = document.querySelector('[data-testid="pillLabel"]');
            let pillBtn = null;

            if (pillLabel) {
                pillBtn = pillLabel.closest ? (pillLabel.closest('[role="button"]') || pillLabel) : pillLabel;
            } else {
                // Fallback query for floating new tweets notification buttons
                const candidateButtons = document.querySelectorAll('div[role="button"][tabindex="0"]');
                for (const btn of candidateButtons) {
                    const text = (btn.textContent || '').toLowerCase();
                    if (text.includes('tweet') || text.includes('post') || text.includes('show')) {
                        pillBtn = btn;
                        break;
                    }
                }
            }

            if (pillBtn && typeof pillBtn.click === 'function') {
                console.log('[Tweeker Interceptor] Auto read: clicking new tweets pill');
                pillBtn.click();
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

    // Listen for Auto Read toggle events from overlay app.js
    window.addEventListener('message', function(event) {
        if (event.data && event.data.__tweeker && event.data.type === 'set_auto_read') {
            updateAutoReadState(event.data.enabled);
        }
    });

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

            if (handle && content) {
                window.__tweeker.sendTweets([{
                    tweet_id: 'dom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
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
