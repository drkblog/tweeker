// ─────────────────────────────────────────────────────────────────────────────
// Tweeker — Control Panel Application Logic
// ─────────────────────────────────────────────────────────────────────────────
// Organized into: State, DOM Elements, Tab Management, Data Rendering,
// Form Handlers, Event Listeners, and Initialization.
// ─────────────────────────────────────────────────────────────────────────────

if (window.__tweeker_app_initialized) return;
window.__tweeker_app_initialized = true;

function invoke(cmd, args) {
    const payload = args || {};
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        return window.__TAURI__.core.invoke(cmd, payload);
    }
    if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
        return window.__TAURI__.invoke(cmd, payload);
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        return window.__TAURI_INTERNALS__.invoke(cmd, payload);
    }
    console.debug('[Tweeker IPC Fallback]', cmd, payload);
    return Promise.resolve(null);
}

function listen(event, cb) {
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
        return window.__TAURI__.event.listen(event, cb);
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.listen === 'function') {
        return window.__TAURI_INTERNALS__.listen(event, { type: 'App' }, cb);
    }
    return Promise.resolve(() => {});
}

function emit(event, payload) {
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.emit === 'function') {
        return window.__TAURI__.event.emit(event, payload);
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.emit === 'function') {
        return window.__TAURI_INTERNALS__.emit(event, payload);
    }
    return Promise.resolve();
}

// ── State ──

const state = {
    panelOpen: false,
    activeTab: 'stats',
    autoRead: false,
    autoReadOnStart: false,
    maxLogLines: 2000,
    logs: [],
    panelSize: { width: null, height: null },
    stats: null,
    alarms: [],
    scheduledTweets: [],
    connectionStatus: {
        x_webview_loaded: false,
        interceptor_active: false,
        last_heartbeat: null,
    },
    statsRefreshInterval: null,
    debugTwitter: false,
    maxDebugLines: 2000,
    debugLogs: [],
    listMinFollowers: 0,
    listMinRatio: 0.0,
    listHighlightVerified: false,
    listVerifiedColor: '#1d9bf0',
    listHighlightMega: false,
    listMegaColor: '#a855f7',
};

// ── DOM Elements ──

const dom = {
    overlayToggle: document.getElementById('overlay-toggle'),
    overlayPanel: document.getElementById('overlay-panel'),
    panelResizeHandleLeft: document.getElementById('panel-resize-handle-left'),
    panelResizeHandleBottom: document.getElementById('panel-resize-handle-bottom'),
    panelResizeHandleCorner: document.getElementById('panel-resize-handle-corner'),
    panelClose: document.getElementById('panel-close'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    copyUrlToast: document.getElementById('copy-url-toast'),
    appVersion: document.getElementById('app-version'),

    // Browser navigation bar
    navBackBtn: document.getElementById('nav-back-btn'),
    navForwardBtn: document.getElementById('nav-forward-btn'),
    navReloadBtn: document.getElementById('nav-reload-btn'),
    navUrlInput: document.getElementById('nav-url-input'),

    // Status & Auto read
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    autoReadToggle: document.getElementById('auto-read-toggle'),
    autoReadStartupToggle: document.getElementById('auto-read-startup-toggle'),

    // Tabs
    tabs: document.querySelectorAll('.tab'),
    tabContents: {
        stats: document.getElementById('content-stats'),
        alarms: document.getElementById('content-alarms'),
        scheduler: document.getElementById('content-scheduler'),
        logs: document.getElementById('content-logs'),
        settings: document.getElementById('content-settings'),
        debug: document.getElementById('content-debug'),
    },

    // Stats
    statTweets: document.querySelector('#stat-tweets .stat-value'),
    statAuthors: document.querySelector('#stat-authors .stat-value'),
    statLikes: document.querySelector('#stat-likes .stat-value'),
    statRetweets: document.querySelector('#stat-retweets .stat-value'),
    statCachedUsers: document.querySelector('#stat-cached-users .stat-value'),
    statMyFollowers: document.querySelector('#stat-my-followers .stat-value'),
    statMyFollowersCard: document.getElementById('stat-my-followers'),
    topAuthorsList: document.getElementById('top-authors-list'),

    // Alarms
    alarmForm: document.getElementById('alarm-form'),
    alarmName: document.getElementById('alarm-name'),
    alarmType: document.getElementById('alarm-type'),
    alarmPattern: document.getElementById('alarm-pattern'),
    alarmNotifyToggle: document.getElementById('alarm-notify-toggle'),
    alarmsList: document.getElementById('alarms-list'),

    // Scheduler
    scheduleForm: document.getElementById('schedule-form'),
    scheduleContent: document.getElementById('schedule-content'),
    scheduleDatetime: document.getElementById('schedule-datetime'),
    charCount: document.getElementById('char-count'),
    scheduledList: document.getElementById('scheduled-list'),

    // Logs
    logCountText: document.getElementById('log-count-text'),
    clearLogsBtn: document.getElementById('clear-logs-btn'),
    logOutputContainer: document.getElementById('log-output-container'),

    // Debug
    debugTab: document.getElementById('tab-debug'),
    debugCountText: document.getElementById('debug-count-text'),
    clearDebugBtn: document.getElementById('clear-debug-btn'),
    debugOutputContainer: document.getElementById('debug-output-container'),
    debugTwitterToggle: document.getElementById('debug-twitter-toggle'),
    maxDebugLinesInput: document.getElementById('max-debug-lines-input'),

    // Settings
    maxLogLinesInput: document.getElementById('max-log-lines-input'),
    userCacheLimitInput: document.getElementById('user-cache-limit-input'),
    relevantFollowersLimitInput: document.getElementById('relevant-followers-limit-input'),
    relevantHighlightColorInput: document.getElementById('relevant-highlight-color-input'),
    listMinFollowersInput: document.getElementById('list-min-followers-input'),
    listMinRatioInput: document.getElementById('list-min-ratio-input'),
    listHighlightVerifiedToggle: document.getElementById('list-highlight-verified-toggle'),
    listVerifiedColorInput: document.getElementById('list-verified-color-input'),
    listHighlightMegaToggle: document.getElementById('list-highlight-mega-toggle'),
    listMegaColorInput: document.getElementById('list-mega-color-input'),
    interceptorStatus: document.getElementById('interceptor-status'),
    sessionStart: document.getElementById('session-start'),
    settingsVersion: document.getElementById('settings-version'),
    settingsDbPath: document.getElementById('settings-db-path'),
    dumpDbStatsBtn: document.getElementById('dump-db-stats-btn'),
};

// ── Panel Toggle ──

function togglePanel(forceState) {
    const newState = forceState !== undefined ? forceState : !state.panelOpen;
    state.panelOpen = newState;

    // Persist open/closed state across app restarts
    try { localStorage.setItem('tweeker_panel_open', newState ? 'true' : 'false'); } catch (e) {}

    if (newState) {
        dom.overlayPanel.classList.add('open');
        dom.overlayPanel.setAttribute('aria-hidden', 'false');
        dom.overlayToggle.classList.add('panel-open');
        startStatsRefresh();
    } else {
        dom.overlayPanel.classList.remove('open');
        dom.overlayPanel.setAttribute('aria-hidden', 'true');
        dom.overlayToggle.classList.remove('panel-open');
        stopStatsRefresh();
    }
}

// ── Tab Management ──

function switchTab(tabName) {
    state.activeTab = tabName;

    // Update tab buttons
    dom.tabs.forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
    });

    // Show/hide tab content
    Object.entries(dom.tabContents).forEach(([name, el]) => {
        if (name === tabName) {
            el.hidden = false;
            el.classList.add('active');
        } else {
            el.hidden = true;
            el.classList.remove('active');
        }
    });

    // Refresh data for the active tab
    if (tabName === 'stats') refreshStats();
    if (tabName === 'alarms') refreshAlarms();
    if (tabName === 'scheduler') refreshScheduledTweets();
    if (tabName === 'logs') refreshLogsView();
    if (tabName === 'settings') refreshSettings();
    if (tabName === 'debug') refreshDebugView();
}

// ── Data Rendering ──

async function refreshStats() {
    try {
        const stats = await invoke('get_timeline_stats');
        const dbStats = await fetchDbStats();

        if (!state.stats) state.stats = {};

        if (stats && typeof stats === 'object') {
            state.stats.total_tweets_seen = Math.max(state.stats.total_tweets_seen || 0, stats.total_tweets_seen || 0);
            state.stats.unique_authors = Math.max(state.stats.unique_authors || 0, stats.unique_authors || 0);
            state.stats.total_likes = Math.max(state.stats.total_likes || 0, stats.total_likes || 0);
            state.stats.total_retweets = Math.max(state.stats.total_retweets || 0, stats.total_retweets || 0);
            state.stats.total_replies = Math.max(state.stats.total_replies || 0, stats.total_replies || 0);
            if (stats.top_authors && stats.top_authors.length > 0) {
                state.stats.top_authors = stats.top_authors;
            }
        }

        if (dbStats && typeof dbStats.cached_users_count === 'number') {
            state.stats.cached_users_count = dbStats.cached_users_count;
        }

        renderStats(state.stats || {});
    } catch (e) {
        console.error('[Tweeker] Failed to refresh stats:', e);
        renderStats(state.stats || {});
    }
}

function getMyUserFollowersInfo() {
    let handle = null;

    // 1. Try finding profile link in X.com navbar/sidebar
    const profileLink = document.querySelector('a[aria-label*="Profile" i], a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        const parts = href.split('/').filter(Boolean);
        if (parts.length > 0 && !['home', 'explore', 'notifications', 'messages', 'settings', 'i', 'compose', 'search', 'tos', 'privacy'].includes(parts[0].toLowerCase())) {
            handle = parts[0].toLowerCase();
        }
    }

    // 2. Try account switcher button
    if (!handle) {
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (switcher) {
            const text = switcher.textContent || '';
            const match = text.match(/@([A-Za-z0-9_]+)/);
            if (match && match[1]) {
                handle = match[1].toLowerCase();
            }
        }
    }

    if (!handle && window.__tweeker_my_handle) {
        handle = window.__tweeker_my_handle;
    }

    if (handle) {
        window.__tweeker_my_handle = handle;
        const userObj = (window._tweeker_user_cache && window._tweeker_user_cache[handle]) ||
                        (window.__tweeker && window.__tweeker.userCache && window.__tweeker.userCache[handle]);
        if (userObj && typeof userObj.followers === 'number') {
            return userObj.followers;
        }
    }
    return null;
}

