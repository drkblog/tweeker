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
    logFilters: {
        INFO: true,
        WARN: true,
        ERROR: true,
        DEBUG: false,
    },
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
    decoupleMode: false,
    maxConcurrentDownloads: 2,
    activeDownloadsCount: 0,
    downloadQueue: [],
    contextMenuEnabled: true,
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
    decoupleIndicator: document.getElementById('decouple-indicator'),
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
        manager: document.getElementById('content-manager'),
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
    logProgressBarFill: document.getElementById('log-progress-bar-fill'),
    logFilterInfo: document.getElementById('log-filter-info'),
    logFilterWarn: document.getElementById('log-filter-warn'),
    logFilterError: document.getElementById('log-filter-error'),
    logFilterDebug: document.getElementById('log-filter-debug'),

    // Debug
    debugTab: document.getElementById('tab-debug'),
    debugCountText: document.getElementById('debug-count-text'),
    clearDebugBtn: document.getElementById('clear-debug-btn'),
    debugOutputContainer: document.getElementById('debug-output-container'),
    debugProgressBarFill: document.getElementById('debug-progress-bar-fill'),
    debugTwitterToggle: document.getElementById('debug-twitter-toggle'),
    maxDebugLinesInput: document.getElementById('max-debug-lines-input'),

    // Settings
    maxLogLinesInput: document.getElementById('max-log-lines-input'),
    userCacheLimitInput: document.getElementById('user-cache-limit-input'),
    relevantFollowersLimitInput: document.getElementById('relevant-followers-limit-input'),
    relevantHighlightColorInput: document.getElementById('relevant-highlight-color-input'),
    recentDurationInput: document.getElementById('recent-duration-input'),
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

    // Manager
    managerTab: document.getElementById('tab-manager'),
    cleanCacheBtn: document.getElementById('clean-cache-btn'),
    deleteSiteDataBtn: document.getElementById('delete-site-data-btn'),
    exportBackupBtn: document.getElementById('export-backup-btn'),
    importBackupBtn: document.getElementById('import-backup-btn'),
    purgeStorageBtn: document.getElementById('purge-storage-btn'),
    resetSettingsBtn: document.getElementById('reset-settings-btn'),
    factoryResetBtn: document.getElementById('factory-reset-btn'),
    downloadDiagnosticsBtn: document.getElementById('download-diagnostics-btn'),

    // Modal
    modalOverlay: document.getElementById('tweeker-modal-overlay'),
    modalTitle: document.getElementById('tweeker-modal-title'),
    modalBody: document.getElementById('tweeker-modal-body'),
    modalActions: document.getElementById('tweeker-modal-actions'),
    modalCancel: document.getElementById('tweeker-modal-cancel'),
    modalConfirm: document.getElementById('tweeker-modal-confirm'),
    modalProgressContainer: document.getElementById('tweeker-modal-progress-container'),
    modalProgressStatus: document.getElementById('tweeker-modal-progress-status'),
    modalProgressPercent: document.getElementById('tweeker-modal-progress-percent'),
    modalProgressFill: document.getElementById('tweeker-modal-progress-fill'),

    // Advanced settings
    advancedSettingsBtn: document.getElementById('advanced-settings-btn'),
    advancedModalOverlay: document.getElementById('tweeker-advanced-modal-overlay'),
    advancedSearchInput: document.getElementById('tweeker-advanced-search-input'),
    advancedListContainer: document.getElementById('tweeker-advanced-list-container'),
    advancedModalClose: document.getElementById('tweeker-advanced-modal-close'),
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
    if (tabName === 'manager') refreshManagerView();
    if (tabName === 'debug') refreshDebugView();
}

async function refreshManagerView() {
    try {
        await emitDbStatsLog();
    } catch (e) {}
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
    const host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
    const isXDomain = host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');

    if (!isXDomain) {
        dom.statusDot.className = 'status-dot connected';
        dom.statusDot.style.background = '#64748b';
        dom.statusText.textContent = 'External site';
        if (dom.decoupleIndicator) dom.decoupleIndicator.style.display = 'none';
        return;
    }

    if (state.decoupleMode) {
        dom.statusDot.className = 'status-dot';
        dom.statusDot.style.background = '#ff9800';
        dom.statusText.textContent = 'Decoupled';
        if (dom.decoupleIndicator) dom.decoupleIndicator.style.display = 'inline-block';
        return;
    }
    dom.statusDot.style.background = '';
    if (dom.decoupleIndicator) dom.decoupleIndicator.style.display = 'none';

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

function updateLogCountText(visibleCount) {
    if (dom.logCountText) {
        const count = visibleCount !== undefined ? visibleCount : (state.logs ? state.logs.length : 0);
        dom.logCountText.textContent = `${count} / ${state.maxLogLines} lines`;
    }
    if (dom.logProgressBarFill) {
        const totalInMemory = state.logs ? state.logs.length : 0;
        const pct = Math.min(100, Math.max(0, Math.round((totalInMemory / state.maxLogLines) * 100)));
        dom.logProgressBarFill.style.width = `${pct}%`;
    }
}

function pruneLogs() {
    if (!Array.isArray(state.logs)) state.logs = [];
    if (state.logs.length > state.maxLogLines) {
        state.logs = state.logs.slice(-state.maxLogLines);
    }
}

function getLogLevel(item) {
    if (!item) return 'DEBUG';
    if (item.level) {
        const lvl = String(item.level).toUpperCase();
        if (['INFO', 'WARN', 'ERROR', 'DEBUG'].includes(lvl)) return lvl;
    }
    const type = (item.type || '').toLowerCase();
    const text = (item.text || '').toLowerCase();

    if (type === 'system' || type === 'debug' || text.startsWith('[debug]') || text.includes('debug_log') || text.startsWith('[interceptor]') || text.startsWith('[notifstats]')) {
        return 'DEBUG';
    }
    if (type === 'error' || type === 'fail' || text.includes('error') || text.includes('failed') || text.includes('exception')) {
        return 'ERROR';
    }
    if (type === 'warn' || type === 'warning' || text.includes('warn') || text.includes('warning')) {
        return 'WARN';
    }
    return 'DEBUG';
}

function addLogEntry(entry) {
    if (!entry) return;

    const rawType = entry.type || 'debug';
    const type = rawType === 'system' ? 'debug' : rawType;
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
        level: entry.level || getLogLevel(entry),
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

    const level = getLogLevel(item);
    if (!state.logFilters[level]) {
        return;
    }

    // Remove empty state if present
    const emptyState = dom.logOutputContainer.querySelector('.log-empty-state');
    if (emptyState) emptyState.remove();

    const entryDiv = document.createElement('div');
    const type = (item.type || 'system').toLowerCase();
    entryDiv.className = `log-entry log-entry-${type} log-level-${level.toLowerCase()}`;
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
    const rawType = (item.type || 'debug').toLowerCase();
    const type = rawType === 'system' ? 'debug' : rawType;
    const tagLabel = (type === 'system' || type === 'debug') ? 'DEBUG' : type.toUpperCase();
    
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

    const filteredLogs = (state.logs || []).filter(item => {
        const level = getLogLevel(item);
        return !!state.logFilters[level];
    });

    updateLogCountText(filteredLogs.length);

    if (filteredLogs.length === 0) {
        dom.logOutputContainer.innerHTML = '<p class="empty-state log-empty-state">No logs match selected log levels.</p>';
        return;
    }

    dom.logOutputContainer.innerHTML = filteredLogs.map(item => {
        const level = getLogLevel(item);
        const type = (item.type || 'system').toLowerCase();
        return `
            <div class="log-entry log-entry-${type} log-level-${level.toLowerCase()}" data-log-id="${item.id}">
                ${getLogItemInnerHtml(item)}
            </div>
        `;
    }).join('');

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
    if (dom.debugProgressBarFill) {
        const totalInMemory = state.debugLogs ? state.debugLogs.length : 0;
        const pct = Math.min(100, Math.max(0, Math.round((totalInMemory / state.maxDebugLines) * 100)));
        dom.debugProgressBarFill.style.width = `${pct}%`;
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

    // Handle relative path (e.g. /home or /notifications)
    if (input.startsWith('/')) {
        targetUrl = 'https://x.com' + input;
    } else if (input.startsWith('@')) {
        targetUrl = 'https://x.com/' + input.substring(1);
    } else if (/^https?:\/\//i.test(input)) {
        targetUrl = input;
    } else if (input.includes('.')) {
        // Any domain or URL containing a dot (e.g. github.com, google.com, news.ycombinator.com)
        targetUrl = 'https://' + input;
    } else {
        // Fallback for raw X.com username or path (e.g. elonmusk)
        targetUrl = 'https://x.com/' + input;
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

// Recent duration setting input
if (dom.recentDurationInput) {
    dom.recentDurationInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 3;
        try { localStorage.setItem('tweeker_recent_duration', val.toString()); } catch (err) {}
        window.postMessage({
            __tweeker: true,
            type: 'set_recent_settings',
            duration: val
        }, '*');
        addLogEntry({
            type: 'system',
            text: `Recent tweet threshold updated to ${val} minutes`
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
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Database statistics dump triggered'
        });
        await emitDbStatsLog();
        showToastMessage('Database statistics dumped to log!');
    });
}

// ── Confirmation Modal Helper ──
function showConfirmationModal({ title, body, confirmText, onConfirm }) {
    if (!dom.modalOverlay) return;
    if (dom.modalTitle) dom.modalTitle.textContent = title || 'Confirmation Required';
    if (dom.modalBody) dom.modalBody.textContent = body || 'Are you sure you want to proceed?';
    if (dom.modalConfirm) dom.modalConfirm.textContent = confirmText || 'Confirm';

    // Reset progress UI & display action buttons
    if (dom.modalActions) dom.modalActions.style.display = 'flex';
    if (dom.modalProgressContainer) dom.modalProgressContainer.style.display = 'none';
    if (dom.modalProgressFill) dom.modalProgressFill.style.width = '0%';
    if (dom.modalProgressPercent) dom.modalProgressPercent.textContent = '0%';
    if (dom.modalProgressStatus) dom.modalProgressStatus.textContent = 'Initializing...';

    dom.modalOverlay.style.display = 'flex';
    dom.modalOverlay.classList.add('open');

    const cleanup = () => {
        dom.modalOverlay.classList.remove('open');
        dom.modalOverlay.style.display = 'none';
        if (dom.modalCancel) dom.modalCancel.onclick = null;
        if (dom.modalConfirm) dom.modalConfirm.onclick = null;
    };

    const updateProgress = (percent, statusText) => {
        const clamped = Math.min(100, Math.max(0, percent));
        if (dom.modalProgressFill) dom.modalProgressFill.style.width = `${clamped}%`;
        if (dom.modalProgressPercent) dom.modalProgressPercent.textContent = `${clamped}%`;
        if (dom.modalProgressStatus && statusText) dom.modalProgressStatus.textContent = statusText;
    };

    const handleCancel = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        cleanup();
    };

    const handleConfirm = async (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (dom.modalActions) dom.modalActions.style.display = 'none';
        if (dom.modalProgressContainer) dom.modalProgressContainer.style.display = 'block';

        if (typeof onConfirm === 'function') {
            await onConfirm(updateProgress);
        }
        cleanup();
    };

    if (dom.modalCancel) dom.modalCancel.onclick = handleCancel;
    if (dom.modalConfirm) dom.modalConfirm.onclick = handleConfirm;
}

// ── Information Modal Helper ──
function showInfoModal({ title, body, okText }) {
    if (!dom.modalOverlay) return;
    if (dom.modalTitle) dom.modalTitle.textContent = title || 'Information';
    if (dom.modalBody) dom.modalBody.textContent = body || '';
    if (dom.modalConfirm) dom.modalConfirm.textContent = okText || 'OK';
    if (dom.modalCancel) dom.modalCancel.style.display = 'none';

    // Show actions, hide progress
    if (dom.modalActions) dom.modalActions.style.display = 'flex';
    if (dom.modalProgressContainer) dom.modalProgressContainer.style.display = 'none';

    dom.modalOverlay.style.display = 'flex';
    dom.modalOverlay.classList.add('open');

    const cleanup = () => {
        dom.modalOverlay.classList.remove('open');
        dom.modalOverlay.style.display = 'none';
        if (dom.modalCancel) {
            dom.modalCancel.onclick = null;
            dom.modalCancel.style.display = 'inline-block';
        }
        if (dom.modalConfirm) dom.modalConfirm.onclick = null;
    };

    if (dom.modalConfirm) dom.modalConfirm.onclick = cleanup;
    if (dom.modalCancel) dom.modalCancel.onclick = cleanup;
}


// ── Manager Action Listeners ──

// Clean browser cache button handler
if (dom.cleanCacheBtn) {
    dom.cleanCacheBtn.addEventListener('click', async () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Clean Cache action triggered'
        });
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    await caches.delete(key);
                }
            }
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const reg of registrations) {
                    await reg.unregister();
                }
            }
            await invoke('clear_browser_cache');
            addLogEntry({
                type: 'info',
                level: 'INFO',
                text: 'Manager: Browser cache cleaned successfully'
            });
            showToastMessage('Browser cache cleaned!');
        } catch (err) {
            console.error('[Tweeker] Failed to clean cache:', err);
            addLogEntry({
                type: 'error',
                level: 'ERROR',
                text: `Manager: Failed to clean browser cache: ${err}`
            });
        }
    });
}

