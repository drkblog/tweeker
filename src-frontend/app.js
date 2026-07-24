// ─────────────────────────────────────────────────────────────────────────────
// Tweeker — Control Panel Application Logic
// ─────────────────────────────────────────────────────────────────────────────
// Organized into: State, DOM Elements, Tab Management, Data Rendering,
// Form Handlers, Event Listeners, and Initialization.
// ─────────────────────────────────────────────────────────────────────────────

if (window.__tweeker_app_initialized) return;
window.__tweeker_app_initialized = true;

const invoke = (window.__TAURI__ && window.__TAURI__.core) 
    ? window.__TAURI__.core.invoke 
    : async (cmd, args) => { console.debug('[Tweeker IPC Fallback]', cmd, args); };

const listen = (window.__TAURI__ && window.__TAURI__.event)
    ? window.__TAURI__.event.listen
    : () => {};

const emit = (window.__TAURI__ && window.__TAURI__.event)
    ? window.__TAURI__.event.emit
    : () => {};

// ── State ──

const state = {
    panelOpen: false,
    activeTab: 'stats',
    autoRead: false,
    autoReadOnStart: false,
    stats: null,
    alarms: [],
    scheduledTweets: [],
    connectionStatus: {
        x_webview_loaded: false,
        interceptor_active: false,
        last_heartbeat: null,
    },
    statsRefreshInterval: null,
};

// ── DOM Elements ──

const dom = {
    overlayToggle: document.getElementById('overlay-toggle'),
    overlayPanel: document.getElementById('overlay-panel'),
    panelClose: document.getElementById('panel-close'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    copyUrlToast: document.getElementById('copy-url-toast'),
    appVersion: document.getElementById('app-version'),

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
        settings: document.getElementById('content-settings'),
    },

    // Stats
    statTweets: document.querySelector('#stat-tweets .stat-value'),
    statAuthors: document.querySelector('#stat-authors .stat-value'),
    statLikes: document.querySelector('#stat-likes .stat-value'),
    statRetweets: document.querySelector('#stat-retweets .stat-value'),
    topAuthorsList: document.getElementById('top-authors-list'),

    // Alarms
    alarmForm: document.getElementById('alarm-form'),
    alarmName: document.getElementById('alarm-name'),
    alarmType: document.getElementById('alarm-type'),
    alarmPattern: document.getElementById('alarm-pattern'),
    alarmsList: document.getElementById('alarms-list'),

    // Scheduler
    scheduleForm: document.getElementById('schedule-form'),
    scheduleContent: document.getElementById('schedule-content'),
    scheduleDatetime: document.getElementById('schedule-datetime'),
    charCount: document.getElementById('char-count'),
    scheduledList: document.getElementById('scheduled-list'),

    // Settings
    interceptorStatus: document.getElementById('interceptor-status'),
    sessionStart: document.getElementById('session-start'),
    settingsVersion: document.getElementById('settings-version'),
};

// ── Panel Toggle ──

function togglePanel(forceState) {
    const newState = forceState !== undefined ? forceState : !state.panelOpen;
    state.panelOpen = newState;

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
    if (tabName === 'settings') refreshSettings();
}

// ── Data Rendering ──

async function refreshStats() {
    try {
        const stats = await invoke('get_timeline_stats');
        state.stats = stats;
        renderStats(stats);
    } catch (e) {
        console.error('[Tweeker] Failed to refresh stats:', e);
    }
}