function renderStats(stats) {
    if (dom.statTweets) dom.statTweets.textContent = formatNumber(stats.total_tweets_seen || 0);
    if (dom.statAuthors) dom.statAuthors.textContent = formatNumber(stats.unique_authors || 0);
    if (dom.statLikes) dom.statLikes.textContent = formatNumber(stats.total_likes || 0);
    if (dom.statRetweets) dom.statRetweets.textContent = formatNumber(stats.total_retweets || 0);

    const cachedUsers = (typeof stats.cached_users_count === 'number' && stats.cached_users_count > 0)
        ? stats.cached_users_count
        : (window._tweeker_user_cache ? Object.keys(window._tweeker_user_cache).length : 0);
    if (dom.statCachedUsers) dom.statCachedUsers.textContent = formatNumber(cachedUsers || 0);

    const myFollowers = getMyUserFollowersInfo();
    if (dom.statMyFollowers) {
        dom.statMyFollowers.textContent = myFollowers !== null ? formatNumber(myFollowers) : '—';
        if (window.__tweeker_my_handle && myFollowers === null) {
            window.postMessage({
                __tweeker: true,
                type: 'get_user_counts',
                handle: window.__tweeker_my_handle
            }, '*');
        }
    }

    // Top authors (max 5) based on cached users
    let topAuthors = [];
    if (window._tweeker_user_cache && Object.keys(window._tweeker_user_cache).length > 0) {
        topAuthors = Object.entries(window._tweeker_user_cache)
            .map(([handle, user]) => {
                const cleanHandle = handle.trim().replace(/^@/, '').toLowerCase();
                const followers = (user && typeof user.followers === 'number') ? user.followers : 0;
                const name = (user && user.name && user.name.trim()) ? user.name : cleanHandle;
                return {
                    handle: cleanHandle,
                    name: name,
                    count: followers
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    } else if (stats.top_authors && stats.top_authors.length > 0) {
        topAuthors = stats.top_authors.slice(0, 5);
    }

    if (topAuthors.length > 0) {
        dom.topAuthorsList.innerHTML = topAuthors
            .map(author => {
                const countNum = parseInt(author.count, 10) || 0;
                const label = `${formatNumber(countNum)} followers`;
                const cleanHandle = (author.handle || '').trim().replace(/^@/, '');
                const cleanName = (author.name && author.name.trim()) ? author.name : cleanHandle;
                return `
                    <div class="author-item" data-handle="${escapeHtml(cleanHandle)}">
                        <div class="author-info">
                            <a href="https://x.com/${escapeHtml(cleanHandle)}" class="author-link" data-handle="${escapeHtml(cleanHandle)}" title="View @${escapeHtml(cleanHandle)} profile">
                                <span class="author-name">${escapeHtml(cleanName)}</span>
                                <span class="author-handle">@${escapeHtml(cleanHandle)}</span>
                            </a>
                        </div>
                        <span class="author-count">${label}</span>
                    </div>
                `;
            })
            .join('');
    } else {
        dom.topAuthorsList.innerHTML = '<p class="empty-state">No cached users found yet.</p>';
    }
}

async function refreshAlarms() {
    try {
        const alarms = await invoke('get_alarms');
        if (Array.isArray(alarms) && alarms.length > 0) {
            state.alarms = alarms;
            try { localStorage.setItem('tweeker_alarms', JSON.stringify(alarms)); } catch (e) {}
        }
    } catch (e) {
        console.debug('[Tweeker] refreshAlarms fallback:', e);
    }
    renderAlarms(state.alarms || []);
}

function renderAlarms(alarms) {
    if (!alarms || alarms.length === 0) {
        dom.alarmsList.innerHTML = '<p class="empty-state">No alarms configured yet.</p>';
        return;
    }

    dom.alarmsList.innerHTML = alarms
        .map(alarm => {
            const rawType = typeof alarm.alarm_type === 'string' 
                ? alarm.alarm_type 
                : (Object.keys(alarm.alarm_type || {})[0] || 'keyword');
            const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1);
            const isNotify = !!alarm.notify;

            return `
                <div class="list-item" data-alarm-id="${alarm.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${escapeHtml(alarm.name)}</div>
                        <div class="list-item-subtitle">${typeLabel}: ${escapeHtml(alarm.pattern)}</div>
                    </div>
                    <div class="list-item-actions">
                        <div class="alarm-notify-control ${isNotify ? 'active' : ''}" title="Screen popup notification on/off (default off)">
                            <label class="toggle-switch" style="transform: scale(0.85);">
                                <input type="checkbox" class="alarm-notify-input" ${isNotify ? 'checked' : ''} />
                                <span class="toggle-slider"></span>
                            </label>
                            <span>Notify</span>
                        </div>
                        <label class="toggle-switch" title="Enable/disable alarm">
                            <input type="checkbox" class="alarm-toggle-input" ${alarm.enabled ? 'checked' : ''} />
                            <span class="toggle-slider"></span>
                        </label>
                        <button type="button" class="btn btn-danger alarm-delete-btn" title="Delete alarm">×</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

async function refreshScheduledTweets() {
    try {
        const tweets = await invoke('get_scheduled_tweets');
        if (Array.isArray(tweets) && tweets.length > 0) {
            state.scheduledTweets = tweets;
            try { localStorage.setItem('tweeker_scheduled_tweets', JSON.stringify(tweets)); } catch (e) {}
        }
    } catch (e) {
        console.debug('[Tweeker] refreshScheduledTweets fallback:', e);
    }
    renderScheduledTweets(state.scheduledTweets || []);
}

function renderScheduledTweets(tweets) {
    if (!tweets || tweets.length === 0) {
        dom.scheduledList.innerHTML = '<p class="empty-state">No scheduled tweets.</p>';
        return;
    }

    dom.scheduledList.innerHTML = tweets
        .map(tweet => {
            const isSent = tweet.status === 'Sent' || tweet.status === 'sent';
            const statusClass = isSent ? 'badge-active' : 'badge-inactive';

            // Build URL copy button if tweet is sent and has a numeric tweet ID
            let urlBtnHtml = '';
            const numericId = (tweet.tweet_id && /^\d+$/.test(tweet.tweet_id)) ? tweet.tweet_id : null;
            if (isSent && numericId) {
                const tweetUrl = `https://x.com/i/status/${numericId}`;
                urlBtnHtml = `<button type="button" class="btn btn-secondary schedule-url-btn" data-url="${tweetUrl}" title="Copy Tweet URL">🔗 URL</button>`;
            }

            return `
                <div class="list-item" data-tweet-id="${tweet.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${escapeHtml(truncate(tweet.content, 60))}</div>
                        <div class="list-item-subtitle">${formatDate(tweet.scheduled_for)} · <span class="${statusClass}" style="padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">${tweet.status}</span></div>
                    </div>
                    <div class="list-item-actions">
                        ${urlBtnHtml}
                        <button type="button" class="btn btn-danger schedule-delete-btn" title="Delete scheduled tweet">×</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

async function refreshConnectionStatus() {
    try {
        const status = await invoke('get_connection_status');
        if (status) {
            // Keep interceptor_active if already confirmed via postMessage
            if (state.connectionStatus.interceptor_active) {
                status.interceptor_active = true;
            }
            state.connectionStatus = { ...state.connectionStatus, ...status };
        }
        renderConnectionStatus(state.connectionStatus);
    } catch (e) {
        // Fallback: rely on window.postMessage state
        renderConnectionStatus(state.connectionStatus);
    }
}

function renderConnectionStatus(status) {
    if (status.interceptor_active) {
        dom.statusDot.className = 'status-dot connected';
        dom.statusText.textContent = 'Connected';
    } else if (status.x_webview_loaded) {
        dom.statusDot.className = 'status-dot';
        dom.statusText.textContent = 'Webview loaded';
    } else {
        dom.statusDot.className = 'status-dot disconnected';
        dom.statusText.textContent = 'Disconnected';
    }
}

async function refreshSettings() {
    await refreshConnectionStatus();

    const status = state.connectionStatus;
    dom.interceptorStatus.textContent = status.interceptor_active ? 'Active' : 'Inactive';
    dom.interceptorStatus.className = `setting-badge ${status.interceptor_active ? 'badge-active' : 'badge-inactive'}`;

    if (state.stats?.session_start) {
        dom.sessionStart.textContent = formatDate(state.stats.session_start);
    }

    try {
        const version = await invoke('get_app_version');
        dom.settingsVersion.textContent = `v${version}`;
    } catch (e) {
        dom.settingsVersion.textContent = '—';
    }
}

// ── Stats auto-refresh ──

function startStatsRefresh() {
    stopStatsRefresh();
    refreshStats();
    refreshConnectionStatus();
    state.statsRefreshInterval = setInterval(() => {
        if (state.activeTab === 'stats') refreshStats();
        refreshConnectionStatus();
    }, 5000);
}

function stopStatsRefresh() {
    if (state.statsRefreshInterval) {
        clearInterval(state.statsRefreshInterval);
        state.statsRefreshInterval = null;
    }
}

// ── Form Handlers ──

async function handleCreateAlarm(e) {
    e.preventDefault();

    const name = dom.alarmName.value.trim();
    const rawType = (dom.alarmType.value || 'keyword').toLowerCase();
    const pattern = dom.alarmPattern.value.trim();
    const notify = dom.alarmNotifyToggle ? dom.alarmNotifyToggle.checked : false;

    if (!name || !pattern) return;

    const newAlarm = {
        id: 'alarm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        name,
        alarm_type: rawType,
        pattern,
        enabled: true,
        notify: notify,
        created_at: new Date().toISOString(),
        last_triggered: null,
    };

    try {
        const created = await invoke('create_alarm', {
            request: {
                name: name,
                alarm_type: rawType,
                pattern: pattern,
                notify: notify,
            },
        });

        if (created && created.id) {
            newAlarm.id = created.id;
        }
    } catch (err) {
        console.debug('[Tweeker] IPC create_alarm fallback:', err);
    }

    if (!state.alarms) state.alarms = [];
    state.alarms.push(newAlarm);
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}

    addLogEntry({
        type: 'system',
        text: `Created alarm '${name}' (${rawType}: ${pattern}, notify: ${notify ? 'ON' : 'OFF'})`
    });

    dom.alarmName.value = '';
    dom.alarmPattern.value = '';
    if (dom.alarmNotifyToggle) dom.alarmNotifyToggle.checked = false;
    renderAlarms(state.alarms);
}

async function handleDeleteAlarm(id) {
    const alarm = (state.alarms || []).find(a => a.id === id);
    const alarmName = alarm ? alarm.name : id;
    try {
        await invoke('delete_alarm', { id }).catch(() => {});
    } catch (err) {}
    state.alarms = (state.alarms || []).filter(a => a.id !== id);
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
    renderAlarms(state.alarms);

    addLogEntry({
        type: 'system',
        text: `Deleted alarm '${alarmName}'`
    });
}

async function handleToggleAlarm(id, enabled) {
    try {
        await invoke('toggle_alarm', { id, enabled }).catch(() => {});
    } catch (err) {}
    const alarm = (state.alarms || []).find(a => a.id === id);
    if (alarm) {
        alarm.enabled = enabled;
        addLogEntry({
            type: 'system',
            text: `Alarm '${alarm.name}' ${enabled ? 'enabled' : 'disabled'}`
        });
    }
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
}

async function handleToggleAlarmNotify(id, notify) {
    try {
        await invoke('toggle_alarm_notify', { id, notify }).catch(() => {});
    } catch (err) {}
    const alarm = (state.alarms || []).find(a => a.id === id);
    if (alarm) {
        alarm.notify = notify;
        addLogEntry({
            type: 'system',
            text: `Alarm '${alarm.name}' screen notification ${notify ? 'enabled' : 'disabled'}`
        });
    }
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
    renderAlarms(state.alarms);
}

async function handleScheduleTweet(e) {
    e.preventDefault();

    const content = dom.scheduleContent.value.trim();
    const datetimeLocal = dom.scheduleDatetime.value;

    if (!content || !datetimeLocal) return;

    const localDate = parseLocalDatetimeInput(datetimeLocal);
    if (isNaN(localDate.getTime())) {
        console.error('[Tweeker] Invalid date format:', datetimeLocal);
        return;
    }

    const scheduledForIso = localDate.toISOString();

    const newTweet = {
        id: 'sched-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        content,
        scheduled_for: scheduledForIso,
        status: 'Pending',
        created_at: new Date().toISOString(),
    };

    try {
        const created = await invoke('create_scheduled_tweet', {
            content: content,
            scheduled_for: scheduledForIso,
        });

        if (created && created.id) {
            newTweet.id = created.id;
        }
    } catch (err) {
        console.debug('[Tweeker] IPC create_scheduled_tweet fallback:', err);
    }

    if (!state.scheduledTweets) state.scheduledTweets = [];
    state.scheduledTweets.push(newTweet);
    try { localStorage.setItem('tweeker_scheduled_tweets', JSON.stringify(state.scheduledTweets)); } catch (e) {}

    addLogEntry({
        type: 'system',
        text: `Scheduled tweet for ${formatDate(scheduledForIso)}: "${truncate(content, 50)}"`
    });

    dom.scheduleContent.value = '';
    dom.charCount.textContent = '0';

    const defaultNext = new Date();
    defaultNext.setHours(defaultNext.getHours() + 1);
    dom.scheduleDatetime.value = getLocalDatetimeInputValue(defaultNext);

    renderScheduledTweets(state.scheduledTweets);
}

async function handleDeleteScheduledTweet(id) {
    try {
        await invoke('delete_scheduled_tweet', { id }).catch(() => {});
    } catch (err) {}
    state.scheduledTweets = (state.scheduledTweets || []).filter(t => t.id !== id);
    try { localStorage.setItem('tweeker_scheduled_tweets', JSON.stringify(state.scheduledTweets)); } catch (e) {}
    renderScheduledTweets(state.scheduledTweets);

    addLogEntry({
        type: 'system',
        text: `Deleted scheduled tweet (ID: ${id})`
    });
}

// Make handlers available globally for inline onclick handlers
window.handleDeleteAlarm = handleDeleteAlarm;
window.handleToggleAlarm = handleToggleAlarm;
window.handleDeleteScheduledTweet = handleDeleteScheduledTweet;

// ── Utility functions ──

/**
 * Format a Date object into "YYYY-MM-DDTHH:mm" for <input type="datetime-local">
 * using the user's local timezone.
 */
function getLocalDatetimeInputValue(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse a "YYYY-MM-DDTHH:mm" string from <input type="datetime-local">
 * strictly in the user's local timezone.
 */
function parseLocalDatetimeInput(inputValue) {
    if (!inputValue) return new Date(NaN);
    const parts = inputValue.split('T');
    if (parts.length !== 2) return new Date(inputValue);
    const [datePart, timePart] = parts;
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0);
}

function formatNumber(num) {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toString();
}

function formatDate(isoString) {
    if (!isoString) return '—';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Log Management & Rendering ──

function updateLogCountText() {
    if (dom.logCountText) {
        dom.logCountText.textContent = `${state.logs.length} / ${state.maxLogLines} lines`;
    }
}

function pruneLogs() {
    if (!Array.isArray(state.logs)) state.logs = [];
    if (state.logs.length > state.maxLogLines) {
        state.logs = state.logs.slice(-state.maxLogLines);
    }
}

function addLogEntry(entry) {
    if (!entry) return;

    const type = entry.type || 'system';
    const text = entry.text || '';
    const rawTweetId = entry.tweetId || null;
    const authorHandle = entry.authorHandle || null;

    // Filter out synthetic fallback IDs (e.g. dom-...) for URL generation
    const isNumericId = rawTweetId && /^\d+$/.test(rawTweetId);
    const tweetId = rawTweetId;
    let tweetUrl = entry.tweetUrl || null;

    if (!tweetUrl && isNumericId) {
        const cleanHandle = authorHandle ? authorHandle.replace(/^@/, '') : '';
        tweetUrl = cleanHandle 
            ? `https://x.com/${cleanHandle}/status/${tweetId}`
            : `https://x.com/i/status/${tweetId}`;
    }

    const timestamp = entry.timestamp || new Date().toLocaleTimeString([], { hour12: false });

    const logItem = {
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type,
        text,
        tweetId,
        tweetUrl,
        authorHandle,
        timestamp,
    };

    if (!Array.isArray(state.logs)) state.logs = [];
    state.logs.push(logItem);
    pruneLogs();

    // Persist logs in localStorage
    try {
        localStorage.setItem('tweeker_logs', JSON.stringify(state.logs.slice(-500)));
    } catch (e) {}

    updateLogCountText();
    renderLogItem(logItem);
}

function renderLogItem(item) {
    if (!dom.logOutputContainer) return;

    // Remove empty state if present
    const emptyState = dom.logOutputContainer.querySelector('.log-empty-state');
    if (emptyState) emptyState.remove();

    const entryDiv = document.createElement('div');
    entryDiv.className = `log-entry log-entry-${item.type || 'system'}`;
    entryDiv.dataset.logId = item.id;
    entryDiv.innerHTML = getLogItemInnerHtml(item);

    dom.logOutputContainer.appendChild(entryDiv);

    // Prune DOM elements if DOM child count exceeds maxLogLines
    const entries = dom.logOutputContainer.querySelectorAll('.log-entry');
    if (entries.length > state.maxLogLines) {
        const toRemove = entries.length - state.maxLogLines;
        for (let i = 0; i < toRemove; i++) {
            entries[i].remove();
        }
    }

    // Autoscroll to bottom
    dom.logOutputContainer.scrollTop = dom.logOutputContainer.scrollHeight;
}

function getLogItemInnerHtml(item) {
    const type = item.type || 'system';
    const tagLabel = type.toUpperCase();
    
    let rawText = item.text || '';
    let displayText = rawText;
    if (displayText.length > 256) {
        displayText = displayText.substring(0, 256) + '...';
    }
    
    let contentHtml = escapeHtml(displayText);

    if (item.authorHandle) {
        const handleText = '@' + item.authorHandle.replace(/^@/, '');
        if (!contentHtml.includes('class="log-author"')) {
            const escapedHandle = escapeHtml(handleText);
            contentHtml = contentHtml.replace(escapedHandle, `<span class="log-author">${escapedHandle}</span>`);
        }
    }

    let linksHtml = '';
    const isRealNumericId = item.tweetId && /^\d+$/.test(item.tweetId);

    if (isRealNumericId) {
        const handle = (item.authorHandle || '').replace(/^@/, '');
        const url = item.tweetUrl || (handle ? `https://x.com/${handle}/status/${item.tweetId}` : `https://x.com/i/status/${item.tweetId}`);
        linksHtml = `
            <a class="log-id-link" data-copy-id="${escapeHtml(item.tweetId)}" title="Click to copy Tweet ID">ID: ${escapeHtml(item.tweetId)}</a>
            <a class="log-url-link" data-copy-url="${escapeHtml(url)}" title="Click to copy Tweet URL">🔗 URL</a>
        `;
    } else if (item.tweetUrl && /^https?:\/\//i.test(item.tweetUrl)) {
        linksHtml = `
            <a class="log-url-link" data-copy-url="${escapeHtml(item.tweetUrl)}" title="Click to copy Tweet URL">🔗 URL</a>
        `;
    } else if (item.tweetId && !item.tweetId.startsWith('dom-')) {
        linksHtml = `
            <a class="log-id-link" data-copy-id="${escapeHtml(item.tweetId)}" title="Click to copy ID">ID: ${escapeHtml(item.tweetId)}</a>
        `;
    }

    const copyBtnHtml = `
        <button class="log-copy-btn" data-log-text="${escapeHtml(rawText)}" title="Copy full log entry">
            <svg class="log-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        </button>
    `;

    return `
        <span class="log-timestamp">${escapeHtml(item.timestamp)}</span>
        <span class="log-tag log-tag-${type}">${tagLabel}</span>
        <span class="log-content">${contentHtml}${linksHtml}</span>
        ${copyBtnHtml}
    `;
}

function refreshLogsView() {
    if (!dom.logOutputContainer) return;
    updateLogCountText();

    if (!state.logs || state.logs.length === 0) {
        dom.logOutputContainer.innerHTML = '<p class="empty-state log-empty-state">No logs recorded yet.</p>';
        return;
    }

    dom.logOutputContainer.innerHTML = state.logs.map(item => `
        <div class="log-entry log-entry-${item.type || 'system'}" data-log-id="${item.id}">
            ${getLogItemInnerHtml(item)}
        </div>
    `).join('');

    dom.logOutputContainer.scrollTop = dom.logOutputContainer.scrollHeight;
}

function clearLogs() {
    state.logs = [];
    try { localStorage.removeItem('tweeker_logs'); } catch (e) {}
    updateLogCountText();
    if (dom.logOutputContainer) {
        dom.logOutputContainer.innerHTML = '<p class="empty-state log-empty-state">No logs recorded yet.</p>';
    }
    addLogEntry({
        type: 'system',
        text: 'Log output cleared'
    });
}


// ── Debug Logs Management ──

function addDebugLogEntry(text) {
    if (!state.debugTwitter) return;

    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const logItem = {
        id: 'debug-log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        type: 'debug',
        text: text,
        timestamp: timestamp
    };

    if (!Array.isArray(state.debugLogs)) state.debugLogs = [];
    state.debugLogs.push(logItem);
    pruneDebugLogs();

    if (state.activeTab === 'debug' && state.panelOpen) {
        refreshDebugView();
    } else {
        renderDebugLogItem(logItem);
    }
}

function pruneDebugLogs() {
    if (!state.debugLogs) state.debugLogs = [];
    if (state.debugLogs.length > state.maxDebugLines) {
        state.debugLogs = state.debugLogs.slice(-state.maxDebugLines);
    }
}

function renderDebugLogItem(item) {
    if (!dom.debugOutputContainer || !state.debugTwitter) return;

    // Remove empty state if present
    const emptyState = dom.debugOutputContainer.querySelector('.log-empty-state');
    if (emptyState) emptyState.remove();

    const entryDiv = document.createElement('div');
    entryDiv.className = `log-entry log-entry-debug`;
    entryDiv.dataset.logId = item.id;
    entryDiv.innerHTML = getLogItemInnerHtml(item);

    dom.debugOutputContainer.appendChild(entryDiv);

    // Prune DOM elements if DOM child count exceeds maxDebugLines
    const entries = dom.debugOutputContainer.querySelectorAll('.log-entry');
    if (entries.length > state.maxDebugLines) {
        const toRemove = entries.length - state.maxDebugLines;
        for (let i = 0; i < toRemove; i++) {
            entries[i].remove();
        }
    }

    // Autoscroll to bottom
    dom.debugOutputContainer.scrollTop = dom.debugOutputContainer.scrollHeight;
    updateDebugCountText();
}

function refreshDebugView() {
    if (!dom.debugOutputContainer) return;
    updateDebugCountText();

    if (!state.debugLogs || state.debugLogs.length === 0) {
        dom.debugOutputContainer.innerHTML = '<p class="empty-state log-empty-state">No debug logs recorded yet. Enable "Debug Twitter" setting to start capturing.</p>';
        return;
    }

    dom.debugOutputContainer.innerHTML = state.debugLogs.map(item => `
        <div class="log-entry log-entry-debug" data-log-id="${item.id}">
            ${getLogItemInnerHtml(item)}
        </div>
    `).join('');

    dom.debugOutputContainer.scrollTop = dom.debugOutputContainer.scrollHeight;
}

function clearDebugLogs() {
    state.debugLogs = [];
    try { localStorage.removeItem('tweeker_debug_logs'); } catch (e) {}
    updateDebugCountText();
    if (dom.debugOutputContainer) {
        dom.debugOutputContainer.innerHTML = '<p class="empty-state log-empty-state">No debug logs recorded yet. Enable "Debug Twitter" setting to start capturing.</p>';
    }
    addDebugLogEntry('Debug log output cleared');
}

function updateDebugCountText() {
    if (dom.debugCountText) {
        const count = state.debugLogs ? state.debugLogs.length : 0;
        dom.debugCountText.textContent = `${count} / ${state.maxDebugLines} lines`;
    }
}

function setDebugTwitterState(enabled) {
    state.debugTwitter = !!enabled;
    if (dom.debugTwitterToggle) {
        dom.debugTwitterToggle.checked = state.debugTwitter;
    }
    
    // Toggle debug tab button visibility
    if (dom.debugTab) {
        if (state.debugTwitter) {
            dom.debugTab.style.display = 'flex';
        } else {
            dom.debugTab.style.display = 'none';
            // If active tab was debug and we turned it off, switch to stats
            if (state.activeTab === 'debug') {
                switchTab('stats');
            }
        }
    }
    
    // Persist to local storage
    try {
        localStorage.setItem('tweeker_debug_twitter', state.debugTwitter ? 'true' : 'false');
    } catch (e) {}

    // Notify injected script
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_debug_twitter',
            enabled: state.debugTwitter
        }, '*');
    } catch (e) {}
}

