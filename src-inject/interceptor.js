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
    // Watch for new tweet elements being added to the timeline.

    let observerStarted = false;

    function startDOMObserver() {
        if (observerStarted) return;

        // Wait for the timeline container to appear
        const checkInterval = setInterval(function() {
            // X.com uses a <main> element or [data-testid="primaryColumn"] for the timeline
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
                                // Look for tweet article elements
                                const articles = node.querySelectorAll
                                    ? node.querySelectorAll('[data-testid="tweet"]')
                                    : [];

                                if (node.matches && node.matches('[data-testid="tweet"]')) {
                                    parseDOMTweet(node);
                                }

                                for (const article of articles) {
                                    parseDOMTweet(article);
                                }
                            }
                        }
                    }
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
                    author_name: handle, // DOM doesn't always have display name easily
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