// Delete site data button handler (with confirmation warning & progress bar)
if (dom.deleteSiteDataBtn) {
    dom.deleteSiteDataBtn.addEventListener('click', () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Delete Site Data action triggered — awaiting confirmation'
        });
        showConfirmationModal({
            title: 'Delete Site Data?',
            body: 'This action will erase local storage, session storage, and stored web data for all sites. You will be logged out of X.com. Are you sure you want to proceed?',
            confirmText: 'Delete Site Data',
            onConfirm: async (updateProgress) => {
                try {
                    updateProgress(15, 'Clearing LocalStorage & SessionStorage...');
                    await new Promise(r => setTimeout(r, 300));
                    try { localStorage.clear(); } catch (e) {}
                    try { sessionStorage.clear(); } catch (e) {}

                    updateProgress(45, 'Erasing IndexedDB databases...');
                    await new Promise(r => setTimeout(r, 350));
                    if (window.indexedDB && window.indexedDB.databases) {
                        try {
                            const dbs = await window.indexedDB.databases();
                            for (const db of dbs) {
                                if (db.name) window.indexedDB.deleteDatabase(db.name);
                            }
                        } catch (e) {}
                    }

                    updateProgress(75, 'Unregistering Web Cache & Service Workers...');
                    await new Promise(r => setTimeout(r, 350));
                    try {
                        if ('caches' in window) {
                            const keys = await caches.keys();
                            for (const key of keys) await caches.delete(key);
                        }
                        if ('serviceWorker' in navigator) {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            for (const reg of regs) await reg.unregister();
                        }
                    } catch (e) {}

                    updateProgress(90, 'Wiping backend site data...');
                    await new Promise(r => setTimeout(r, 300));
                    await invoke('clear_site_data');

                    updateProgress(100, 'Site data erased! Reloading application...');
                    addLogEntry({
                        type: 'info',
                        level: 'INFO',
                        text: 'Manager: Site data (localStorage, sessionStorage, IndexedDB) erased successfully'
                    });
                    showToastMessage('Site data erased. Reloading page...');
                    await new Promise(r => setTimeout(r, 800));
                    window.location.reload();
                } catch (err) {
                    console.error('[Tweeker] Failed to delete site data:', err);
                    addLogEntry({
                        type: 'error',
                        level: 'ERROR',
                        text: `Manager: Failed to delete site data: ${err}`
                    });
                }
            }
        });
    });
}

// ── G4: Reset Application Settings to Defaults ──

const SETTINGS_DEFAULTS = {
    tweeker_max_log_lines: 2000,
    tweeker_user_cache_limit: 10000,
    tweeker_relevant_followers_limit: 2500,
    tweeker_relevant_highlight_color: '#00ba7c',
    tweeker_recent_duration: 3,
    tweeker_list_min_followers: 0,
    tweeker_list_min_ratio: 0.0,
    tweeker_list_highlight_verified: false,
    tweeker_list_verified_color: '#1d9bf0',
    tweeker_list_highlight_mega: false,
    tweeker_list_mega_color: '#a855f7',
    tweeker_autoread_on_start: false,
    tweeker_debug_twitter: false,
    tweeker_max_debug_lines: 2000,
    tweeker_log_filters: { INFO: true, WARN: true, ERROR: true, DEBUG: false },
    'notifications.statistics.background-color': '#43474d',
    'notifications.statistics.likes-color': '#f91880',
    'notifications.statistics.retweets-color': '#00ba7c',
    'notifications.statistics.replies-color': '#1d9bf0',
    'notifications.statistics.views-color': '#71767b',
    tweeker_max_concurrent_downloads: 2,
    'browser.context_menu.enabled': true,
    'tweeker.dialogs.cache': true,
    'tweeker.dialogs.gemini.erase_previous_chat': false,
};