function copyToClipboard(text, successMessage = 'Copied!') {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToastMessage(successMessage);
            }).catch(() => {
                fallbackCopyText(text, successMessage);
            });
        } else {
            fallbackCopyText(text, successMessage);
        }
    } catch (e) {
        console.error('[Tweeker] Failed to copy:', e);
    }
}

function fallbackCopyText(text, successMessage) {
    try {
        const dummy = document.createElement('textarea');
        dummy.value = text;
        document.body.appendChild(dummy);
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
        showToastMessage(successMessage);
    } catch (e) {
        console.error('[Tweeker] Fallback copy failed:', e);
    }
}

function showToastMessage(msg) {
    if (!dom.copyUrlToast) return;
    dom.copyUrlToast.textContent = msg;
    dom.copyUrlToast.classList.add('show');
    setTimeout(() => {
        dom.copyUrlToast.classList.remove('show');
        setTimeout(() => { dom.copyUrlToast.textContent = 'Copied!'; }, 200);
    }, 1500);
}

function handleCopyUrl() {
    copyToClipboard(window.location.href, 'URL Copied!');
}

function fallbackCopyUrl(url) {
    fallbackCopyText(url, 'URL Copied!');
}

function showCopyToast() {
    showToastMessage('URL Copied!');
}

// ── Draggable Overlay Toggle Button ──

