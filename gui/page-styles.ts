/**
 * macOS 26 Settings-inspired console.
 * Sidebar + grouped form panes + liquid glass chrome (web approximation).
 */
export const GUI_PAGE_STYLES = `
:root,
html[data-theme="light"] {
  color-scheme: light;
  --bg-desktop: #c9d3df;
  --sidebar: rgba(246, 247, 249, 0.72);
  --content: rgba(255, 255, 255, 0.55);
  --group: rgba(255, 255, 255, 0.78);
  --row-hover: rgba(0, 0, 0, 0.04);
  --separator: rgba(60, 60, 67, 0.12);
  --text: #1d1d1f;
  --secondary: rgba(60, 60, 67, 0.72);
  --tertiary: rgba(60, 60, 67, 0.48);
  --accent: #007aff;
  --accent-soft: rgba(0, 122, 255, 0.12);
  --green: #34c759;
  --green-bg: rgba(52, 199, 89, 0.12);
  --amber: #ff9f0a;
  --amber-bg: rgba(255, 159, 10, 0.14);
  --red: #ff3b30;
  --red-bg: rgba(255, 59, 48, 0.10);
  --btn-face: linear-gradient(180deg, #ffffff, #f2f2f4);
  --btn-primary: linear-gradient(180deg, #3d8eff, #007aff);
  --search-bg: rgba(120, 120, 128, 0.12);
  --search-border: rgba(0, 0, 0, 0.06);
  --window-border: rgba(255, 255, 255, 0.55);
  --window-fill: rgba(255, 255, 255, 0.42);
  --titlebar-fill: rgba(255, 255, 255, 0.35);
  --status-fill: rgba(255, 255, 255, 0.55);
  --log-bg: #1c1c1e;
  --log-fg: #e5e5ea;
  --desktop-bg:
    radial-gradient(1200px 700px at 15% 0%, #dfe8f3 0%, transparent 55%),
    radial-gradient(900px 600px at 90% 20%, #e8e4f4 0%, transparent 50%),
    linear-gradient(165deg, #c7d2df 0%, #b7c3d2 45%, #aeb9c8 100%);
  --sidebar-w: 220px;
  --window-radius: 14px;
  --group-radius: 12px;
  --control-radius: 8px;
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --shadow-window:
    0 0 0 0.5px rgba(0,0,0,0.12),
    0 22px 70px rgba(0, 0, 0, 0.22),
    0 2px 8px rgba(0, 0, 0, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --sidebar: rgba(40, 40, 42, 0.72);
    --content: rgba(28, 28, 30, 0.66);
    --group: rgba(44, 44, 46, 0.88);
    --row-hover: rgba(255, 255, 255, 0.06);
    --separator: rgba(84, 84, 88, 0.55);
    --text: #f5f5f7;
    --secondary: rgba(235, 235, 245, 0.62);
    --tertiary: rgba(235, 235, 245, 0.38);
    --accent: #0a84ff;
    --accent-soft: rgba(10, 132, 255, 0.18);
    --green: #30d158;
    --green-bg: rgba(48, 209, 88, 0.16);
    --amber: #ffd60a;
    --amber-bg: rgba(255, 214, 10, 0.14);
    --red: #ff453a;
    --red-bg: rgba(255, 69, 58, 0.14);
    --btn-face: linear-gradient(180deg, #3a3a3c, #2c2c2e);
    --btn-primary: linear-gradient(180deg, #409cff, #0a84ff);
    --search-bg: rgba(118, 118, 128, 0.28);
    --search-border: rgba(255, 255, 255, 0.08);
    --window-border: rgba(255, 255, 255, 0.10);
    --window-fill: rgba(30, 30, 32, 0.55);
    --titlebar-fill: rgba(40, 40, 42, 0.45);
    --status-fill: rgba(58, 58, 60, 0.72);
    --log-bg: #000000;
    --log-fg: #e5e5ea;
    --desktop-bg:
      radial-gradient(1000px 600px at 12% 0%, #2a3140 0%, transparent 55%),
      radial-gradient(800px 500px at 90% 10%, #2b2438 0%, transparent 50%),
      linear-gradient(165deg, #1a1b1e 0%, #121316 55%, #0d0e10 100%);
    --shadow-window:
      0 0 0 0.5px rgba(255,255,255,0.08),
      0 24px 70px rgba(0, 0, 0, 0.55),
      0 2px 10px rgba(0, 0, 0, 0.35);
  }
}

html[data-theme="dark"] {
  color-scheme: dark;
  --sidebar: rgba(40, 40, 42, 0.72);
  --content: rgba(28, 28, 30, 0.66);
  --group: rgba(44, 44, 46, 0.88);
  --row-hover: rgba(255, 255, 255, 0.06);
  --separator: rgba(84, 84, 88, 0.55);
  --text: #f5f5f7;
  --secondary: rgba(235, 235, 245, 0.62);
  --tertiary: rgba(235, 235, 245, 0.38);
  --accent: #0a84ff;
  --accent-soft: rgba(10, 132, 255, 0.18);
  --green: #30d158;
  --green-bg: rgba(48, 209, 88, 0.16);
  --amber: #ffd60a;
  --amber-bg: rgba(255, 214, 10, 0.14);
  --red: #ff453a;
  --red-bg: rgba(255, 69, 58, 0.14);
  --btn-face: linear-gradient(180deg, #3a3a3c, #2c2c2e);
  --btn-primary: linear-gradient(180deg, #409cff, #0a84ff);
  --search-bg: rgba(118, 118, 128, 0.28);
  --search-border: rgba(255, 255, 255, 0.08);
  --window-border: rgba(255, 255, 255, 0.10);
  --window-fill: rgba(30, 30, 32, 0.55);
  --titlebar-fill: rgba(40, 40, 42, 0.45);
  --status-fill: rgba(58, 58, 60, 0.72);
  --log-bg: #000000;
  --log-fg: #e5e5ea;
  --desktop-bg:
    radial-gradient(1000px 600px at 12% 0%, #2a3140 0%, transparent 55%),
    radial-gradient(800px 500px at 90% 10%, #2b2438 0%, transparent 50%),
    linear-gradient(165deg, #1a1b1e 0%, #121316 55%, #0d0e10 100%);
  --shadow-window:
    0 0 0 0.5px rgba(255,255,255,0.08),
    0 24px 70px rgba(0, 0, 0, 0.55),
    0 2px 10px rgba(0, 0, 0, 0.35);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }

body {
  min-height: 100vh;
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.35;
  color: var(--text);
  background: var(--desktop-bg);
  -webkit-font-smoothing: antialiased;
}

button, input { font: inherit; color: inherit; }

button {
  appearance: none;
  border: 0;
  background: var(--btn-face);
  color: var(--text);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 510;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 0.5px rgba(0,0,0,0.12),
    0 0.5px 0.5px rgba(0,0,0,0.06);
  transition: filter .12s, opacity .12s, background .12s;
}
button:hover:not(:disabled) { filter: brightness(0.985); }
button:active:not(:disabled) { filter: brightness(0.96); }
button:disabled { opacity: .4; cursor: not-allowed; }
button.primary {
  background: var(--btn-primary);
  color: #fff;
  box-shadow:
    inset 0 0 0 0.5px rgba(0,0,0,0.08),
    0 0.5px 1px rgba(0, 122, 255, 0.25);
}
button.primary:hover:not(:disabled) { filter: brightness(1.03); }
button.danger {
  color: var(--red);
  background: linear-gradient(180deg, #ffffff, #f7f7f8);
}
button.sm {
  padding: 4px 9px;
  font-size: 12px;
}

code {
  font-family: var(--mono);
  font-size: 11.5px;
  background: rgba(120, 120, 128, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ── Window chrome ─────────────────────────────────────── */
.app {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px 20px;
}

.window {
  width: min(920px, 100%);
  height: min(640px, calc(100vh - 56px));
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  border-radius: var(--window-radius);
  overflow: hidden;
  box-shadow: var(--shadow-window);
  background: var(--window-fill);
  backdrop-filter: blur(40px) saturate(1.4);
  -webkit-backdrop-filter: blur(40px) saturate(1.4);
  border: 0.5px solid var(--window-border);
}

/* Sidebar */
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--sidebar);
  backdrop-filter: blur(30px) saturate(1.35);
  -webkit-backdrop-filter: blur(30px) saturate(1.35);
  border-right: 0.5px solid var(--separator);
  min-height: 0;
}

.traffic {
  display: flex;
  gap: 7px;
  padding: 14px 14px 10px;
}
.traffic span {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12);
}
.traffic .c1 { background: #ff5f57; }
.traffic .c2 { background: #febc2e; }
.traffic .c3 { background: #28c840; }

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px 10px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(180deg, #4b9dff, var(--accent));
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 1px 2px rgba(0, 122, 255, 0.25);
  flex: none;
}
.sidebar-brand h1 {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.sidebar-brand .sub {
  margin-top: 1px;
  font-size: 11px;
  color: var(--secondary);
}

.sidebar-search {
  padding: 0 10px 10px;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--search-bg);
  border: 0.5px solid var(--search-border);
}
.search-field:focus-within {
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: rgba(0, 122, 255, 0.35);
}
.search-glyph {
  color: var(--tertiary);
  font-size: 12px;
  line-height: 1;
  flex: none;
}
#sidebar-search {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  padding: 0;
}
#sidebar-search::placeholder { color: var(--tertiary); }
.search-clear {
  display: none;
  border: 0;
  box-shadow: none;
  background: rgba(120,120,128,0.28);
  color: #fff;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  align-items: center;
  justify-content: center;
}
.search-clear.show { display: inline-flex; }
.search-empty {
  display: none;
  margin: 8px 12px 0;
  padding: 10px;
  text-align: center;
  color: var(--secondary);
  font-size: 12px;
}
.search-empty.show { display: block; }

.nav-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 10px 12px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.nav-tab.hidden { display: none; }
.nav-tab {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text);
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}
.nav-tab:hover:not(:disabled) {
  background: var(--row-hover);
  filter: none;
}
.nav-tab.active {
  background: rgba(0, 122, 255, 0.14);
  color: var(--text);
  font-weight: 560;
}
.nav-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: #fff;
  flex: none;
}
.nav-icon.i-general { background: linear-gradient(180deg, #64b5ff, #0a84ff); }
.nav-icon.i-bind { background: linear-gradient(180deg, #34d399, #059669); }
.nav-icon.i-sessions { background: linear-gradient(180deg, #a78bfa, #7c3aed); }
.nav-icon.i-logs { background: linear-gradient(180deg, #9ca3af, #4b5563); }

.sidebar-foot {
  padding: 10px 12px 14px;
  border-top: 0.5px solid var(--separator);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.appearance {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  padding: 3px;
  border-radius: 9px;
  background: var(--search-bg);
  border: 0.5px solid var(--search-border);
}
.appearance-btn {
  border: 0;
  box-shadow: none;
  background: transparent;
  color: var(--secondary);
  padding: 5px 4px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 560;
}
.appearance-btn:hover:not(:disabled) {
  filter: none;
  color: var(--text);
  background: rgba(255,255,255,0.25);
}
.appearance-btn.active {
  background: var(--group);
  color: var(--text);
  box-shadow:
    inset 0 0 0 0.5px rgba(0,0,0,0.06),
    0 0.5px 1px rgba(0,0,0,0.08);
}
.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--status-fill);
  border: 0.5px solid var(--separator);
  font-size: 12px;
  font-weight: 560;
}
.status-pill.is-on {
  background: var(--green-bg);
  border-color: rgba(52, 199, 89, 0.28);
}
.status-pill.is-warn {
  background: var(--amber-bg);
  border-color: rgba(255, 159, 10, 0.28);
}
.status-pill.is-off {
  background: var(--status-fill);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tertiary);
  flex: none;
}
.dot.on { background: var(--green); box-shadow: 0 0 0 3px rgba(52,199,89,0.18); }
.dot.off { background: var(--red); }
.dot.warn { background: var(--amber); }
.top-meta {
  display: none;
}

/* Detail pane */
.detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--content);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
}

.detail-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 10px 20px;
  border-bottom: 0.5px solid var(--separator);
  background: var(--titlebar-fill);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.detail-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.detail-sub {
  font-size: 11.5px;
  color: var(--secondary);
  margin-top: 1px;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 24px;
  scroll-behavior: smooth;
}

.panel { display: none; }
.panel.active { display: block; }

/* Grouped form sections — macOS Settings style */
.stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.section-label {
  font-size: 11.5px;
  font-weight: 560;
  color: var(--secondary);
  text-transform: none;
  letter-spacing: 0;
  margin: 0 0 6px 4px;
}
.section-footer {
  font-size: 11.5px;
  color: var(--secondary);
  line-height: 1.4;
  margin: 6px 4px 0;
}

.group {
  background: var(--group);
  border-radius: var(--group-radius);
  box-shadow:
    inset 0 0 0 0.5px rgba(255,255,255,0.65),
    0 0 0 0.5px rgba(0,0,0,0.04);
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
  padding: 9px 14px;
  background: transparent;
}
.row + .row {
  border-top: 0.5px solid var(--separator);
}
.row-main {
  min-width: 0;
  flex: 1;
}
.row-title {
  font-size: 13px;
  font-weight: 500;
}
.row-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--secondary);
  line-height: 1.35;
}
.row-value {
  color: var(--secondary);
  font-size: 13px;
  text-align: right;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-value.mono,
.stat-value.mono {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}
.row-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Keep legacy class names used by scripts */
.card {
  /* map to group aesthetics when used alone */
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
  border-radius: 0;
}
.card-head { display: none; }
.card-title, .card-desc { display: none; }
.card-actions { display: flex; gap: 6px; }

.hero-signal {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hero-signal .value {
  font-size: 13px;
  font-weight: 560;
}

.stat-row {
  display: contents;
}
.stat {
  display: contents;
}
.stat-label { display: none; }
.stat-value { display: none; }

/* Explicit settings rows for overview stats */
.settings-rows .row-value {
  white-space: normal;
  word-break: break-all;
}

.toolbar,
.btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.toolbar .spacer { flex: 1; min-width: 4px; }

.row-2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  width: 100%;
}
.row-2.qr-open {
  grid-template-columns: 1fr 1fr;
  align-items: start;
}
.row-2 > * { min-width: 0; width: 100%; }

.steps {
  display: grid;
  grid-template-columns: 1fr;
}
.step {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  min-height: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.step + .step { border-top: 0.5px solid var(--separator); }
.step-title {
  font-size: 13px;
  font-weight: 510;
  margin: 0;
}
.step-body {
  font-size: 12px;
  color: var(--secondary);
  text-align: right;
  max-width: 58%;
  line-height: 1.35;
}

/* QR */
#qr-card { display: none; }
#qr-card.show { display: block; }
.qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 14px 18px;
}
#qr-box {
  background: #fff;
  color: #111;
  display: inline-block;
  padding: 12px;
  border-radius: 10px;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.05;
  white-space: pre;
  box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.08);
}
#qr-hint {
  font-size: 12px;
  color: var(--secondary);
  text-align: center;
}

/* Binding */
.binding-code-panel {
  display: none;
  padding: 18px 14px;
  text-align: center;
}
.binding-code-panel.show { display: block; }
.binding-code-label {
  font-size: 11.5px;
  color: var(--secondary);
  font-weight: 510;
}
.binding-code-value {
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 620;
  letter-spacing: 0.18em;
  color: var(--accent);
  margin: 8px 0 6px;
  line-height: 1.1;
}
.binding-code-meta {
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.4;
}
.binding-code-panel .toolbar {
  justify-content: center;
  margin-top: 12px;
}
.binding-help {
  font-size: 11.5px;
  color: var(--secondary);
  line-height: 1.45;
  margin: 8px 4px 0;
}
.binding-list {
  display: flex;
  flex-direction: column;
}
.binding-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.binding-item + .binding-item {
  border-top: 0.5px solid var(--separator);
}
.binding-item .label {
  font-size: 13px;
  font-weight: 510;
}
.binding-item .sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--secondary);
}
.binding-empty {
  padding: 16px 14px;
  text-align: center;
  color: var(--secondary);
  font-size: 12.5px;
}

/* Sessions */
.sessions-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}
.sessions-layout > * { min-width: 0; }
.session-list,
.session-history,
.notification-list {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow: auto;
}
.session-item {
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: 10px 12px;
  white-space: normal;
}
.session-item + .session-item,
.history-item + .history-item,
.notification-item + .notification-item {
  border-top: 0.5px solid var(--separator);
}
.session-item:hover,
.session-item.active {
  background: var(--accent-soft);
  filter: none;
}
.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.session-title {
  font-weight: 560;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta,
.session-empty {
  color: var(--secondary);
  font-size: 11px;
}
.session-progress-text {
  margin-top: 3px;
  color: var(--secondary);
  font-size: 11px;
}
.session-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--secondary);
}
.session-status::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c7c7cc;
}
.session-status.running::before,
.session-status.busy::before,
.session-status.in_progress::before { background: var(--amber); }
.session-status.completed::before,
.session-status.idle::before { background: var(--green); }
.session-status.error::before,
.session-status.failed::before { background: var(--red); }
.session-progress {
  height: 2px;
  margin-top: 6px;
  border-radius: 999px;
  background: rgba(120,120,128,0.16);
  overflow: hidden;
}
.session-progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width .2s ease;
}
.history-item,
.notification-item {
  padding: 10px 12px;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.history-role {
  font-size: 11px;
  font-weight: 560;
  color: var(--secondary);
  margin-bottom: 3px;
}
.history-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.4;
  color: var(--text);
  font-size: 12.5px;
}
.notification-panel { margin-top: 14px; }
.notification-item.unread {
  background: var(--accent-soft);
}

/* Logs */
.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 0 2px;
}
label.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--secondary);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
#log-box {
  background: var(--log-bg);
  color: var(--log-fg);
  border-radius: 10px;
  padding: 12px;
  height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.45;
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.06);
}

/* Toast */
#toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  top: auto;
  transform: translateX(-50%);
  background: rgba(30, 30, 32, 0.92);
  color: #f5f5f7;
  border: 0;
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 12.5px;
  display: none;
  box-shadow: 0 10px 30px rgba(0,0,0,0.22);
  z-index: 30;
  max-width: min(420px, 90vw);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.footer-note { display: none; }

/* Pane-specific helpers for grouped overview */
.pane-intro {
  max-width: 640px;
  margin: 0 auto 14px;
}
.pane-intro h2 {
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -0.02em;
}
.pane-intro p {
  margin-top: 4px;
  color: var(--secondary);
  font-size: 12.5px;
}

/* Hide unused legacy bits when empty containers remain */
#control-card > .card-head,
#overview-help > .card-head,
#binding-card > .card-head > div:first-child .card-title,
#binding-card > .card-head > div:first-child .card-desc {
  /* still used in binding head via rewritten markup */
}

/* Responsive */
@media (max-width: 860px) {
  .app { padding: 12px; place-items: stretch; }
  .window {
    height: calc(100vh - 24px);
    grid-template-columns: 1fr;
  }
  .sidebar {
    border-right: 0;
    border-bottom: 0.5px solid var(--separator);
  }
  .traffic { display: none; }
  .nav-tabs {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 10px;
  }
  .nav-tab { width: auto; white-space: nowrap; }
  .sidebar-foot { display: none; }
  .row-2.qr-open { grid-template-columns: 1fr; }
  .sessions-layout { grid-template-columns: 1fr; }
  .stack { max-width: none; }
}
@media (max-width: 560px) {
  .panel-body { padding: 12px; }
  .step {
    flex-direction: column;
    align-items: flex-start;
  }
  .step-body {
    text-align: left;
    max-width: none;
  }
  .binding-code-value {
    font-size: 22px;
    letter-spacing: 0.12em;
  }
  #log-box { height: 280px; }
}
`;