const SETTINGS_DESCRIPTIONS = {
    tweeker_max_log_lines: 'Maximum number of log lines to keep in the Logs console.',
    tweeker_user_cache_limit: 'Maximum number of user profile stats to cache.',
    tweeker_relevant_followers_limit: 'Follower threshold above which users are marked as Relevant.',
    tweeker_relevant_highlight_color: 'Custom hex color for highlighting relevant user avatars.',
    tweeker_recent_duration: 'Time threshold in minutes to highlight fresh timeline tweets.',
    tweeker_list_min_followers: 'Hide users in X Lists with fewer followers than this.',
    tweeker_list_min_ratio: 'Dim users in X Lists with an F/F ratio below this.',
    tweeker_list_highlight_verified: 'Enable/disable custom border highlights around verified list cards.',
    tweeker_list_verified_color: 'Custom hex border color for highlighted verified list cards.',
    tweeker_list_highlight_mega: 'Enable/disable custom border highlights around mega-influencer list cards.',
    tweeker_list_mega_color: 'Custom hex border color for highlighted mega-influencer list cards.',
    tweeker_autoread_on_start: 'Automatically activate timeline Auto read toggle on startup.',
    tweeker_debug_twitter: 'Enable verbose developer logs from intercepted browser calls.',
    tweeker_max_debug_lines: 'Maximum number of debug console log lines.',
    'notifications.statistics.background-color': 'Hex background color for tweet stats bar in notifications screen.',
    'notifications.statistics.likes-color': 'Hex color for the Likes icon and count in notification stats.',
    'notifications.statistics.retweets-color': 'Hex color for the Retweets icon and count in notification stats.',
    'notifications.statistics.replies-color': 'Hex color for the Replies icon and count in notification stats.',
    'notifications.statistics.views-color': 'Hex color for the Views icon and count in notification stats.',
    tweeker_max_concurrent_downloads: 'Maximum number of concurrent video downloads allowed to run in parallel.',
    'browser.context_menu.enabled': 'Globally enable or disable custom context menu overrides.',
    'tweeker.dialogs.cache': 'Cache extra dialogs in background instead of destroying on close for near-instant reactivation.',
    'tweeker.dialogs.gemini.erase_previous_chat': 'Start a new Gemini chat and delete the previous chat thread when the helper is opened.',
};

function applySettingsDefaults() {
    // Max log lines
    state.maxLogLines = SETTINGS_DEFAULTS.tweeker_max_log_lines;
    try { localStorage.setItem('tweeker_max_log_lines', state.maxLogLines.toString()); } catch (e) {}
    if (dom.maxLogLinesInput) dom.maxLogLinesInput.value = state.maxLogLines;
    pruneLogs();

    // User cache limit
    const cacheLimit = SETTINGS_DEFAULTS.tweeker_user_cache_limit;
    try { localStorage.setItem('tweeker_user_cache_limit', cacheLimit.toString()); } catch (e) {}
    if (dom.userCacheLimitInput) dom.userCacheLimitInput.value = cacheLimit;
    invoke('set_user_cache_limit', { limit: cacheLimit }).catch(() => {});

    // Relevant followers limit & color
    const relevantLimit = SETTINGS_DEFAULTS.tweeker_relevant_followers_limit;
    const highlightColor = SETTINGS_DEFAULTS.tweeker_relevant_highlight_color;
    try { localStorage.setItem('tweeker_relevant_followers_limit', relevantLimit.toString()); } catch (e) {}
    try { localStorage.setItem('tweeker_relevant_highlight_color', highlightColor); } catch (e) {}
    if (dom.relevantFollowersLimitInput) dom.relevantFollowersLimitInput.value = relevantLimit;
    if (dom.relevantHighlightColorInput) dom.relevantHighlightColorInput.value = highlightColor;
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_relevant_followers_limit',
            limit: relevantLimit,
            color: highlightColor
        }, '*');
    } catch (e) {}

    // Recent tweet threshold
    const recentDuration = SETTINGS_DEFAULTS.tweeker_recent_duration;
    try { localStorage.setItem('tweeker_recent_duration', recentDuration.toString()); } catch (e) {}
    if (dom.recentDurationInput) dom.recentDurationInput.value = recentDuration;
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_recent_settings',
            duration: recentDuration
        }, '*');
    } catch (e) {}

    // Custom notifications statistics colors defaults reset
    const notifBg = SETTINGS_DEFAULTS['notifications.statistics.background-color'];
    const notifLikes = SETTINGS_DEFAULTS['notifications.statistics.likes-color'];
    const notifRetweets = SETTINGS_DEFAULTS['notifications.statistics.retweets-color'];
    const notifReplies = SETTINGS_DEFAULTS['notifications.statistics.replies-color'];
    const notifViews = SETTINGS_DEFAULTS['notifications.statistics.views-color'];

    try {
        localStorage.setItem('notifications.statistics.background-color', notifBg);
        localStorage.setItem('notifications.statistics.likes-color', notifLikes);
        localStorage.setItem('notifications.statistics.retweets-color', notifRetweets);
        localStorage.setItem('notifications.statistics.replies-color', notifReplies);
        localStorage.setItem('notifications.statistics.views-color', notifViews);
    } catch (e) {}

    const maxConcurrent = SETTINGS_DEFAULTS.tweeker_max_concurrent_downloads;
    state.maxConcurrentDownloads = maxConcurrent;
    try { localStorage.setItem('tweeker_max_concurrent_downloads', maxConcurrent.toString()); } catch (e) {}

    state.contextMenuEnabled = true;
    try { localStorage.setItem('browser.context_menu.enabled', 'true'); } catch (e) {}
    try { localStorage.setItem('tweeker.dialogs.cache', 'true'); } catch (e) {}
    try { localStorage.setItem('tweeker.dialogs.gemini.erase_previous_chat', 'false'); } catch (e) {}
    try {
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            window.__TAURI__.core.invoke('set_dialogs_cache_enabled', { enabled: true });
            window.__TAURI__.core.invoke('set_gemini_erase_chat', { enabled: false });
        } else if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
            window.__TAURI__.invoke('set_dialogs_cache_enabled', { enabled: true });
            window.__TAURI__.invoke('set_gemini_erase_chat', { enabled: false });
        }
    } catch (e) {}
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_context_menu_enabled',
            enabled: true
        }, '*');
    } catch (e) {}

    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_notif_stats_colors',
            colors: { bg: notifBg, likes: notifLikes, retweets: notifRetweets, replies: notifReplies, views: notifViews }
        }, '*');
    } catch (e) {}

    // List filter: min followers
    state.listMinFollowers = SETTINGS_DEFAULTS.tweeker_list_min_followers;
    try { localStorage.setItem('tweeker_list_min_followers', state.listMinFollowers.toString()); } catch (e) {}
    if (dom.listMinFollowersInput) dom.listMinFollowersInput.value = state.listMinFollowers;

    // List filter: min ratio
    state.listMinRatio = SETTINGS_DEFAULTS.tweeker_list_min_ratio;
    try { localStorage.setItem('tweeker_list_min_ratio', state.listMinRatio.toString()); } catch (e) {}
    if (dom.listMinRatioInput) dom.listMinRatioInput.value = state.listMinRatio.toFixed(1);

    // List highlight: verified
    state.listHighlightVerified = SETTINGS_DEFAULTS.tweeker_list_highlight_verified;
    try { localStorage.setItem('tweeker_list_highlight_verified', state.listHighlightVerified ? 'true' : 'false'); } catch (e) {}
    if (dom.listHighlightVerifiedToggle) dom.listHighlightVerifiedToggle.checked = state.listHighlightVerified;

    // List highlight: verified color
    state.listVerifiedColor = SETTINGS_DEFAULTS.tweeker_list_verified_color;
    try { localStorage.setItem('tweeker_list_verified_color', state.listVerifiedColor); } catch (e) {}
    if (dom.listVerifiedColorInput) dom.listVerifiedColorInput.value = state.listVerifiedColor;

    // List highlight: mega influencer
    state.listHighlightMega = SETTINGS_DEFAULTS.tweeker_list_highlight_mega;
    try { localStorage.setItem('tweeker_list_highlight_mega', state.listHighlightMega ? 'true' : 'false'); } catch (e) {}
    if (dom.listHighlightMegaToggle) dom.listHighlightMegaToggle.checked = state.listHighlightMega;

    // List highlight: mega color
    state.listMegaColor = SETTINGS_DEFAULTS.tweeker_list_mega_color;
    try { localStorage.setItem('tweeker_list_mega_color', state.listMegaColor); } catch (e) {}
    if (dom.listMegaColorInput) dom.listMegaColorInput.value = state.listMegaColor;

    // Sync all list filter settings to injected script
    syncListFilterSettings();

    // Auto read on app start (startup preference only — does not change live state)
    state.autoReadOnStart = SETTINGS_DEFAULTS.tweeker_autoread_on_start;
    try { localStorage.setItem('tweeker_autoread_on_start', state.autoReadOnStart ? 'true' : 'false'); } catch (e) {}
    if (dom.autoReadStartupToggle) dom.autoReadStartupToggle.checked = state.autoReadOnStart;

    // Debug Twitter
    setDebugTwitterState(SETTINGS_DEFAULTS.tweeker_debug_twitter);

    // Max debug log lines
    state.maxDebugLines = SETTINGS_DEFAULTS.tweeker_max_debug_lines;
    try { localStorage.setItem('tweeker_max_debug_lines', state.maxDebugLines.toString()); } catch (e) {}
    if (dom.maxDebugLinesInput) dom.maxDebugLinesInput.value = state.maxDebugLines;
    pruneDebugLogs();

    // Log level filters
    state.logFilters = { ...SETTINGS_DEFAULTS.tweeker_log_filters };
    try { localStorage.setItem('tweeker_log_filters', JSON.stringify(state.logFilters)); } catch (e) {}
    if (dom.logFilterInfo) dom.logFilterInfo.checked = !!state.logFilters.INFO;
    if (dom.logFilterWarn) dom.logFilterWarn.checked = !!state.logFilters.WARN;
    if (dom.logFilterError) dom.logFilterError.checked = !!state.logFilters.ERROR;
    if (dom.logFilterDebug) dom.logFilterDebug.checked = !!state.logFilters.DEBUG;
    refreshLogsView();
}