function initDraggableToggle() {
    const toggle = dom.overlayToggle;
    if (!toggle) return;

    // Restore saved position
    const savedPos = localStorage.getItem('tweeker_toggle_pos');
    if (savedPos) {
        try {
            const { top, left } = JSON.parse(savedPos);
            const maxLeft = Math.max(10, window.innerWidth - 60);
            const maxTop = Math.max(10, window.innerHeight - 60);
            const validLeft = Math.min(Math.max(10, left), maxLeft);
            const validTop = Math.min(Math.max(10, top), maxTop);
            toggle.style.top = validTop + 'px';
            toggle.style.left = validLeft + 'px';
            toggle.style.right = 'auto';
            toggle.style.bottom = 'auto';
        } catch (e) {}
    }

    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;
    let dragThresholdPassed = false;

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;

        isDragging = true;
        dragThresholdPassed = false;
        startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

        const rect = toggle.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('touchend', onPointerUp);
    }

    function onPointerMove(e) {
        if (!isDragging) return;

        const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        if (!dragThresholdPassed && Math.hypot(deltaX, deltaY) > 5) {
            dragThresholdPassed = true;
            toggle.classList.add('is-dragging');
        }

        if (dragThresholdPassed) {
            if (e.cancelable) e.preventDefault();

            const newLeft = Math.min(Math.max(10, initialLeft + deltaX), window.innerWidth - 60);
            const newTop = Math.min(Math.max(10, initialTop + deltaY), window.innerHeight - 60);

            toggle.style.left = newLeft + 'px';
            toggle.style.top = newTop + 'px';
            toggle.style.right = 'auto';
            toggle.style.bottom = 'auto';
        }
    }

    function onPointerUp() {
        if (!isDragging) return;

        isDragging = false;
        toggle.classList.remove('is-dragging');

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        if (dragThresholdPassed) {
            const rect = toggle.getBoundingClientRect();
            localStorage.setItem('tweeker_toggle_pos', JSON.stringify({
                left: rect.left,
                top: rect.top
            }));
        }
    }

    toggle.addEventListener('pointerdown', onPointerDown);

    toggle.addEventListener('click', (e) => {
        if (dragThresholdPassed) {
            e.stopImmediatePropagation();
            dragThresholdPassed = false;
            return;
        }
        togglePanel();
    });
}

// ── Resizable Overlay Panel Drawer ──

function getClampedPanelDimensions(rawWidth, rawHeight) {
    const screenW = window.innerWidth || document.documentElement.clientWidth || 1200;
    const screenH = window.innerHeight || document.documentElement.clientHeight || 800;

    // Minimum limits: 320px width, 300px height
    // Maximum limits: 70% width, 96% height
    const maxW = Math.max(320, Math.round(screenW * 0.70));
    const minW = Math.min(320, maxW);

    const maxH = Math.max(300, Math.round(screenH * 0.96));
    const minH = Math.min(300, maxH);

    // Default dimensions: 23% screen width, 90% screen height
    const defaultW = Math.round(screenW * 0.23);
    const defaultH = Math.round(screenH * 0.90);

    let w = (rawWidth !== undefined && rawWidth !== null) ? parseInt(rawWidth, 10) : defaultW;
    let h = (rawHeight !== undefined && rawHeight !== null) ? parseInt(rawHeight, 10) : defaultH;

    if (isNaN(w) || w <= 0) w = defaultW;
    if (isNaN(h) || h <= 0) h = defaultH;

    w = Math.max(minW, Math.min(maxW, w));
    h = Math.max(minH, Math.min(maxH, h));

    return { width: w, height: h };
}

function applyPanelDimensions(width, height) {
    const panel = dom.overlayPanel;
    if (!panel) return;

    const clamped = getClampedPanelDimensions(width, height);
    state.panelSize = clamped;

    panel.style.setProperty('width', clamped.width + 'px', 'important');
    panel.style.setProperty('height', clamped.height + 'px', 'important');
    panel.style.setProperty('top', '20px', 'important');
    panel.style.setProperty('right', '20px', 'important');

    return clamped;
}

function savePanelSize(width, height) {
    try {
        localStorage.setItem('tweeker_panel_size', JSON.stringify({ width, height }));
    } catch (e) {}
}

