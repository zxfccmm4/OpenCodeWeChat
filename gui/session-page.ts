export const SESSION_PAGE_SCRIPT = String.raw`
var selectedSessionId = '';
var notificationSince = Date.now();
var historyRequestId = 0;

function statusLabel(status) {
  if (status === 'busy') return '运行中';
  if (status === 'retry') return '重试中';
  if (status === 'idle') return '已完成';
  return '状态未知';
}

function formatTime(value) {
  if (!value) return '未知时间';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function loadSessionHistory(sessionId, title) {
  selectedSessionId = sessionId;
  historyRequestId += 1;
  var requestId = historyRequestId;
  $('history-title').textContent = title + ' · 正在加载记录…';
  try {
    var data = await api('/api/sessions/' + encodeURIComponent(sessionId) + '/messages');
    if (requestId !== historyRequestId || sessionId !== selectedSessionId) return;
    var messages = data.messages || [];
    $('history-title').textContent = title + ' · ' + messages.length + ' 条记录';
    $('session-history').innerHTML = messages.length ? messages.map(function (message) {
      var role = message.role === 'user' ? '用户' : 'OpenCode';
      return '<div class="history-item"><div class="history-role">' + role + ' · ' +
        escapeHtml(formatTime(message.createdAt)) + '</div><div class="history-text">' +
        escapeHtml(message.text || '（无文本内容）') + '</div></div>';
    }).join('') : '<div class="session-empty">这个 Session 暂无消息记录</div>';
  } catch (e) {
    if (requestId !== historyRequestId || sessionId !== selectedSessionId) return;
    $('history-title').textContent = title;
    $('session-history').innerHTML = '<div class="session-empty">历史记录加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

async function refreshSessions() {
  try {
    var data = await api('/api/sessions');
    var sessions = data.sessions || [];
    var focusedSessionId = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.sessionId
      : '';
    var activeCount = sessions.filter(function (session) { return session.status === 'busy' || session.status === 'retry'; }).length;
    $('session-summary').textContent = sessions.length + ' 个 Session' + (activeCount ? '，' + activeCount + ' 个进行中' : '，当前无运行任务');
    $('session-list').innerHTML = sessions.length ? sessions.map(function (session) {
      var active = session.id === selectedSessionId ? ' active' : '';
      return '<button class="session-item' + active + '" data-session-id="' + escapeHtml(session.id) +
        '" data-session-title="' + escapeHtml(session.title) + '"><div class="session-row"><span class="session-title">' +
        escapeHtml(session.title) + '</span><span class="session-status ' + escapeHtml(session.status) + '">' +
        statusLabel(session.status) + '</span></div><div class="session-meta">' +
        escapeHtml(session.directory || session.agent || session.model) + '</div><div class="session-meta">更新于 ' +
        escapeHtml(formatTime(session.updatedAt)) + '</div><div class="session-progress-text">当前进度：' +
        escapeHtml(session.progressText || statusLabel(session.status)) + '</div></button>';
    }).join('') : '<div class="session-empty">没有找到 OpenCode Session</div>';
    if (focusedSessionId) {
      var focusedButton = $('session-list').querySelector('[data-session-id="' + CSS.escape(focusedSessionId) + '"]');
      if (focusedButton) focusedButton.focus();
    }
    var selected = sessions.find(function (session) { return session.id === selectedSessionId; });
    if (selected && selected.status !== 'idle') loadSessionHistory(selected.id, selected.title);
  } catch (e) {
    $('session-summary').textContent = 'Session 服务连接失败';
    $('session-list').innerHTML = '<div class="session-empty">' + escapeHtml(e.message) + '</div>';
  }
}

function showBrowserNotification(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  var body = item.type === 'error' ? 'Session 执行失败' : 'Session 已完成';
  new Notification('OpenCode Session 状态更新', { body: body, tag: item.id });
}

async function refreshNotifications() {
  try {
    var data = await api('/api/session-notifications?since=' + notificationSince);
    var items = data.notifications || [];
    if (!items.length) return;
    notificationSince = Math.max.apply(null, items.map(function (item) { return item.createdAt; }));
    $('notification-status').textContent = '刚刚收到 ' + items.length + ' 条通知';
    var html = items.map(function (item) {
      showBrowserNotification(item);
      return '<div class="notification-item unread"><div class="session-row"><strong>' + escapeHtml(item.title) +
        '</strong><span class="session-meta">' + escapeHtml(formatTime(item.createdAt)) + '</span></div><div class="session-meta">' +
        escapeHtml(item.message) + '</div></div>';
    }).join('');
    $('notification-list').innerHTML = html + $('notification-list').innerHTML;
    toast(items[items.length - 1].title + '：' + items[items.length - 1].message);
  } catch (e) {
    $('notification-status').textContent = '通知检查失败';
  }
}

$('session-list').onclick = function (event) {
  var button = event.target.closest('[data-session-id]');
  if (!button) return;
  loadSessionHistory(button.dataset.sessionId, button.dataset.sessionTitle);
  refreshSessions();
};

$('enable-notifications').onclick = async function () {
  if (!('Notification' in window)) { toast('当前浏览器不支持系统通知'); return; }
  var permission = await Notification.requestPermission();
  $('enable-notifications').textContent = permission === 'granted' ? '通知已开启' : '通知未授权';
};

refreshSessions();
refreshNotifications();
setInterval(refreshSessions, 2000);
setInterval(refreshNotifications, 2000);
`;