// Reset Settings to Defaults button handler (G4)
if (dom.resetSettingsBtn) {
    dom.resetSettingsBtn.addEventListener('click', () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Reset Settings to Defaults action triggered — awaiting confirmation'
        });
        showConfirmationModal({
            title: 'Reset Settings to Defaults?',
            body: 'This will restore all UI toggles, list filter thresholds, relevant-follower limits, color pickers, and logging settings to their factory default values. Your alarms, scheduled tweets, and cached data are not affected.',
            confirmText: 'Reset to Defaults',
            onConfirm: async (updateProgress) => {
                updateProgress(30, 'Applying factory defaults...');
                await new Promise(r => setTimeout(r, 200));
                applySettingsDefaults();
                updateProgress(100, 'Settings reset complete!');
                await new Promise(r => setTimeout(r, 300));
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: 'Manager: Application settings reset to factory defaults successfully'
                });
                showToastMessage('Settings reset to defaults!');
            }
        });
    });
}

// Purge User & Tweet Storage button handler (G3)
if (dom.purgeStorageBtn) {
    dom.purgeStorageBtn.addEventListener('click', () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Purge User & Tweet Storage action triggered — awaiting confirmation'
        });
        showConfirmationModal({
            title: 'Purge User & Tweet Storage?',
            body: 'This will permanently delete all cached user statistics and intercepted tweets from database and memory. Active alarms, scheduled tweets, and application settings will be preserved.\n\nAre you sure you want to proceed?',
            confirmText: 'Purge Storage',
            onConfirm: async (updateProgress) => {
                try {
                    updateProgress(20, 'Wiping in-memory cache...');
                    window._tweeker_user_cache = {};
                    try { localStorage.removeItem('tweeker_user_cache'); } catch (e) {}

                    // Notify injected script to wipe its caches
                    try {
                        window.postMessage({
                            __tweeker: true,
                            type: 'purge_storage'
                        }, '*');
                    } catch (e) {}

                    updateProgress(40, 'Purging SQLite database...');
                    await invoke('purge_user_and_tweet_storage');

                    updateProgress(80, 'Refreshing application view...');
                    await refreshStats();

                    updateProgress(100, 'Purge complete!');
                    await new Promise(r => setTimeout(r, 200));

                    addLogEntry({
                        type: 'info',
                        level: 'INFO',
                        text: 'Manager: User cache and intercepted tweets storage purged successfully'
                    });
                    showToastMessage('Storage purged successfully!');
                } catch (err) {
                    console.error('[Tweeker] Purge storage failed:', err);
                    addLogEntry({
                        type: 'error',
                        level: 'ERROR',
                        text: `Manager: Purge storage failed: ${err}`
                    });
                    showToastMessage('Purge storage failed.');
                }
            }
        });
    });
}

// Factory Reset button handler (G5)
if (dom.factoryResetBtn) {
    dom.factoryResetBtn.addEventListener('click', () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Factory Reset action triggered — awaiting confirmation'
        });
        showConfirmationModal({
            title: 'FACTORY WIPE / RESET?',
            body: 'WARNING: This will permanently delete ALL user statistics, tweet logs, custom alarms, scheduled tweets, and restore all application settings to their factory defaults. This will also clear all browser data, cookies, and cache.\n\nAre you sure you want to completely wipe Tweeker and restart the application?',
            confirmText: 'FACTORY RESET & RESTART',
            onConfirm: async (updateProgress) => {
                try {
                    updateProgress(20, 'Clearing browser site data & cache...');
                    localStorage.clear();
                    sessionStorage.clear();
                    if (window.indexedDB && window.indexedDB.databases) {
                        try {
                            const dbs = await window.indexedDB.databases();
                            for (const db of dbs) {
                                if (db.name) window.indexedDB.deleteDatabase(db.name);
                            }
                        } catch (e) {}
                    }
                    if ('caches' in window) {
                        try {
                            const names = await caches.keys();
                            for (const name of names) {
                                await caches.delete(name);
                            }
                        } catch (e) {}
                    }

                    updateProgress(50, 'Resetting SQLite database...');
                    await invoke('factory_reset');
                    updateProgress(100, 'Restarting...');
                } catch (err) {
                    console.error('[Tweeker] Factory reset failed:', err);
                    addLogEntry({
                        type: 'error',
                        level: 'ERROR',
                        text: `Manager: Factory reset failed: ${err}`
                    });
                    showToastMessage('Factory reset failed.');
                }
            }
        });
    });
}

// Download Diagnostic Report button handler (G6)
if (dom.downloadDiagnosticsBtn) {
    dom.downloadDiagnosticsBtn.addEventListener('click', async () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Download Diagnostic Report action triggered'
        });
        try {
            const logs = state.logs || [];
            const userAgent = navigator.userAgent;
            const language = navigator.language;
            const cookieEnabled = navigator.cookieEnabled;

            const systemInfo = await invoke('get_diagnostic_system_info');
            const dbStats = await fetchDbStats();
            const connectionStatus = await invoke('get_connection_status');

            const report = {
                diagnostic_report: true,
                generated_at: new Date().toISOString(),
                app_version: systemInfo.app_version || '1.0.1',
                os: systemInfo.os,
                arch: systemInfo.arch,
                db_path: systemInfo.db_path,
                webview: {
                    user_agent: userAgent,
                    language: language,
                    cookies_enabled: cookieEnabled,
                },
                connection: connectionStatus,
                database_statistics: dbStats,
                recent_logs: logs.slice(-200).map(l => `[${l.timestamp}] [${l.level}] ${l.text}`),
            };

            const payload = JSON.stringify(report, null, 2);
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const filenameHint = `tweeker_diagnostic_${ts}.json`;

            const savedPath = await invoke('save_diagnostic_report', {
                payload,
                filenameHint
            });

            if (!savedPath) {
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: 'Manager: Download Diagnostic Report cancelled by user'
                });
                showToastMessage('Download cancelled.');
                return;
            }

            addLogEntry({
                type: 'info',
                level: 'INFO',
                text: `Manager: Diagnostic report saved successfully to: ${savedPath}`
            });

            showInfoModal({
                title: 'Diagnostics Downloaded',
                body: `Your diagnostic report has been saved successfully to:\n\n${savedPath}\n\nThis file can be attached to GitHub issue reports to assist developers with troubleshooting.`,
                okText: 'OK'
            });
            showToastMessage('Diagnostic report downloaded!');
        } catch (err) {
            console.error('[Tweeker] Download diagnostic report failed:', err);
            addLogEntry({
                type: 'error',
                level: 'ERROR',
                text: `Manager: Download diagnostic report failed: ${err}`
            });
            showToastMessage('Download report failed.');
        }
    });
}

// ── Feature I: Advanced Settings Configuration Editor ──

function getSettingInputType(key) {
    if (key.endsWith('-color') || key.endsWith('_color') || key.includes('.color')) {
        return 'color';
    }
    const val = localStorage.getItem(key);
    if (val === 'true' || val === 'false' || typeof val === 'boolean') {
        return 'boolean';
    }
    if (!isNaN(val) && val !== '' && val !== null) {
        return 'number';
    }
    return 'text';
}

