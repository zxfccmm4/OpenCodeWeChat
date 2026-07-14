export const PAGE_RUNTIME_SCRIPT = String.raw`
var guiAdminToken = '__GUI_TOKEN__';
var loginPolling = false;
var activePanel = 'overview';
var THEME_KEY = 'opencode-wechat-gui-theme';

var PANEL_META = {
  overview: { title: '通用', sub: '通道状态与基础控制' },
  binding: { title: '聊天绑定', sub: '一次性绑定码与已绑定聊天' },
  sessions: { title: 'Sessions', sub: 'OpenCode 会话与通知' },
  logs: { title: '日志', sub: 'channel.log 实时尾部' }
};

function $(id) { return document.getElementById(id); }

function toast(msg, ms) {
  var t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.style.display = 'none'; }, ms || 3200);
}

async function api(path, opts) {
  var options = opts || {};
  options.headers = Object.assign({}, options.headers || {}, { 'X-OpenCode-WeChat-Token': guiAdminToken });
  var res = await fetch(path, options);
  var data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setPanel(name) {
  activePanel = name || 'overview';
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    var on = tab.getAttribute('data-panel') === activePanel;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach(function (panel) {
    panel.classList.toggle('active', panel.id === 'panel-' + activePanel);
  });
  var meta = PANEL_META[activePanel] || PANEL_META.overview;
  var title = $('detail-title');
  var sub = $('detail-sub');
  if (title) title.textContent = meta.title;
  if (sub) sub.textContent = meta.sub;
  try {
    history.replaceState(null, '', '#' + activePanel);
  } catch (e) { /* ignore */ }
}

function getStoredTheme() {
  try {
    var value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch (e) { /* ignore */ }
  return 'system';
}

function applyTheme(mode) {
  var next = mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
  if (next === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', next);
  }
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  document.querySelectorAll('.appearance-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === next);
  });
}

function initTheme() {
  applyTheme(getStoredTheme());
  document.querySelectorAll('.appearance-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyTheme(btn.getAttribute('data-theme'));
    });
  });
  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (getStoredTheme() === 'system') applyTheme('system');
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }
}

function filterSidebar(query) {
  var q = String(query || '').trim().toLowerCase();
  var visible = 0;
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    var hay = (
      (tab.textContent || '') + ' ' +
      (tab.getAttribute('data-search') || '') + ' ' +
      (tab.getAttribute('data-panel') || '')
    ).toLowerCase();
    var show = !q || hay.indexOf(q) >= 0;
    tab.classList.toggle('hidden', !show);
    if (show) visible += 1;
  });
  var empty = $('sidebar-search-empty');
  if (empty) empty.classList.toggle('show', visible === 0);
  var clear = $('sidebar-search-clear');
  if (clear) clear.classList.toggle('show', q.length > 0);
}

function initSidebarSearch() {
  var input = $('sidebar-search');
  var clear = $('sidebar-search-clear');
  if (!input) return;
  input.addEventListener('input', function () {
    filterSidebar(input.value);
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      input.value = '';
      filterSidebar('');
      input.blur();
    }
  });
  if (clear) {
    clear.addEventListener('click', function () {
      input.value = '';
      filterSidebar('');
      input.focus();
    });
  }
}

function initPanels() {
  var hash = (location.hash || '').replace(/^#/, '');
  if (hash === 'binding' || hash === 'sessions' || hash === 'logs' || hash === 'overview') {
    setPanel(hash);
  } else {
    setPanel('overview');
  }
  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      setPanel(tab.getAttribute('data-panel'));
    });
  });
}

initTheme();
initSidebarSearch();
initPanels();
`;