function initResizablePanel() {
    const panel = dom.overlayPanel;
    const handleLeft = dom.panelResizeHandleLeft || document.getElementById('panel-resize-handle-left');
    const handleBottom = dom.panelResizeHandleBottom || document.getElementById('panel-resize-handle-bottom');
    const handleCorner = dom.panelResizeHandleCorner || document.getElementById('panel-resize-handle-corner');

    if (!panel) return;

    // Restore saved size from localStorage
    let savedW = null;
    let savedH = null;
    try {
        const saved = localStorage.getItem('tweeker_panel_size');
        if (saved) {
            const parsed = JSON.parse(saved);
            savedW = parsed.width;
            savedH = parsed.height;
        }
    } catch (e) {}

    // Apply initial clamped dimensions
    applyPanelDimensions(savedW, savedH);

    let activeHandle = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    function startResize(e, handleType) {
        if (e.button !== undefined && e.button !== 0) return;

        activeHandle = handleType;
        startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

        const rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;

        panel.classList.add('is-resizing');

        const el = (handleType === 'left') ? handleLeft :
                   (handleType === 'bottom') ? handleBottom : handleCorner;
        if (el) el.classList.add('active');

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('touchend', onPointerUp);
    }

    function onPointerMove(e) {
        if (!activeHandle) return;
        if (e.cancelable) e.preventDefault();

        const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        const currentY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

        let newWidth = startWidth;
        let newHeight = startHeight;

        if (activeHandle === 'left' || activeHandle === 'corner') {
            // Dragging left (negative deltaX) increases width because panel is right-anchored
            const deltaX = startX - currentX;
            newWidth = startWidth + deltaX;
        }

        if (activeHandle === 'bottom' || activeHandle === 'corner') {
            // Dragging down (positive deltaY) increases height because panel is top-anchored
            const deltaY = currentY - startY;
            newHeight = startHeight + deltaY;
        }

        applyPanelDimensions(newWidth, newHeight);
    }

    function onPointerUp() {
        if (!activeHandle) return;

        panel.classList.remove('is-resizing');
        [handleLeft, handleBottom, handleCorner].forEach(h => {
            if (h) h.classList.remove('active');
        });

        activeHandle = null;

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        if (state.panelSize) {
            savePanelSize(state.panelSize.width, state.panelSize.height);
        }
    }

    if (handleLeft) {
        handleLeft.addEventListener('pointerdown', (e) => startResize(e, 'left'));
    }
    if (handleBottom) {
        handleBottom.addEventListener('pointerdown', (e) => startResize(e, 'bottom'));
    }
    if (handleCorner) {
        handleCorner.addEventListener('pointerdown', (e) => startResize(e, 'corner'));
    }

    // Re-clamp on window resize to ensure max 70% width / 96% height limits are maintained
    window.addEventListener('resize', () => {
        if (state.panelSize) {
            applyPanelDimensions(state.panelSize.width, state.panelSize.height);
        }
    });
}

// ── Browser Navigation Bar Logic ──

function syncNavUrlInput() {
    if (!dom.navUrlInput) return;
    // Do not overwrite while user is actively editing/focusing the URL input
    if (document.activeElement === dom.navUrlInput) return;

    try {
        const currentUrl = window.location.href;
        if (currentUrl && dom.navUrlInput.value !== currentUrl) {
            dom.navUrlInput.value = currentUrl;
        }
    } catch (e) {}
}

function handleNavigateUrl() {
    if (!dom.navUrlInput) return;

    let input = dom.navUrlInput.value.trim();
    if (!input) return;

    let targetUrl = input;

    // Handle relative path (e.g. /home or /notifications or /elonmusk)
    if (input.startsWith('/')) {
        targetUrl = 'https://x.com' + input;
    } else if (!/^https?:\/\//i.test(input)) {
        // Handle x.com/... or twitter.com/... or raw username
        if (input.startsWith('x.com') || input.startsWith('twitter.com')) {
            targetUrl = 'https://' + input;
        } else {
            targetUrl = 'https://x.com/' + input.replace(/^@/, '');
        }
    }

    addLogEntry({
        type: 'system',
        text: `Navigating to: ${targetUrl}`
    });

    try {
        window.location.href = targetUrl;
    } catch (e) {
        console.error('[Tweeker Navigation Error]', e);
    }
}

function initBrowserNavBar() {
    if (dom.navBackBtn) {
        dom.navBackBtn.addEventListener('click', () => {
            try { window.history.back(); } catch (e) {}
        });
    }

    if (dom.navForwardBtn) {
        dom.navForwardBtn.addEventListener('click', () => {
            try { window.history.forward(); } catch (e) {}
        });
    }

    if (dom.navReloadBtn) {
        dom.navReloadBtn.addEventListener('click', () => {
            try { window.location.reload(); } catch (e) {}
        });
    }

    if (dom.navUrlInput) {
        dom.navUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleNavigateUrl();
            }
        });
    }

    // Sync URL input initially and on location changes
    syncNavUrlInput();
    window.addEventListener('popstate', syncNavUrlInput);
    window.addEventListener('hashchange', syncNavUrlInput);

    // Periodically check for SPA URL navigation changes inside X.com
    setInterval(syncNavUrlInput, 2000);
}

// ── Auto Read Management ──

function setAutoReadState(enabled) {
    const prevState = state.autoRead;
    state.autoRead = !!enabled;
    if (dom.autoReadToggle) {
        dom.autoReadToggle.checked = state.autoRead;
    }
    
    // Notify injected interceptor script via postMessage
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_auto_read',
            enabled: state.autoRead
        }, '*');
    } catch (e) {}

    // Update Rust backend if connected
    invoke('set_auto_read', { enabled: state.autoRead }).catch(() => {});

    if (prevState !== state.autoRead) {
        addLogEntry({
            type: 'system',
            text: `Auto read timeline ${state.autoRead ? 'enabled' : 'disabled'}`
        });
    }
}

// ── Event Listeners ──

// Auto read toggles
if (dom.autoReadToggle) {
    dom.autoReadToggle.addEventListener('change', (e) => {
        setAutoReadState(e.target.checked);
    });
}

if (dom.autoReadStartupToggle) {
    dom.autoReadStartupToggle.addEventListener('change', (e) => {
        const startupEnabled = e.target.checked;
        localStorage.setItem('tweeker_autoread_on_start', startupEnabled ? 'true' : 'false');
        state.autoReadOnStart = startupEnabled;
        if (startupEnabled) {
            setAutoReadState(true);
        }
    });
}

// Copy URL button
if (dom.copyUrlBtn) {
    dom.copyUrlBtn.addEventListener('click', handleCopyUrl);
}

// Panel close
dom.panelClose.addEventListener('click', () => togglePanel(false));

// Alarms list event delegation
if (dom.alarmsList) {
    dom.alarmsList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.alarm-delete-btn') || e.target.closest('.btn-danger');
        if (deleteBtn) {
            const item = deleteBtn.closest('.list-item');
            if (item && item.dataset.alarmId) {
                handleDeleteAlarm(item.dataset.alarmId);
            }
        }
    });

    dom.alarmsList.addEventListener('change', (e) => {
        const notifyInput = e.target.closest('.alarm-notify-input');
        if (notifyInput) {
            const item = notifyInput.closest('.list-item');
            if (item && item.dataset.alarmId) {
                handleToggleAlarmNotify(item.dataset.alarmId, notifyInput.checked);
            }
            return;
        }

        const toggleInput = e.target.closest('.alarm-toggle-input');
        if (toggleInput) {
            const item = toggleInput.closest('.list-item');
            if (item && item.dataset.alarmId) {
                handleToggleAlarm(item.dataset.alarmId, toggleInput.checked);
            }
        }
    });
}

// Scheduled tweets list event delegation
if (dom.scheduledList) {
    dom.scheduledList.addEventListener('click', (e) => {
        const urlBtn = e.target.closest('.schedule-url-btn');
        if (urlBtn) {
            const targetUrl = urlBtn.dataset.url;
            if (targetUrl) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(targetUrl).catch(() => {});
                }
                showToastMessage('Tweet URL copied!');
                addLogEntry({
                    type: 'system',
                    text: `Copied scheduled tweet URL to clipboard: ${targetUrl}`
                });
            }
            return;
        }

        const deleteBtn = e.target.closest('.schedule-delete-btn') || e.target.closest('.btn-danger');
        if (deleteBtn) {
            const item = deleteBtn.closest('.list-item');
            if (item && item.dataset.tweetId) {
                handleDeleteScheduledTweet(item.dataset.tweetId);
            }
        }
    });
}

// Initialize draggable toggle button, resizable panel, and browser nav bar
initDraggableToggle();
initResizablePanel();
initBrowserNavBar();

// Keyboard shortcut: Ctrl/Cmd + Shift + T
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        togglePanel();
    }
    // Escape to close
    if (e.key === 'Escape' && state.panelOpen) {
        togglePanel(false);
    }
});

// Tab switching
dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
    });
});

// Forms
dom.alarmForm.addEventListener('submit', handleCreateAlarm);
dom.scheduleForm.addEventListener('submit', handleScheduleTweet);

// Character counter for tweet composer
dom.scheduleContent.addEventListener('input', () => {
    dom.charCount.textContent = dom.scheduleContent.value.length;
});

// Clear logs button
if (dom.clearLogsBtn) {
    dom.clearLogsBtn.addEventListener('click', clearLogs);
}

// Max log lines setting input
if (dom.maxLogLinesInput) {
    dom.maxLogLinesInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 10) val = 2000;
        state.maxLogLines = val;
        e.target.value = val;
        try { localStorage.setItem('tweeker_max_log_lines', val.toString()); } catch (err) {}
        pruneLogs();
        refreshLogsView();
        addLogEntry({
            type: 'system',
            text: `Maximum log lines limit updated to ${val}`
        });
    });
}

// Twitter user cache limit setting input
if (dom.userCacheLimitInput) {
    dom.userCacheLimitInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 10) val = 10000;
        e.target.value = val;
        try { localStorage.setItem('tweeker_user_cache_limit', val.toString()); } catch (err) {}
        invoke('set_user_cache_limit', { limit: val }).catch((err) => {
            console.error('[Tweeker App] Failed to set user cache limit:', err);
        });
        addLogEntry({
            type: 'system',
            text: `Twitter user cache limit updated to ${val}`
        });
    });
}

// Followers to be relevant setting input
if (dom.relevantFollowersLimitInput) {
    dom.relevantFollowersLimitInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 0) val = 2500;
        e.target.value = val;
        try { localStorage.setItem('tweeker_relevant_followers_limit', val.toString()); } catch (err) {}
        const color = dom.relevantHighlightColorInput ? dom.relevantHighlightColorInput.value : '#00ba7c';
        window.postMessage({
            __tweeker: true,
            type: 'set_relevant_followers_limit',
            limit: val,
            color: color
        }, '*');
        addLogEntry({
            type: 'system',
            text: `Followers to be relevant updated to ${val}`
        });
    });
}