function renderAdvancedSettings(filterQuery = '') {
    if (!dom.advancedListContainer) return;
    dom.advancedListContainer.innerHTML = '';

    const allKeysSet = new Set([
        ...Object.keys(SETTINGS_DEFAULTS),
        ...Object.keys(localStorage).filter(k => k.startsWith('tweeker_') || k.startsWith('notifications.statistics.'))
    ]);

    const keys = Array.from(allKeysSet).sort();
    const query = filterQuery.toLowerCase().trim();

    let count = 0;
    for (const key of keys) {
        if (query && !key.toLowerCase().includes(query)) continue;

        let val = localStorage.getItem(key);
        if (val === null) {
            const defVal = SETTINGS_DEFAULTS[key];
            val = defVal !== undefined ? (typeof defVal === 'object' ? JSON.stringify(defVal) : defVal.toString()) : '';
        }

        const desc = SETTINGS_DESCRIPTIONS[key] || 'Advanced system configuration parameter.';
        const inputType = getSettingInputType(key);

        const row = document.createElement('div');
        row.className = 'tweeker-advanced-row';

        const info = document.createElement('div');
        info.className = 'tweeker-advanced-key-info';
        
        const keyName = document.createElement('span');
        keyName.className = 'tweeker-advanced-key-name';
        keyName.textContent = key;
        
        const keyDesc = document.createElement('span');
        keyDesc.className = 'tweeker-advanced-key-desc';
        keyDesc.textContent = desc;

        info.appendChild(keyName);
        info.appendChild(keyDesc);

        const editor = document.createElement('div');
        editor.className = 'tweeker-advanced-value-editor';

        let inputEl;
        if (inputType === 'color') {
            inputEl = document.createElement('input');
            inputEl.type = 'color';
            inputEl.className = 'input-color';
            inputEl.value = val;
        } else if (inputType === 'boolean') {
            const toggleWrapper = document.createElement('label');
            toggleWrapper.className = 'toggle-switch';
            
            inputEl = document.createElement('input');
            inputEl.type = 'checkbox';
            inputEl.checked = (val === 'true');
            
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';

            toggleWrapper.appendChild(inputEl);
            toggleWrapper.appendChild(slider);
            editor.appendChild(toggleWrapper);
        } else if (inputType === 'number') {
            inputEl = document.createElement('input');
            inputEl.type = 'number';
            inputEl.className = 'input input-number';
            inputEl.value = val;
            inputEl.style.width = '100%';
        } else {
            inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.className = 'input';
            inputEl.value = val;
            inputEl.style.width = '100%';
        }

        if (inputEl) {
            const changeHandler = (e) => {
                let newVal;
                if (inputType === 'boolean') {
                    newVal = e.target.checked ? 'true' : 'false';
                } else {
                    newVal = e.target.value;
                }
                
                try {
                    localStorage.setItem(key, newVal);
                } catch (err) {}

                applyLiveAdvancedSetting(key, newVal);
            };

            inputEl.addEventListener('change', changeHandler);
            if (inputType === 'color' || inputType === 'boolean') {
                inputEl.addEventListener('input', changeHandler);
            }
            if (inputType !== 'boolean') {
                editor.appendChild(inputEl);
            }
        }

        row.appendChild(info);
        row.appendChild(editor);
        dom.advancedListContainer.appendChild(row);
        count++;
    }

    if (count === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.style.textAlign = 'center';
        empty.style.padding = '12px';
        empty.textContent = 'No matching settings found.';
        dom.advancedListContainer.appendChild(empty);
    }
}

function applyLiveAdvancedSetting(key, val) {
    if (key === 'tweeker_max_log_lines') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 10) {
            state.maxLogLines = num;
            if (dom.maxLogLinesInput) dom.maxLogLinesInput.value = num;
            pruneLogs();
        }
    } else if (key === 'tweeker_user_cache_limit') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 10) {
            if (dom.userCacheLimitInput) dom.userCacheLimitInput.value = num;
            invoke('set_user_cache_limit', { limit: num }).catch(() => {});
        }
    } else if (key === 'tweeker_relevant_followers_limit') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 0) {
            if (dom.relevantFollowersLimitInput) dom.relevantFollowersLimitInput.value = num;
            const color = localStorage.getItem('tweeker_relevant_highlight_color') || '#00ba7c';
            window.postMessage({ __tweeker: true, type: 'set_relevant_followers_limit', limit: num, color }, '*');
        }
    } else if (key === 'tweeker_relevant_highlight_color') {
        if (dom.relevantHighlightColorInput) dom.relevantHighlightColorInput.value = val;
        const limitStr = localStorage.getItem('tweeker_relevant_followers_limit');
        const limit = parseInt(limitStr, 10) || 2500;
        window.postMessage({ __tweeker: true, type: 'set_relevant_followers_limit', limit, color: val }, '*');
    } else if (key === 'tweeker_recent_duration') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1) {
            if (dom.recentDurationInput) dom.recentDurationInput.value = num;
            window.postMessage({ __tweeker: true, type: 'set_recent_settings', duration: num }, '*');
        }
    } else if (key === 'tweeker_list_min_followers') {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
            state.listMinFollowers = num;
            if (dom.listMinFollowersInput) dom.listMinFollowersInput.value = num;
            syncListFilterSettings();
        }
    } else if (key === 'tweeker_list_min_ratio') {
        const num = parseFloat(val);
        if (!isNaN(num)) {
            state.listMinRatio = num;
            if (dom.listMinRatioInput) dom.listMinRatioInput.value = num.toFixed(1);
            syncListFilterSettings();
        }
    } else if (key === 'tweeker_list_highlight_verified') {
        const b = (val === 'true');
        state.listHighlightVerified = b;
        if (dom.listHighlightVerifiedToggle) dom.listHighlightVerifiedToggle.checked = b;
        syncListFilterSettings();
    } else if (key === 'tweeker_list_verified_color') {
        state.listVerifiedColor = val;
        if (dom.listVerifiedColorInput) dom.listVerifiedColorInput.value = val;
        syncListFilterSettings();
    } else if (key === 'tweeker_list_highlight_mega') {
        const b = (val === 'true');
        state.listHighlightMega = b;
        if (dom.listHighlightMegaToggle) dom.listHighlightMegaToggle.checked = b;
        syncListFilterSettings();
    } else if (key === 'tweeker_list_mega_color') {
        state.listMegaColor = val;
        if (dom.listMegaColorInput) dom.listMegaColorInput.value = val;
        syncListFilterSettings();
    } else if (key === 'tweeker_autoread_on_start') {
        const b = (val === 'true');
        state.autoReadOnStart = b;
        if (dom.autoReadStartupToggle) dom.autoReadStartupToggle.checked = b;
    } else if (key === 'tweeker_debug_twitter') {
        const b = (val === 'true');
        setDebugTwitterState(b);
    } else if (key === 'tweeker_max_debug_lines') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 10) {
            state.maxDebugLines = num;
            if (dom.maxDebugLinesInput) dom.maxDebugLinesInput.value = num;
            pruneDebugLogs();
        }
    } else if (key.startsWith('notifications.statistics.')) {
        const notifBg = localStorage.getItem('notifications.statistics.background-color') || '#43474d';
        const notifLikes = localStorage.getItem('notifications.statistics.likes-color') || '#f91880';
        const notifRetweets = localStorage.getItem('notifications.statistics.retweets-color') || '#00ba7c';
        const notifReplies = localStorage.getItem('notifications.statistics.replies-color') || '#1d9bf0';
        const notifViews = localStorage.getItem('notifications.statistics.views-color') || '#71767b';
        try {
            window.postMessage({
                __tweeker: true,
                type: 'set_notif_stats_colors',
                colors: { bg: notifBg, likes: notifLikes, retweets: notifRetweets, replies: notifReplies, views: notifViews }
            }, '*');
        } catch (e) {}
    } else if (key === 'tweeker_max_concurrent_downloads') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1) {
            state.maxConcurrentDownloads = num;
            try { processDownloadQueue(); } catch (e) {}
        }
    } else if (key === 'browser.context_menu.enabled') {
        const enabled = val === 'true' || val === true;
        state.contextMenuEnabled = enabled;
        try {
            window.postMessage({
                __tweeker: true,
                type: 'set_context_menu_enabled',
                enabled: enabled
            }, '*');
        } catch (e) {}
    } else if (key === 'tweeker.dialogs.cache') {
        const enabled = val === 'true' || val === true;
        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                window.__TAURI__.core.invoke('set_dialogs_cache_enabled', { enabled: enabled });
            } else if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
                window.__TAURI__.invoke('set_dialogs_cache_enabled', { enabled: enabled });
            }
        } catch (e) {}
    } else if (key === 'tweeker.dialogs.gemini.erase_previous_chat') {
        const enabled = val === 'true' || val === true;
        try {
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
                window.__TAURI__.core.invoke('set_gemini_erase_chat', { enabled: enabled });
            } else if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
                window.__TAURI__.invoke('set_gemini_erase_chat', { enabled: enabled });
            }
        } catch (e) {}
    }

    addLogEntry({
        type: 'system',
        text: `Advanced Setting: [${key}] updated to value: "${val}"`
    });
}

if (dom.advancedSettingsBtn) {
    dom.advancedSettingsBtn.addEventListener('click', () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Advanced Configuration Editor modal opened'
        });
        if (dom.advancedSearchInput) dom.advancedSearchInput.value = '';
        renderAdvancedSettings();
        if (dom.advancedModalOverlay) dom.advancedModalOverlay.classList.add('open');
    });
}