function renderStats(stats) {
    dom.statTweets.textContent = formatNumber(stats.total_tweets_seen || 0);
    dom.statAuthors.textContent = formatNumber(stats.unique_authors || 0);
    dom.statLikes.textContent = formatNumber(stats.total_likes || 0);
    dom.statRetweets.textContent = formatNumber(stats.total_retweets || 0);

    // Top authors
    if (stats.top_authors && stats.top_authors.length > 0) {
        dom.topAuthorsList.innerHTML = stats.top_authors
            .map(author => `
                <div class="author-item">
                    <div class="author-info">
                        <span class="author-name">${escapeHtml(author.name)}</span>
                        <span class="author-handle">@${escapeHtml(author.handle)}</span>
                    </div>
                    <span class="author-count">${author.count}</span>
                </div>
            `)
            .join('');
    } else {
        dom.topAuthorsList.innerHTML = '<p class="empty-state">No data yet — browse your timeline to start collecting stats.</p>';
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

            return `
                <div class="list-item" data-alarm-id="${alarm.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${escapeHtml(alarm.name)}</div>
                        <div class="list-item-subtitle">${typeLabel}: ${escapeHtml(alarm.pattern)}</div>
                    </div>
                    <div class="list-item-actions">
                        <label class="toggle-switch">
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
            const isSent = tweet.status === 'Sent';
            const statusClass = isSent ? 'badge-active' : 'badge-inactive';
            return `
                <div class="list-item" data-tweet-id="${tweet.id}">
                    <div class="list-item-info">
                        <div class="list-item-title">${escapeHtml(truncate(tweet.content, 60))}</div>
                        <div class="list-item-subtitle">${formatDate(tweet.scheduled_for)} · <span class="${statusClass}" style="padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">${tweet.status}</span></div>
                    </div>
                    <div class="list-item-actions">
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

    if (!name || !pattern) return;

    const newAlarm = {
        id: 'alarm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        name,
        alarm_type: rawType,
        pattern,
        enabled: true,
        created_at: new Date().toISOString(),
        last_triggered: null,
    };

    try {
        const created = await invoke('create_alarm', {
            request: {
                name: name,
                alarm_type: rawType,
                pattern: pattern,
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

    dom.alarmName.value = '';
    dom.alarmPattern.value = '';
    renderAlarms(state.alarms);
}

async function handleDeleteAlarm(id) {
    try {
        await invoke('delete_alarm', { id }).catch(() => {});
    } catch (err) {}
    state.alarms = (state.alarms || []).filter(a => a.id !== id);
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
    renderAlarms(state.alarms);
}

async function handleToggleAlarm(id, enabled) {
    try {
        await invoke('toggle_alarm', { id, enabled }).catch(() => {});
    } catch (err) {}
    const alarm = (state.alarms || []).find(a => a.id === id);
    if (alarm) alarm.enabled = enabled;
    try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
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

function handleCopyUrl() {
    try {
        const currentUrl = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(currentUrl).then(() => {
                showCopyToast();
            }).catch(() => {
                fallbackCopyUrl(currentUrl);
            });
        } else {
            fallbackCopyUrl(currentUrl);
        }
    } catch (e) {
        console.error('[Tweeker] Failed to copy URL:', e);
    }
}

function fallbackCopyUrl(url) {
    try {
        const dummy = document.createElement('textarea');
        dummy.value = url;
        document.body.appendChild(dummy);
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
        showCopyToast();
    } catch (e) {
        console.error('[Tweeker] Fallback copy failed:', e);
    }
}

function showCopyToast() {
    if (!dom.copyUrlToast) return;
    dom.copyUrlToast.classList.add('show');
    setTimeout(() => {
        dom.copyUrlToast.classList.remove('show');
    }, 1500);
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

// ── Auto Read Management ──

function setAutoReadState(enabled) {
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
        const toggleInput = e.target.closest('.alarm-toggle-input') || e.target.closest('input[type="checkbox"]');
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
        const deleteBtn = e.target.closest('.schedule-delete-btn') || e.target.closest('.btn-danger');
        if (deleteBtn) {
            const item = deleteBtn.closest('.list-item');
            if (item && item.dataset.tweetId) {
                handleDeleteScheduledTweet(item.dataset.tweetId);
            }
        }
    });
}

// Initialize draggable toggle button
initDraggableToggle();

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

        const handle = tweet.author_handle || 'unknown';
        const name = tweet.author_name || handle;
        const current = window._tweeker_author_map.get(handle) || { name, count: 0 };
        current.count += 1;
        window._tweeker_author_map.set(handle, current);

        // Evaluate active alarms against incoming tweet
        checkAlarmsForTweet(tweet);
    }

    state.stats.unique_authors = window._tweeker_author_map.size;

    const top = Array.from(window._tweeker_author_map.entries())
        .map(([handle, info]) => ({ handle, name: info.name, count: info.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

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
            showAlarmToast(alarm, tweet);
            renderAlarms(state.alarms);
            try { localStorage.setItem('tweeker_alarms', JSON.stringify(state.alarms)); } catch (e) {}
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
    if (!content) return false;

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
                await new Promise(r => setTimeout(r, 450));
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

            await new Promise(r => setTimeout(r, 500));

            // 4. Click the Post button
            const postBtn = document.querySelector('[data-testid="tweetButtonInline"]')
                || document.querySelector('[data-testid="tweetButton"]')
                || document.querySelector('[aria-label="Post"]');

            if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
                postBtn.click();
                console.log('[Tweeker] Successfully posted scheduled tweet to X.com!');
                return true;
            }
        }
    } catch (err) {
        console.error('[Tweeker] Automatic tweet post error:', err);
    }
    return false;
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

            // Post tweet live to X.com
            const posted = await postTweetToX(tweet.content);

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
    }

    if (type === 'tweet_data' && payload && payload.tweets) {
        processIncomingTweets(payload.tweets);
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

    // Initial data load
    await refreshConnectionStatus();
    await refreshAlarms();
    await refreshScheduledTweets();

    // Start 5-second monitor loop for scheduled tweets
    setInterval(checkScheduledTweets, 5000);
    checkScheduledTweets();

    console.log('[Tweeker] Control panel initialized');
}

init();
