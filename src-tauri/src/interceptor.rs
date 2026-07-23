/// Generates the JavaScript injection script that will be injected into the X.com webview
/// via Tauri's `initialization_script` mechanism.
///
/// This script runs in the X.com webview context. It injects:
/// 1. The bridge module (window.postMessage -> Rust)
/// 2. The interceptor module (fetch/XHR monkey-patch + DOM MutationObserver)
/// 3. The control panel overlay CSS & DOM elements
/// 4. The control panel application logic
pub fn build_injection_script() -> String {
    let bridge_js = include_str!("../../src-inject/bridge.js");
    let interceptor_js = include_str!("../../src-inject/interceptor.js");
    let style_css = include_str!("../../src-frontend/style.css");
    let app_js = include_str!("../../src-frontend/app.js");

    // Extract the HTML content inside <body> from index.html
    let index_html = include_str!("../../src-frontend/index.html");
    let body_html = if let Some(start) = index_html.find("<body>") {
        if let Some(end) = index_html.rfind("</body>") {
            let inner = &index_html[start + 6..end];
            // Remove the script tag referencing app.js since we inject it directly
            inner.replace("<script src=\"app.js\"></script>", "")
        } else {
            index_html.to_string()
        }
    } else {
        index_html.to_string()
    };

    format!(
        r#"
(function() {{
    'use strict';

    // Prevent double-injection
    if (window.__tweeker_injected) return;
    window.__tweeker_injected = true;

    // ── Inject CSS ──
    function injectStyles() {{
        if (document.getElementById('tweeker-styles')) return;
        const style = document.createElement('style');
        style.id = 'tweeker-styles';
        style.textContent = `{style_css}`;
        (document.head || document.documentElement).appendChild(style);
    }}

    // ── Inject Overlay UI ──
    function injectOverlayUI() {{
        if (document.getElementById('overlay-panel')) return;
        const container = document.createElement('div');
        container.id = 'tweeker-overlay-container';
        container.innerHTML = `{body_html}`;
        (document.body || document.documentElement).appendChild(container);
    }}

    // Inject styles immediately if head is ready, or wait
    if (document.head || document.documentElement) {{
        injectStyles();
    }} else {{
        document.addEventListener('DOMContentLoaded', injectStyles);
    }}

    // Inject UI when DOM is ready
    if (document.body) {{
        injectOverlayUI();
    }} else {{
        document.addEventListener('DOMContentLoaded', injectOverlayUI);
    }}

    // ── Bridge module ──
    {bridge_js}

    // ── Interceptor module ──
    {interceptor_js}

    // ── Control Panel App Logic ──
    if (document.body) {{
        {app_js}
    }} else {{
        document.addEventListener('DOMContentLoaded', function() {{
            {app_js}
        }});
    }}

    console.log('[Tweeker] Injection scripts & overlay UI loaded successfully');
}})();
"#,
        style_css = style_css.replace('\\', "\\\\").replace('`', "\\`").replace('$', "\\$"),
        body_html = body_html.replace('\\', "\\\\").replace('`', "\\`").replace('$', "\\$"),
        bridge_js = bridge_js,
        interceptor_js = interceptor_js,
        app_js = app_js
    )
}