if (dom.advancedModalClose) {
    dom.advancedModalClose.addEventListener('click', () => {
        if (dom.advancedModalOverlay) dom.advancedModalOverlay.classList.remove('open');
    });
}

if (dom.advancedSearchInput) {
    dom.advancedSearchInput.addEventListener('input', (e) => {
        renderAdvancedSettings(e.target.value);
    });
}


// ── G1: Export Application Data & Backup ──

const BACKUP_SETTINGS_KEYS = [
    'tweeker_max_log_lines',
    'tweeker_user_cache_limit',
    'tweeker_relevant_followers_limit',
    'tweeker_relevant_highlight_color',
    'tweeker_recent_duration',
    'tweeker_list_min_followers',
    'tweeker_list_min_ratio',
    'tweeker_list_highlight_verified',
    'tweeker_list_verified_color',
    'tweeker_list_highlight_mega',
    'tweeker_list_mega_color',
    'tweeker_autoread_on_start',
    'tweeker_debug_twitter',
    'tweeker_max_debug_lines',
    'tweeker_log_filters',
    'tweeker_decouple_mode',
    'notifications.statistics.background-color',
    'notifications.statistics.likes-color',
    'notifications.statistics.retweets-color',
    'notifications.statistics.replies-color',
    'notifications.statistics.views-color',
    'tweeker_max_concurrent_downloads',
    'browser.context_menu.enabled',
    'tweeker.dialogs.cache',
    'tweeker.dialogs.gemini.erase_previous_chat',
];

function buildBackupPayload() {
    // Collect settings from localStorage
    const settings = {};
    for (const key of BACKUP_SETTINGS_KEYS) {
        try {
            const val = localStorage.getItem(key);
            if (val !== null) settings[key] = val;
        } catch (e) {}
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    return {
        tweeker_backup: true,
        version: state.appVersion || '1.0.1',
        exported_at: now.toISOString(),
        alarms: [...(state.alarms || [])],
        scheduled_tweets: [...(state.scheduledTweets || [])],
        settings,
        _filename_hint: `tweeker_backup_${ts}.json`,
    };
}

if (dom.exportBackupBtn) {
    dom.exportBackupBtn.addEventListener('click', async () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Export Backup action triggered'
        });
        try {
            const payload = buildBackupPayload();
            const json = JSON.stringify(payload, null, 2);

            const savedPath = await invoke('export_backup', {
                payload: json,
                filenameHint: payload._filename_hint
            });

            if (!savedPath) {
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: 'Manager: Export Backup cancelled by user'
                });
                showToastMessage('Backup cancelled.');
                return;
            }

            const alarmCount = payload.alarms.length;
            const tweetCount = payload.scheduled_tweets.length;
            
            addLogEntry({
                type: 'info',
                level: 'INFO',
                text: `Manager: Backup exported successfully to: ${savedPath}`
            });

            showInfoModal({
                title: 'Backup Successful',
                body: `Your backup has been saved successfully to:\n\n${savedPath}\n\nContains: ${alarmCount} alarm(s), ${tweetCount} scheduled tweet(s), and settings.`,
                okText: 'OK'
            });
            showToastMessage('Backup exported successfully!');
        } catch (err) {
            console.error('[Tweeker] Export backup failed:', err);
            addLogEntry({
                type: 'error',
                level: 'ERROR',
                text: `Manager: Export backup failed: ${err}`
            });
            showToastMessage('Export backup failed.');
        }
    });
}

// ── G2: Import / Restore Application Data ──

async function applyBackupRestore(backup, updateProgress) {
    let alarmsRestored = 0;
    let alarmsSkipped = 0;
    let tweetsRestored = 0;
    let tweetsSkipped = 0;
    let settingsRestored = 0;

    updateProgress(10, 'Restoring alarms...');
    await new Promise(r => setTimeout(r, 150));

    // ── Restore Alarms ──
    const existingAlarmIds = new Set((state.alarms || []).map(a => a.id));
    for (const alarm of (backup.alarms || [])) {
        if (!alarm.id || !alarm.name || !alarm.alarm_type || !alarm.pattern) {
            alarmsSkipped++;
            continue;
        }
        if (existingAlarmIds.has(alarm.id)) {
            alarmsSkipped++;
            continue;
        }
        try {
            const newAlarm = await invoke('create_alarm', {
                request: {
                    name: alarm.name,
                    alarm_type: alarm.alarm_type,
                    pattern: alarm.pattern,
                    notify: alarm.notify || false,
                }
            });
            state.alarms.push(newAlarm);
            existingAlarmIds.add(newAlarm.id);
            alarmsRestored++;
        } catch (e) {
            alarmsSkipped++;
        }
    }
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
    renderAlarmsList();

    updateProgress(45, 'Restoring scheduled tweets...');
    await new Promise(r => setTimeout(r, 150));

    // ── Restore Scheduled Tweets (pending + future only) ──
    const now = Date.now();
    const existingTweetIds = new Set((state.scheduledTweets || []).map(t => t.id));
    for (const tweet of (backup.scheduled_tweets || [])) {
        if (!tweet.content || !tweet.scheduled_for) {
            tweetsSkipped++;
            continue;
        }
        const scheduledMs = new Date(tweet.scheduled_for).getTime();
        if (isNaN(scheduledMs) || scheduledMs <= now) {
            tweetsSkipped++;
            continue;
        }
        if (tweet.id && existingTweetIds.has(tweet.id)) {
            tweetsSkipped++;
            continue;
        }
        const statusStr = (tweet.status || 'pending').toLowerCase();
        if (statusStr !== 'pending') {
            tweetsSkipped++;
            continue;
        }
        try {
            const newTweet = await invoke('create_scheduled_tweet', {
                content: tweet.content,
                scheduledFor: new Date(tweet.scheduled_for).toISOString(),
            });
            state.scheduledTweets.push(newTweet);
            existingTweetIds.add(newTweet.id);
            tweetsRestored++;
        } catch (e) {
            tweetsSkipped++;
        }
    }
    try { localStorage.setItem('tweeker_scheduled_tweets', JSON.stringify(state.scheduledTweets)); } catch (e) {}
    renderScheduledList();

    updateProgress(75, 'Restoring settings...');
    await new Promise(r => setTimeout(r, 150));

    // ── Restore Settings ──
    const importableKeys = new Set(BACKUP_SETTINGS_KEYS);
    for (const [key, value] of Object.entries(backup.settings || {})) {
        if (!importableKeys.has(key)) continue;
        try {
            localStorage.setItem(key, value);
            settingsRestored++;
        } catch (e) {}
    }

    // Apply restored settings live to state + DOM (same pattern as startup init)
    const savedMaxLogs = parseInt(localStorage.getItem('tweeker_max_log_lines'), 10);
    if (!isNaN(savedMaxLogs) && savedMaxLogs >= 10) {
        state.maxLogLines = savedMaxLogs;
        if (dom.maxLogLinesInput) dom.maxLogLinesInput.value = state.maxLogLines;
        pruneLogs();
    }

    const savedCacheLimit = parseInt(localStorage.getItem('tweeker_user_cache_limit'), 10);
    if (!isNaN(savedCacheLimit) && savedCacheLimit >= 10) {
        if (dom.userCacheLimitInput) dom.userCacheLimitInput.value = savedCacheLimit;
        invoke('set_user_cache_limit', { limit: savedCacheLimit }).catch(() => {});
    }

    const savedRelevantLimit = parseInt(localStorage.getItem('tweeker_relevant_followers_limit'), 10);
    const savedHighlightColor = localStorage.getItem('tweeker_relevant_highlight_color') || '#00ba7c';
    if (!isNaN(savedRelevantLimit) && savedRelevantLimit >= 0) {
        if (dom.relevantFollowersLimitInput) dom.relevantFollowersLimitInput.value = savedRelevantLimit;
    }
    if (dom.relevantHighlightColorInput) dom.relevantHighlightColorInput.value = savedHighlightColor;
    try {
        window.postMessage({ __tweeker: true, type: 'set_relevant_followers_limit',
            limit: isNaN(savedRelevantLimit) ? 2500 : savedRelevantLimit, color: savedHighlightColor }, '*');
    } catch (e) {}

    const savedRecentDuration = parseInt(localStorage.getItem('tweeker_recent_duration'), 10);
    const recentDuration = (!isNaN(savedRecentDuration) && savedRecentDuration >= 1) ? savedRecentDuration : 3;
    if (dom.recentDurationInput) dom.recentDurationInput.value = recentDuration;
    try {
        window.postMessage({ __tweeker: true, type: 'set_recent_settings', duration: recentDuration }, '*');
    } catch (e) {}

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

    const notifBg = localStorage.getItem('notifications.statistics.background-color') || '#43474d';
    const notifLikes = localStorage.getItem('notifications.statistics.likes-color') || '#f91880';
    const notifRetweets = localStorage.getItem('notifications.statistics.retweets-color') || '#00ba7c';
    const notifReplies = localStorage.getItem('notifications.statistics.replies-color') || '#1d9bf0';
    const notifViews = localStorage.getItem('notifications.statistics.views-color') || '#71767b';
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_notif_stats_colors',
            colors: { bg: notifBg, likes: notifLikes, retweets: notifRetweets, replies: notifReplies, views: notifViews }
        }, '*');
    } catch (e) {}

    const savedMaxConcurrent = parseInt(localStorage.getItem('tweeker_max_concurrent_downloads'), 10);
    state.maxConcurrentDownloads = (!isNaN(savedMaxConcurrent) && savedMaxConcurrent >= 1) ? savedMaxConcurrent : 2;

    const contextMenuEnabled = localStorage.getItem('browser.context_menu.enabled') !== 'false';
    state.contextMenuEnabled = contextMenuEnabled;
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_context_menu_enabled',
            enabled: contextMenuEnabled
        }, '*');
    } catch (e) {}

    const dialogsCacheEnabled = localStorage.getItem('tweeker.dialogs.cache') !== 'false';
    try {
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            window.__TAURI__.core.invoke('set_dialogs_cache_enabled', { enabled: dialogsCacheEnabled });
        } else if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
            window.__TAURI__.invoke('set_dialogs_cache_enabled', { enabled: dialogsCacheEnabled });
        }
    } catch (e) {}

    const geminiEraseEnabled = localStorage.getItem('tweeker.dialogs.gemini.erase_previous_chat') === 'true';
    try {
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
            window.__TAURI__.core.invoke('set_gemini_erase_chat', { enabled: geminiEraseEnabled });
        } else if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
            window.__TAURI__.invoke('set_gemini_erase_chat', { enabled: geminiEraseEnabled });
        }
    } catch (e) {}

    const savedAutoReadOnStart = localStorage.getItem('tweeker_autoread_on_start') === 'true';
    state.autoReadOnStart = savedAutoReadOnStart;
    if (dom.autoReadStartupToggle) dom.autoReadStartupToggle.checked = savedAutoReadOnStart;

    const savedDebugTwitter = localStorage.getItem('tweeker_debug_twitter') === 'true';
    setDebugTwitterState(savedDebugTwitter);

    const savedMaxDebug = parseInt(localStorage.getItem('tweeker_max_debug_lines'), 10);
    if (!isNaN(savedMaxDebug) && savedMaxDebug >= 10) {
        state.maxDebugLines = savedMaxDebug;
        if (dom.maxDebugLinesInput) dom.maxDebugLinesInput.value = state.maxDebugLines;
        pruneDebugLogs();
    }

    try {
        const savedLogFilters = localStorage.getItem('tweeker_log_filters');
        if (savedLogFilters) {
            const parsed = JSON.parse(savedLogFilters);
            state.logFilters = {
                INFO: typeof parsed.INFO === 'boolean' ? parsed.INFO : true,
                WARN: typeof parsed.WARN === 'boolean' ? parsed.WARN : true,
                ERROR: typeof parsed.ERROR === 'boolean' ? parsed.ERROR : true,
                DEBUG: typeof parsed.DEBUG === 'boolean' ? parsed.DEBUG : false,
            };
            if (dom.logFilterInfo) dom.logFilterInfo.checked = !!state.logFilters.INFO;
            if (dom.logFilterWarn) dom.logFilterWarn.checked = !!state.logFilters.WARN;
            if (dom.logFilterError) dom.logFilterError.checked = !!state.logFilters.ERROR;
            if (dom.logFilterDebug) dom.logFilterDebug.checked = !!state.logFilters.DEBUG;
            refreshLogsView();
        }
    } catch (e) {}

    updateProgress(100, 'Restore complete!');

    return { alarmsRestored, alarmsSkipped, tweetsRestored, tweetsSkipped, settingsRestored };
}