// Relevant highlight color picker
if (dom.relevantHighlightColorInput) {
    dom.relevantHighlightColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        try { localStorage.setItem('tweeker_relevant_highlight_color', color); } catch (err) {}
        window.postMessage({
            __tweeker: true,
            type: 'set_relevant_highlight_color',
            color: color
        }, '*');
        addLogEntry({
            type: 'system',
            text: `Relevant highlight color updated to ${color}`
        });
    });
}

function syncListFilterSettings() {
    const config = {
        minFollowers: state.listMinFollowers,
        minRatio: state.listMinRatio,
        highlightVerified: state.listHighlightVerified,
        verifiedColor: state.listVerifiedColor,
        highlightMega: state.listHighlightMega,
        megaColor: state.listMegaColor
    };
    window.postMessage({
        __tweeker: true,
        type: 'set_list_filter_settings',
        config: config
    }, '*');
}

// List Page Filters & Highlights Listeners
if (dom.listMinFollowersInput) {
    dom.listMinFollowersInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        e.target.value = val;
        state.listMinFollowers = val;
        try { localStorage.setItem('tweeker_list_min_followers', val.toString()); } catch (err) {}
        syncListFilterSettings();
        addLogEntry({
            type: 'system',
            text: `List page min followers filter set to ${val}`
        });
    });
}

if (dom.listMinRatioInput) {
    dom.listMinRatioInput.addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0.0) val = 0.0;
        e.target.value = val.toFixed(1);
        state.listMinRatio = val;
        try { localStorage.setItem('tweeker_list_min_ratio', val.toString()); } catch (err) {}
        syncListFilterSettings();
        addLogEntry({
            type: 'system',
            text: `List page min ratio filter set to ${val.toFixed(1)}`
        });
    });
}

if (dom.listHighlightVerifiedToggle) {
    dom.listHighlightVerifiedToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        state.listHighlightVerified = enabled;
        try { localStorage.setItem('tweeker_list_highlight_verified', enabled ? 'true' : 'false'); } catch (err) {}
        syncListFilterSettings();
        addLogEntry({
            type: 'system',
            text: `List page verified highlight ${enabled ? 'enabled' : 'disabled'}`
        });
    });
}

if (dom.listVerifiedColorInput) {
    dom.listVerifiedColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        state.listVerifiedColor = color;
        try { localStorage.setItem('tweeker_list_verified_color', color); } catch (err) {}
        syncListFilterSettings();
    });
}

if (dom.listHighlightMegaToggle) {
    dom.listHighlightMegaToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        state.listHighlightMega = enabled;
        try { localStorage.setItem('tweeker_list_highlight_mega', enabled ? 'true' : 'false'); } catch (err) {}
        syncListFilterSettings();
        addLogEntry({
            type: 'system',
            text: `List page mega influencer highlight ${enabled ? 'enabled' : 'disabled'}`
        });
    });
}

if (dom.listMegaColorInput) {
    dom.listMegaColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        state.listMegaColor = color;
        try { localStorage.setItem('tweeker_list_mega_color', color); } catch (err) {}
        syncListFilterSettings();
    });
}

// Dump database statistics button
if (dom.dumpDbStatsBtn) {
    dom.dumpDbStatsBtn.addEventListener('click', async () => {
        await emitDbStatsLog();
        showToastMessage('Database statistics dumped to log!');
    });
}

// Log container click delegation for Tweet ID & URL copy links
if (dom.logOutputContainer) {
    dom.logOutputContainer.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.log-copy-btn');
        if (copyBtn) {
            const logText = copyBtn.dataset.logText;
            if (logText) {
                copyToClipboard(logText, 'Log entry copied!');
            }
            return;
        }

        const idLink = e.target.closest('.log-id-link');
        if (idLink) {
            const copyId = idLink.dataset.copyId;
            if (copyId) {
                copyToClipboard(copyId, 'Tweet ID copied!');
            }
            return;
        }

        const urlLink = e.target.closest('.log-url-link');
        if (urlLink) {
            const copyUrl = urlLink.dataset.copyUrl;
            if (copyUrl) {
                copyToClipboard(copyUrl, 'Tweet URL copied!');
            }
            return;
        }
    });
}

// My Followers stat card click handler to navigate to user's profile
if (dom.statMyFollowersCard) {
    dom.statMyFollowersCard.addEventListener('click', () => {
        getMyUserFollowersInfo();
        const handle = window.__tweeker_my_handle;
        if (handle) {
            const cleanHandle = handle.trim().replace(/^@/, '');
            const targetUrl = 'https://x.com/' + cleanHandle;
            addLogEntry({
                type: 'system',
                text: `Navigating to my profile: @${cleanHandle}`
            });
            try {
                window.location.href = targetUrl;
            } catch (err) {
                console.error('[Tweeker Navigation Error]', err);
            }
        }
    });
}

// Top authors list click delegation to navigate to Twitter user profile
if (dom.topAuthorsList) {
    dom.topAuthorsList.addEventListener('click', (e) => {
        const link = e.target.closest('a.author-link') || e.target.closest('.author-item[data-handle]');
        if (link) {
            e.preventDefault();
            const handle = link.dataset.handle || link.getAttribute('data-handle');
            if (handle) {
                const cleanHandle = handle.trim().replace(/^@/, '');
                const targetUrl = 'https://x.com/' + cleanHandle;
                addLogEntry({
                    type: 'system',
                    text: `Navigating to author profile: @${cleanHandle}`
                });
                try {
                    window.location.href = targetUrl;
                } catch (err) {
                    console.error('[Tweeker Navigation Error]', err);
                }
            }
        }
    });
}

// Clear debug logs button
if (dom.clearDebugBtn) {
    dom.clearDebugBtn.addEventListener('click', clearDebugLogs);
}

// Debug Twitter setting toggle
if (dom.debugTwitterToggle) {
    dom.debugTwitterToggle.addEventListener('change', (e) => {
        setDebugTwitterState(e.target.checked);
        addLogEntry({
            type: 'system',
            text: `Debug Twitter ${state.debugTwitter ? 'enabled' : 'disabled'}`
        });
    });
}

// Max debug log lines setting input
if (dom.maxDebugLinesInput) {
    dom.maxDebugLinesInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 10) val = 2000;
        state.maxDebugLines = val;
        e.target.value = val;
        try { localStorage.setItem('tweeker_max_debug_lines', val.toString()); } catch (err) {}
        pruneDebugLogs();
        refreshDebugView();
        addLogEntry({
            type: 'system',
            text: `Maximum debug log lines limit updated to ${val}`
        });
    });
}

// Debug container click delegation
if (dom.debugOutputContainer) {
    dom.debugOutputContainer.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.log-copy-btn');
        if (copyBtn) {
            const logText = copyBtn.dataset.logText;
            if (logText) {
                copyToClipboard(logText, 'Log entry copied!');
            }
            return;
        }

        const idLink = e.target.closest('.log-id-link');
        if (idLink) {
            const copyId = idLink.dataset.copyId;
            if (copyId) {
                copyToClipboard(copyId, 'Tweet ID copied!');
            }
            return;
        }

        const urlLink = e.target.closest('.log-url-link');
        if (urlLink) {
            const copyUrl = urlLink.dataset.copyUrl;
            if (copyUrl) {
                copyToClipboard(copyUrl, 'Tweet URL copied!');
            }
            return;
        }
    });
}