if (dom.importBackupBtn) {
    dom.importBackupBtn.addEventListener('click', async () => {
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: 'Manager: Import Backup action triggered'
        });
        try {
            const res = await invoke('import_backup');
            if (!res) {
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: 'Manager: Import Backup cancelled by user'
                });
                showToastMessage('Import cancelled.');
                return;
            }

            const [content, path] = res;
            let backup;
            try {
                backup = JSON.parse(content);
            } catch (parseErr) {
                addLogEntry({
                    type: 'error',
                    level: 'ERROR',
                    text: `Manager: Import Backup failed — file at "${path}" is not valid JSON: ${parseErr}`
                });
                showToastMessage('Import failed: invalid JSON file.');
                return;
            }

            // Validate
            if (!backup || backup.tweeker_backup !== true) {
                addLogEntry({
                    type: 'error',
                    level: 'ERROR',
                    text: `Manager: Import Backup failed — file at "${path}" does not appear to be a valid Tweeker backup`
                });
                showToastMessage('Import failed: not a Tweeker backup file.');
                return;
            }

            const now = Date.now();
            const alarmCount = (backup.alarms || []).length;
            // Only count tweets that are pending + future (same filter as restore)
            const futureTweetCount = (backup.scheduled_tweets || []).filter(t => {
                if (!t.scheduled_for) return false;
                const ms = new Date(t.scheduled_for).getTime();
                return !isNaN(ms) && ms > now && (t.status || 'pending').toLowerCase() === 'pending';
            }).length;
            const settingsCount = Object.keys(backup.settings || {}).length;

            const exportedAt = backup.exported_at
                ? new Date(backup.exported_at).toLocaleString()
                : 'unknown date';

            addLogEntry({
                type: 'info',
                level: 'INFO',
                text: `Manager: Backup file at "${path}" validated — exported ${exportedAt}, v${backup.version || '?'} — ${alarmCount} alarm(s), ${futureTweetCount} future scheduled tweet(s), ${settingsCount} setting(s)`
            });

            showConfirmationModal({
                title: 'Restore from Backup?',
                body: `Source File: ${path}\nExported: ${exportedAt} (v${backup.version || '?'})\n\n• ${alarmCount} alarm(s) will be merged (duplicates skipped)\n• ${futureTweetCount} future scheduled tweet(s) will be merged\n• ${settingsCount} setting(s) will be overwritten\n\nYour existing data will not be deleted.`,
                confirmText: 'Restore Backup',
                onConfirm: async (updateProgress) => {
                    try {
                        const result = await applyBackupRestore(backup, updateProgress);
                        addLogEntry({
                            type: 'info',
                            level: 'INFO',
                            text: `Manager: Backup from "${path}" restored — ${result.alarmsRestored} alarm(s) added (${result.alarmsSkipped} skipped), ${result.tweetsRestored} tweet(s) added (${result.tweetsSkipped} skipped), ${result.settingsRestored} setting(s) applied`
                        });
                        showToastMessage(`Backup restored: ${result.alarmsRestored} alarms, ${result.tweetsRestored} tweets, ${result.settingsRestored} settings`);
                    } catch (err) {
                        console.error('[Tweeker] Import restore failed:', err);
                        addLogEntry({
                            type: 'error',
                            level: 'ERROR',
                            text: `Manager: Import Backup restore failed: ${err}`
                        });
                        showToastMessage('Import restore failed. See logs.');
                    }
                }
            });
        } catch (err) {
            console.error('[Tweeker] Import backup failed:', err);
            addLogEntry({
                type: 'error',
                level: 'ERROR',
                text: `Manager: Import backup failed: ${err}`
            });
            showToastMessage('Import backup failed.');
        }
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

    state.stats.unique_authors = Math.max(state.stats.unique_authors || 0, window._tweeker_author_map.size);

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

// ── Concurrency & Queue Processor for Video Downloads ──

function processDownloadQueue() {
    if (state.downloadQueue.length === 0 || state.activeDownloadsCount >= state.maxConcurrentDownloads) {
        return;
    }

    const { tweetUrl, downloadId } = state.downloadQueue.shift();
    state.activeDownloadsCount++;

    addLogEntry({
        type: 'info',
        level: 'INFO',
        text: `Downloader: Starting download for video "${tweetUrl}" (Active: ${state.activeDownloadsCount}/${state.maxConcurrentDownloads})`
    });

    notifyDownloadState(downloadId, 'downloading');

    invoke('download_video_stream', { tweetUrl })
        .then((savedPath) => {
            if (savedPath) {
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: `Downloader: Video successfully saved to: ${savedPath}`
                });
                showToastMessage('Video downloaded successfully!');
                notifyDownloadState(downloadId, 'success');
            } else {
                addLogEntry({
                    type: 'info',
                    level: 'INFO',
                    text: `Downloader: Video download cancelled by user (dialog closed)`
                });
                notifyDownloadState(downloadId, 'idle');
            }
        })
        .catch((err) => {
            console.error('[Tweeker App] Video download failed:', err);
            addLogEntry({
                type: 'error',
                level: 'ERROR',
                text: `Downloader: Direct video download failed: ${err}. Opening fallback...`
            });
            showToastMessage('Direct download failed. Opening manual page...');
            notifyDownloadState(downloadId, 'failed');

            try {
                window.open('https://twitsave.com/info?url=' + encodeURIComponent(tweetUrl), '_blank');
            } catch (e) {}
        })
        .finally(() => {
            state.activeDownloadsCount--;
            processDownloadQueue();
        });
}

function notifyDownloadState(downloadId, status) {
    try {
        window.postMessage({
            __tweeker: true,
            type: 'video_download_status_update',
            payload: { downloadId, status }
        }, '*');
    } catch (e) {}
}

// Listen for messages from injected bridge.js
window.addEventListener('message', (event) => {
    if (!event.data || event.data.__tweeker !== true) return;

    const { type, payload } = event.data;

    if (type === 'download_video_request' && payload && payload.tweetUrl && payload.downloadId) {
        const { tweetUrl, downloadId } = payload;
        
        state.downloadQueue.push({ tweetUrl, downloadId });
        notifyDownloadState(downloadId, 'queued');
        
        addLogEntry({
            type: 'info',
            level: 'INFO',
            text: `Downloader: Enqueued download request for video: "${tweetUrl}"`
        });

        processDownloadQueue();
    }

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
                window.postMessage({
                    __tweeker: true,
                    type: 'set_context_menu_enabled',
                    enabled: state.contextMenuEnabled
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
        addLogEntry({
            type: 'debug',
            level: 'DEBUG',
            text: `[Interceptor] ${payload.text}`
        });
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

    if (type === 'get_users_counts_batch' && payload && Array.isArray(payload.handles)) {
        const handles = payload.handles;
        invoke('get_users_counts_batch', { handles }).then((usersMap) => {
            window.postMessage({
                __tweeker: true,
                type: 'user_counts_batch_response',
                payload: { users: usersMap }
            }, '*');
        }).catch((e) => {
            console.error('[Tweeker App] Failed to get user counts batch:', e);
        });
    }

    if (type === 'get_tweet_stats_batch' && payload && Array.isArray(payload.tweet_ids)) {
        const tweetIds = payload.tweet_ids;
        invoke('get_tweet_stats_batch', { tweetIds }).then((tweetsMap) => {
            window.postMessage({
                __tweeker: true,
                type: 'tweet_stats_batch_response',
                payload: { tweets: tweetsMap }
            }, '*');
        }).catch((e) => {
            console.error('[Tweeker App] Failed to get tweet stats batch:', e);
        });
    }

    if (type === 'get_tweets_by_content_batch' && payload && Array.isArray(payload.snippets)) {
        const snippets = payload.snippets;
        invoke('get_tweets_by_content_batch', { snippets }).then((tweetsMap) => {
            window.postMessage({
                __tweeker: true,
                type: 'tweets_by_content_batch_response',
                payload: { tweets: tweetsMap }
            }, '*');
        }).catch((e) => {
            console.error('[Tweeker App] Failed to get tweets by content batch:', e);
        });
    }

    if (type === 'save_last_url' && payload && typeof payload.url === 'string') {
        invoke('save_last_url', { url: payload.url }).catch((e) => {
            console.error('[Tweeker App] Failed to save last URL:', e);
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

    // Restore saved recent duration setting
    const savedRecentDuration = parseInt(localStorage.getItem('tweeker_recent_duration'), 10);
    const recentDuration = (!isNaN(savedRecentDuration) && savedRecentDuration >= 1) ? savedRecentDuration : 3;
    if (dom.recentDurationInput) {
        dom.recentDurationInput.value = recentDuration;
    }
    window.postMessage({
        __tweeker: true,
        type: 'set_recent_settings',
        duration: recentDuration
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

    // Restore custom notifications statistics colors on start
    const notifBg = localStorage.getItem('notifications.statistics.background-color') || '#43474d';
    const notifLikes = localStorage.getItem('notifications.statistics.likes-color') || '#f91880';
    const notifRetweets = localStorage.getItem('notifications.statistics.retweets-color') || '#00ba7c';
    const notifReplies = localStorage.getItem('notifications.statistics.replies-color') || '#1d9bf0';
    const notifViews = localStorage.getItem('notifications.statistics.views-color') || '#71767b';
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_notif_stats_colors',
            colors: { bg: notifBg, likes: notifLikes, retweets: notifRetweets, replies: notifReplies, views: notifViews }
        }, '*');
    } catch (e) {}

    const savedMaxConcurrent = parseInt(localStorage.getItem('tweeker_max_concurrent_downloads'), 10);
    state.maxConcurrentDownloads = (!isNaN(savedMaxConcurrent) && savedMaxConcurrent >= 1) ? savedMaxConcurrent : 2;

    const contextMenuEnabled = localStorage.getItem('browser.context_menu.enabled') !== 'false';
    state.contextMenuEnabled = contextMenuEnabled;
    try {
        window.postMessage({
            __tweeker: true,
            type: 'set_context_menu_enabled',
            enabled: contextMenuEnabled
        }, '*');
    } catch (e) {}

    const dialogsCacheEnabled = localStorage.getItem('tweeker.dialogs.cache') !== 'false';
    try {
        await invoke('set_dialogs_cache_enabled', { enabled: dialogsCacheEnabled });
    } catch (e) {
        console.error('[Tweeker App] Failed to sync dialogs cache setting to backend:', e);
    }

    const geminiEraseEnabled = localStorage.getItem('tweeker.dialogs.gemini.erase_previous_chat') === 'true';
    try {
        await invoke('set_gemini_erase_chat', { enabled: geminiEraseEnabled });
    } catch (e) {
        console.error('[Tweeker App] Failed to sync gemini erase chat setting to backend:', e);
    }

    // Restore saved log entries
    try {
        const savedLogs = localStorage.getItem('tweeker_logs');
        if (savedLogs) {
            state.logs = JSON.parse(savedLogs);
            pruneLogs();
        }
    } catch (e) {}

    // Restore log level filters (default: all enabled except DEBUG)
    try {
        const savedLogFilters = localStorage.getItem('tweeker_log_filters');
        if (savedLogFilters) {
            const parsed = JSON.parse(savedLogFilters);
            state.logFilters = {
                INFO: typeof parsed.INFO === 'boolean' ? parsed.INFO : true,
                WARN: typeof parsed.WARN === 'boolean' ? parsed.WARN : true,
                ERROR: typeof parsed.ERROR === 'boolean' ? parsed.ERROR : true,
                DEBUG: typeof parsed.DEBUG === 'boolean' ? parsed.DEBUG : false,
            };
        }
    } catch (e) {}

    if (dom.logFilterInfo) dom.logFilterInfo.checked = !!state.logFilters.INFO;
    if (dom.logFilterWarn) dom.logFilterWarn.checked = !!state.logFilters.WARN;
    if (dom.logFilterError) dom.logFilterError.checked = !!state.logFilters.ERROR;
    if (dom.logFilterDebug) dom.logFilterDebug.checked = !!state.logFilters.DEBUG;

    const handleLogFilterChange = () => {
        state.logFilters = {
            INFO: dom.logFilterInfo ? dom.logFilterInfo.checked : true,
            WARN: dom.logFilterWarn ? dom.logFilterWarn.checked : true,
            ERROR: dom.logFilterError ? dom.logFilterError.checked : true,
            DEBUG: dom.logFilterDebug ? dom.logFilterDebug.checked : false,
        };
        try {
            localStorage.setItem('tweeker_log_filters', JSON.stringify(state.logFilters));
        } catch (e) {}
        refreshLogsView();
    };

    if (dom.logFilterInfo) dom.logFilterInfo.addEventListener('change', handleLogFilterChange);
    if (dom.logFilterWarn) dom.logFilterWarn.addEventListener('change', handleLogFilterChange);
    if (dom.logFilterError) dom.logFilterError.addEventListener('change', handleLogFilterChange);
    if (dom.logFilterDebug) dom.logFilterDebug.addEventListener('change', handleLogFilterChange);

    // Check Decoupled Mode setting
    try {
        const isDecoupled = await invoke('get_decouple_mode');
        state.decoupleMode = !!isDecoupled;
        try {
            localStorage.setItem('tweeker_decouple_mode', isDecoupled ? 'true' : 'false');
        } catch (e) {}

        if (dom.decoupleIndicator) {
            dom.decoupleIndicator.style.display = state.decoupleMode ? 'inline-block' : 'none';
        }
    } catch (e) {
        try {
            state.decoupleMode = localStorage.getItem('tweeker_decouple_mode') === 'true';
            if (dom.decoupleIndicator) dom.decoupleIndicator.style.display = state.decoupleMode ? 'inline-block' : 'none';
        } catch (err) {}
    }

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