// ── Interceptor Message Handler ──
function processIncomingTweets(tweets) {
    if (!tweets || !Array.isArray(tweets)) return;

    if (!state.stats) {
        state.stats = {
            total_tweets_seen: 0,
            unique_authors: 0,
            total_likes: 0,
            total_retweets: 0,
            total_replies: 0,
            session_start: new Date().toISOString(),
            top_authors: [],
        };
    }

    if (!window._tweeker_seen_tweets) window._tweeker_seen_tweets = new Set();
    if (!window._tweeker_author_map) window._tweeker_author_map = new Map();

    for (const tweet of tweets) {
        if (!tweet || !tweet.tweet_id || window._tweeker_seen_tweets.has(tweet.tweet_id)) continue;
        window._tweeker_seen_tweets.add(tweet.tweet_id);

        state.stats.total_tweets_seen += 1;
        state.stats.total_likes += (tweet.likes || 0);
        state.stats.total_retweets += (tweet.retweets || 0);
        state.stats.total_replies += (tweet.replies || 0);

        const rawHandle = tweet.author_handle || 'unknown';
        const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
        const name = (tweet.author_name && tweet.author_name.trim()) ? tweet.author_name : handle;
        const current = window._tweeker_author_map.get(handle) || { name, count: 0 };
        current.count += 1;
        if (tweet.author_name && tweet.author_name.trim()) {
            current.name = tweet.author_name;
        }
        window._tweeker_author_map.set(handle, current);

        // Evaluate active alarms against incoming tweet
        checkAlarmsForTweet(tweet);
    }

    state.stats.unique_authors = window._tweeker_author_map.size;

    const top = Array.from(window._tweeker_author_map.entries())
        .map(([handle, info]) => ({ handle, name: info.name, count: info.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    state.stats.top_authors = top;

    if (state.activeTab === 'stats') {
        renderStats(state.stats);
    }
}

function checkAlarmsForTweet(tweet) {
    if (!state.alarms || !Array.isArray(state.alarms)) return;

    const fullText = (tweet.full_text || tweet.content || '').toLowerCase();
    const authorHandle = (tweet.author_handle || '').toLowerCase();
    const authorName = (tweet.author_name || '').toLowerCase();
    const likes = tweet.likes || 0;
    const retweets = tweet.retweets || 0;

    for (const alarm of state.alarms) {
        if (!alarm.enabled || !alarm.pattern) continue;

        const rawType = typeof alarm.alarm_type === 'string'
            ? alarm.alarm_type.toLowerCase()
            : (Object.keys(alarm.alarm_type || {})[0] || 'keyword').toLowerCase();

        const pattern = alarm.pattern.trim().toLowerCase();
        let matched = false;

        if (rawType === 'keyword') {
            matched = fullText.includes(pattern);
        } else if (rawType === 'user') {
            const cleanPattern = pattern.replace(/^@/, '');
            matched = authorHandle.includes(cleanPattern) || authorName.includes(cleanPattern);
        } else if (rawType === 'mention') {
            const cleanPattern = pattern.replace(/^@/, '');
            matched = fullText.includes('@' + cleanPattern);
        } else if (rawType === 'engagement') {
            const minEngagement = parseInt(pattern, 10);
            if (!isNaN(minEngagement)) {
                matched = (likes + retweets) >= minEngagement;
            }
        }

        if (matched) {
            alarm.last_triggered = new Date().toISOString();

            // ONLY show on-screen popup toast IF alarm.notify is true (default is off/false)
            if (alarm.notify) {
                showAlarmToast(alarm, tweet);
            }

            renderAlarms(state.alarms);
            try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}

            const tweetId = tweet.tweet_id || '';
            const author = tweet.author_handle || 'user';
            const tweetUrl = tweetId ? `https://x.com/${author}/status/${tweetId}` : null;

            addLogEntry({
                type: 'alarm',
                text: `Alarm '${alarm.name}' triggered by @${author}: "${truncate(tweet.full_text || tweet.content, 60)}"`,
                tweetId: tweetId,
                tweetUrl: tweetUrl,
                authorHandle: author
            });
        }
    }
}

function showAlarmToast(alarm, tweet) {
    let container = document.getElementById('tweeker-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tweeker-toast-container';
        const overlay = document.getElementById('tweeker-overlay-container') || document.body;
        overlay.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'tweeker-alarm-toast';
    toast.innerHTML = `
        <div class="alarm-toast-title">🚨 Alarm Triggered: ${escapeHtml(alarm.name)}</div>
        <div class="alarm-toast-text"><strong>@${escapeHtml(tweet.author_handle || 'user')}</strong>: ${escapeHtml(truncate(tweet.full_text || tweet.content, 80))}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 4500);
}

async function postTweetToX(content) {
    if (!content) return { success: false };

    try {
        // 1. Check if composer is already visible
        let composer = document.querySelector('[data-testid="tweetTextarea_0"]') 
            || document.querySelector('[role="textbox"][contenteditable="true"]');

        // 2. If composer is not visible, click the sidebar Post button
        if (!composer) {
            const composeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]')
                || document.querySelector('a[href="/compose/post"]')
                || document.querySelector('[aria-label="Post"]');
            
            if (composeBtn) {
                composeBtn.click();
                await new Promise(r => setTimeout(r, 600));
                composer = document.querySelector('[data-testid="tweetTextarea_0"]') 
                    || document.querySelector('[role="textbox"][contenteditable="true"]');
            }
        }

        // 3. Insert tweet text into composer
        if (composer) {
            composer.focus();

            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(composer);
            selection.removeAllRanges();
            selection.addRange(range);

            document.execCommand('insertText', false, content);
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            composer.dispatchEvent(new Event('change', { bubbles: true }));

            await new Promise(r => setTimeout(r, 600));

            // 4. Click the Post button
            const postBtn = document.querySelector('[data-testid="tweetButtonInline"]')
                || document.querySelector('[data-testid="tweetButton"]')
                || document.querySelector('[aria-label="Post"]');

            if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
                postBtn.click();
                console.log('[Tweeker] Successfully clicked Post button in UI composer!');
                await new Promise(r => setTimeout(r, 1200));

                // 5. Try finding newly posted tweet numeric ID from DOM status links
                let capturedId = null;
                const statusLinks = document.querySelectorAll('a[href*="/status/"]');
                if (statusLinks && statusLinks.length > 0) {
                    for (const link of Array.from(statusLinks)) {
                        const href = link.getAttribute('href') || '';
                        const match = href.match(/\/status\/(\d+)/);
                        if (match && match[1]) {
                            capturedId = match[1];
                            break;
                        }
                    }
                }

                return { success: true, tweet_id: capturedId };
            }
        }
    } catch (err) {
        console.error('[Tweeker] Automatic tweet post error:', err);
    }
    return { success: false };
}

function postTweetViaXApi(content) {
    return new Promise((resolve) => {
        const requestId = 'req-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

        const timeoutTimer = setTimeout(() => {
            window.removeEventListener('message', responseHandler);
            resolve({ success: false, error: 'API timeout' });
        }, 8000);

        function responseHandler(event) {
            if (event.data && event.data.__tweeker && event.data.type === 'post_tweet_api_response' && event.data.requestId === requestId) {
                clearTimeout(timeoutTimer);
                window.removeEventListener('message', responseHandler);
                resolve(event.data.result || { success: false });
            }
        }

        window.addEventListener('message', responseHandler);

        window.postMessage({
            __tweeker: true,
            type: 'post_tweet_api',
            requestId: requestId,
            content: content
        }, '*');
    });
}

async function checkScheduledTweets() {
    if (!state.scheduledTweets || !Array.isArray(state.scheduledTweets)) return;

    const now = new Date();
    let updated = false;

    for (const tweet of state.scheduledTweets) {
        const isPending = tweet.status === 'Pending' || tweet.status === 'pending' || !tweet.status;
        if (!isPending) continue;

        const schedDate = new Date(tweet.scheduled_for);
        if (!isNaN(schedDate.getTime()) && schedDate <= now) {
            tweet.status = 'Sent';
            updated = true;

            // Copy tweet content to clipboard as fallback
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(tweet.content).catch(() => {});
            }

            // 1. Try sending tweet directly via X.com API (bypassing UI)
            const apiResult = await postTweetViaXApi(tweet.content);
            let posted = false;
            let realTweetId = null;

            if (apiResult && apiResult.success && apiResult.tweet_id && /^\d+$/.test(apiResult.tweet_id)) {
                posted = true;
                realTweetId = apiResult.tweet_id;
                tweet.tweet_id = realTweetId;
                addLogEntry({
                    type: 'schedule',
                    text: `Scheduled tweet posted live via X.com API: "${truncate(tweet.content, 60)}"`,
                    tweetId: realTweetId
                });
            } else {
                console.warn('[Tweeker] Direct API tweet post failed or returned no numeric ID. Triggering UI composer fallback...');
                // 2. Fallback to UI composer automation if direct API post failed
                const uiResult = await postTweetToX(tweet.content);
                posted = !!(uiResult && uiResult.success);

                if (uiResult && uiResult.tweet_id && /^\d+$/.test(uiResult.tweet_id)) {
                    realTweetId = uiResult.tweet_id;
                    tweet.tweet_id = realTweetId;
                }

                addLogEntry({
                    type: 'schedule',
                    text: `Scheduled tweet ${posted ? 'posted live to X.com (UI fallback)' : 'triggered'}: "${truncate(tweet.content, 60)}"`,
                    tweetId: realTweetId || tweet.id
                });
            }

            // Show Toast Notification
            showScheduledTweetToast(tweet, posted);
        }
    }

    if (updated) {
        renderScheduledTweets(state.scheduledTweets);
        try { localStorage.setItem('tweeker_scheduled_tweets', JSON.stringify(state.scheduledTweets)); } catch (e) {}
    }
}

function showScheduledTweetToast(tweet, posted) {
    let container = document.getElementById('tweeker-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tweeker-toast-container';
        const overlay = document.getElementById('tweeker-overlay-container') || document.body;
        overlay.appendChild(container);
    }

    const subText = posted 
        ? 'Posted live to X.com!' 
        : 'Copied to clipboard (ready to post)';

    const toast = document.createElement('div');
    toast.className = 'tweeker-alarm-toast';
    toast.innerHTML = `
        <div class="alarm-toast-title" style="color: #10b981;">🚀 Scheduled Tweet ${posted ? 'Posted!' : 'Triggered!'}</div>
        <div class="alarm-toast-text">${escapeHtml(truncate(tweet.content, 90))}</div>
        <div class="alarm-toast-sub" style="font-size: 11px; color: var(--tw-text-muted); margin-top: 4px;">${subText}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 6000);
}

// Listen for messages from injected bridge.js
window.addEventListener('message', (event) => {
    if (!event.data || event.data.__tweeker !== true) return;

    const { type, payload } = event.data;

    if (type === 'heartbeat' || type === 'tweet_data') {
        state.connectionStatus.x_webview_loaded = true;
        state.connectionStatus.interceptor_active = true;
        state.connectionStatus.last_heartbeat = new Date();
        renderConnectionStatus(state.connectionStatus);

        // Sync debug setting on heartbeat
        if (type === 'heartbeat') {
            try {
                window.postMessage({
                    __tweeker: true,
                    type: 'set_debug_twitter',
                    enabled: state.debugTwitter
                }, '*');
            } catch (e) {}
        }
    }

    if (type === 'log' && payload && payload.text) {
        addLogEntry({
            type: payload.type || 'system',
            text: `[Interceptor] ${payload.text}`
        });
    }

    if (type === 'debug_log' && payload && payload.text) {
        addDebugLogEntry(`[Interceptor] ${payload.text}`);
    }

    if (type === 'tweet_data' && payload && payload.tweets) {
        processIncomingTweets(payload.tweets);
        invoke('save_tweets', { tweets: payload.tweets }).catch(() => {});
    }

    if (type === 'add_users' && payload && payload.users) {
        if (!window._tweeker_user_cache) window._tweeker_user_cache = {};
        Object.assign(window._tweeker_user_cache, payload.users);
        try { localStorage.setItem('tweeker_user_cache', JSON.stringify(window._tweeker_user_cache)); } catch(e) {}
        invoke('add_multiple_to_user_cache', { users: payload.users }).catch((e) => {
            console.error('[Tweeker App] Failed to add users to cache:', e);
        });
    }

    if (type === 'get_user_counts' && payload && payload.handle) {
        const handle = payload.handle;
        invoke('get_cached_user', { handle }).then((counts) => {
            window.postMessage({
                __tweeker: true,
                type: 'user_counts_response',
                payload: { handle, counts }
            }, '*');
        }).catch((e) => {
            console.error('[Tweeker App] Failed to get user counts:', e);
        });
    }
});

// ── Tauri Event Listeners ──

// Listen for stats update events from the Rust backend
listen('stats-updated', (event) => {
    if (state.activeTab === 'stats' && state.panelOpen) {
        refreshStats();
    }
});

// Listen for scheduler ticks (for future use)
listen('scheduler-tick', (event) => {
    // Will be used to trigger scheduled tweet sending
});

// ── Initialization ──

async function init() {
    // Set app version
    try {
        const version = await invoke('get_app_version');
        dom.appVersion.textContent = `v${version}`;
        dom.settingsVersion.textContent = `v${version}`;
    } catch (e) {
        dom.appVersion.textContent = '';
    }

    // Set default datetime to 1 hour from current local time
    const defaultNext = new Date();
    defaultNext.setHours(defaultNext.getHours() + 1);
    dom.scheduleDatetime.value = getLocalDatetimeInputValue(defaultNext);

    // Restore Auto read startup setting
    const autoReadStartup = localStorage.getItem('tweeker_autoread_on_start') === 'true';
    state.autoReadOnStart = autoReadStartup;
    if (dom.autoReadStartupToggle) {
        dom.autoReadStartupToggle.checked = autoReadStartup;
    }

    // Set initial Auto read state
    setAutoReadState(autoReadStartup);

    // Restore saved max log lines setting
    const savedMaxLogs = parseInt(localStorage.getItem('tweeker_max_log_lines'), 10);
    if (!isNaN(savedMaxLogs) && savedMaxLogs >= 10) {
        state.maxLogLines = savedMaxLogs;
    }
    if (dom.maxLogLinesInput) {
        dom.maxLogLinesInput.value = state.maxLogLines;
    }

    // Restore saved user cache limit setting
    const savedCacheLimit = parseInt(localStorage.getItem('tweeker_user_cache_limit'), 10);
    const cacheLimit = (!isNaN(savedCacheLimit) && savedCacheLimit >= 10) ? savedCacheLimit : 10000;
    try {
        await invoke('set_user_cache_limit', { limit: cacheLimit });
    } catch (e) {
        console.error('[Tweeker App] Failed to set user cache limit in backend:', e);
    }
    if (dom.userCacheLimitInput) {
        dom.userCacheLimitInput.value = cacheLimit;
    }

    // Restore saved relevant followers limit setting
    const savedRelevantLimit = parseInt(localStorage.getItem('tweeker_relevant_followers_limit'), 10);
    const relevantLimit = (!isNaN(savedRelevantLimit) && savedRelevantLimit >= 0) ? savedRelevantLimit : 2500;
    if (dom.relevantFollowersLimitInput) {
        dom.relevantFollowersLimitInput.value = relevantLimit;
    }

    // Restore saved relevant highlight color setting
    const savedHighlightColor = localStorage.getItem('tweeker_relevant_highlight_color') || '#00ba7c';
    if (dom.relevantHighlightColorInput) {
        dom.relevantHighlightColorInput.value = savedHighlightColor;
    }

    window.postMessage({
        __tweeker: true,
        type: 'set_relevant_followers_limit',
        limit: relevantLimit,
        color: savedHighlightColor
    }, '*');

    // Restore list page filter & highlight settings
    const listMinFollowers = parseInt(localStorage.getItem('tweeker_list_min_followers'), 10);
    state.listMinFollowers = (!isNaN(listMinFollowers) && listMinFollowers >= 0) ? listMinFollowers : 0;
    if (dom.listMinFollowersInput) dom.listMinFollowersInput.value = state.listMinFollowers;

    const listMinRatio = parseFloat(localStorage.getItem('tweeker_list_min_ratio'));
    state.listMinRatio = (!isNaN(listMinRatio) && listMinRatio >= 0.0) ? listMinRatio : 0.0;
    if (dom.listMinRatioInput) dom.listMinRatioInput.value = state.listMinRatio.toFixed(1);

    const listHighlightVerified = localStorage.getItem('tweeker_list_highlight_verified') === 'true';
    state.listHighlightVerified = listHighlightVerified;
    if (dom.listHighlightVerifiedToggle) dom.listHighlightVerifiedToggle.checked = listHighlightVerified;

    const listVerifiedColor = localStorage.getItem('tweeker_list_verified_color') || '#1d9bf0';
    state.listVerifiedColor = listVerifiedColor;
    if (dom.listVerifiedColorInput) dom.listVerifiedColorInput.value = listVerifiedColor;

    const listHighlightMega = localStorage.getItem('tweeker_list_highlight_mega') === 'true';
    state.listHighlightMega = listHighlightMega;
    if (dom.listHighlightMegaToggle) dom.listHighlightMegaToggle.checked = listHighlightMega;

    const listMegaColor = localStorage.getItem('tweeker_list_mega_color') || '#a855f7';
    state.listMegaColor = listMegaColor;
    if (dom.listMegaColorInput) dom.listMegaColorInput.value = listMegaColor;

    syncListFilterSettings();

    // Restore saved log entries
    try {
        const savedLogs = localStorage.getItem('tweeker_logs');
        if (savedLogs) {
            state.logs = JSON.parse(savedLogs);
            pruneLogs();
        }
    } catch (e) {}

    // Restore saved Debug Twitter setting
    const debugTwitterStartup = localStorage.getItem('tweeker_debug_twitter') === 'true';
    state.debugTwitter = debugTwitterStartup;
    if (dom.debugTwitterToggle) {
        dom.debugTwitterToggle.checked = debugTwitterStartup;
    }
    setDebugTwitterState(debugTwitterStartup);

    // Restore saved max debug log lines setting
    const savedMaxDebugLines = parseInt(localStorage.getItem('tweeker_max_debug_lines'), 10);
    if (!isNaN(savedMaxDebugLines) && savedMaxDebugLines >= 10) {
        state.maxDebugLines = savedMaxDebugLines;
    }
    if (dom.maxDebugLinesInput) {
        dom.maxDebugLinesInput.value = state.maxDebugLines;
    }

    // Restore saved debug logs
    try {
        const savedDebugLogs = localStorage.getItem('tweeker_debug_logs');
        if (savedDebugLogs) {
            state.debugLogs = JSON.parse(savedDebugLogs);
            pruneDebugLogs();
        }
    } catch (e) {}

    // Restore saved alarms and scheduled tweets
    try {
        const savedAlarms = localStorage.getItem('tweeker_alarms');
        if (savedAlarms) state.alarms = JSON.parse(savedAlarms);
    } catch (e) {}

    try {
        const savedSched = localStorage.getItem('tweeker_scheduled_tweets');
        if (savedSched) state.scheduledTweets = JSON.parse(savedSched);
    } catch (e) {}

    renderAlarms(state.alarms || []);
    renderScheduledTweets(state.scheduledTweets || []);
    refreshLogsView();

    // Initial data load
    await refreshConnectionStatus();
    await refreshAlarms();
    await refreshScheduledTweets();

    // Restore overlay panel open/closed state from previous session
    const savedPanelOpen = localStorage.getItem('tweeker_panel_open');
    if (savedPanelOpen === 'true') {
        togglePanel(true);
    }

    // Bulk-load persisted user cache from backend into JS webview cache
    try {
        const cachedUsers = await invoke('get_all_cached_users');
        if (cachedUsers && typeof cachedUsers === 'object') {
            const count = Object.keys(cachedUsers).length;
            if (count > 0) {
                // Push all cached users to the interceptor's JS cache
                window.postMessage({
                    __tweeker: true,
                    type: 'bulk_user_cache',
                    payload: { users: cachedUsers }
                }, '*');
                console.log(`[Tweeker] Loaded ${count} users from persistent cache into webview`);
            }
        }
    } catch (e) {
        console.debug('[Tweeker] Failed to load persisted user cache:', e);
    }

    // Log session startup
    addLogEntry({
        type: 'system',
        text: `Tweeker control panel session initialized`
    });

    // Fetch and emit database statistics
    await emitDbStatsLog();

    // Start 5-second monitor loop for scheduled tweets
    setInterval(checkScheduledTweets, 5000);
    checkScheduledTweets();

    console.log('[Tweeker] Control panel initialized');
}

async function fetchDbStats() {
    let stats = null;
    try {
        stats = await invoke('get_db_stats');
    } catch (e) {}

    if (!stats || typeof stats !== 'object') {
        if (window.__TWEEKER_DB_STATS__ && typeof window.__TWEEKER_DB_STATS__ === 'object') {
            stats = window.__TWEEKER_DB_STATS__;
        }
    }

    const dbPathStr = (stats && stats.db_path)
        ? stats.db_path
        : (window.__TWEEKER_DB_PATH__ || '—');

    const usersCount = (stats && typeof stats.cached_users_count === 'number' && stats.cached_users_count > 0)
        ? stats.cached_users_count
        : ((window._tweeker_user_cache ? Object.keys(window._tweeker_user_cache).length : 0) || (window._tweeker_author_map ? window._tweeker_author_map.size : 0));

    const tweetsCount = (stats && typeof stats.total_tweets === 'number' && stats.total_tweets > 0)
        ? stats.total_tweets
        : ((state.stats ? state.stats.total_tweets_seen : 0) || (window._tweeker_seen_tweets ? window._tweeker_seen_tweets.size : 0));

    const alarmsCount = (stats && typeof stats.total_alarms === 'number' && stats.total_alarms > 0)
        ? stats.total_alarms
        : (Array.isArray(state.alarms) ? state.alarms.length : 0);

    const scheduledCount = (stats && typeof stats.total_scheduled_tweets === 'number' && stats.total_scheduled_tweets > 0)
        ? stats.total_scheduled_tweets
        : (Array.isArray(state.scheduledTweets) ? state.scheduledTweets.length : 0);

    let storageBytes = (stats && typeof stats.db_size_bytes === 'number') ? stats.db_size_bytes : 0;
    if (!storageBytes) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('tweeker_')) {
                    const val = localStorage.getItem(key) || '';
                    storageBytes += (key.length + val.length) * 2;
                }
            }
        } catch (e) {}
    }

    return {
        cached_users_count: usersCount,
        total_tweets: tweetsCount,
        total_alarms: alarmsCount,
        total_scheduled_tweets: scheduledCount,
        db_size_bytes: storageBytes,
        db_path: dbPathStr
    };
}

async function emitDbStatsLog() {
    try {
        const stats = await fetchDbStats();
        if (dom.settingsDbPath && stats.db_path) {
            dom.settingsDbPath.value = stats.db_path;
        }

        const sizeBytes = stats.db_size_bytes || 0;
        let formattedSize = '0 B';
        if (sizeBytes >= 1048576) {
            formattedSize = (sizeBytes / 1048576).toFixed(1) + ' MB';
        } else if (sizeBytes >= 1024) {
            formattedSize = (sizeBytes / 1024).toFixed(1) + ' KB';
        } else {
            formattedSize = sizeBytes + ' B';
        }

        addLogEntry({
            type: 'system',
            text: `Database statistics: ${stats.cached_users_count || 0} users cached, ${stats.total_tweets || 0} tweets stored, ${stats.total_alarms || 0} alarms, ${stats.total_scheduled_tweets || 0} scheduled tweets (DB size: ${formattedSize})`
        });
    } catch (e) {
        console.debug('[Tweeker] Failed to emit database statistics:', e);
    }
}

init();
