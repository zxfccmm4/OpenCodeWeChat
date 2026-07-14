export const CONTROL_PAGE_SCRIPT = String.raw`
function setText(id, value) {
  var el = $(id);
  if (el) el.textContent = value;
}

function shortAccountId(accountId) {
  if (!accountId) return '未登录';
  if (accountId.length <= 22) return accountId;
  return accountId.slice(0, 10) + '…' + accountId.slice(-8);
}

function formatSavedAt(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (e) {
    return String(value);
  }
}

async function refreshStatus() {
  try {
    var s = await api('/api/status');
    var dot = $('dot');
    var needsRelogin = !!s.needsRelogin || (!s.account && !s.running);
    var statusText = '未运行';
    var hint = '就绪';

    var heroDot = $('dot-hero');
    var pill = $('status-pill');
    if (s.running) {
      dot.className = 'dot on';
      if (heroDot) heroDot.className = 'dot on';
      if (pill) pill.className = 'status-pill is-on';
      statusText = '运行中';
      if (s.pid) statusText += ' · pid ' + s.pid;
      hint = '通道监听中';
    } else if (s.needsRelogin || (s.lastError && String(s.lastError).indexOf('session') >= 0)) {
      dot.className = 'dot warn';
      if (heroDot) heroDot.className = 'dot warn';
      if (pill) pill.className = 'status-pill is-warn';
      statusText = '需要重新扫码';
      hint = '会话已过期';
    } else {
      dot.className = 'dot off';
      if (heroDot) heroDot.className = 'dot off';
      if (pill) pill.className = 'status-pill is-off';
      statusText = '未运行';
      hint = s.account ? '已登录，可启动' : '请先扫码登录';
    }

    setText('status-text', statusText);

    var meta = '';
    if (s.account) {
      meta = s.account.accountId + ' · ' + formatSavedAt(s.account.savedAt);
    } else {
      meta = '账号未登录';
    }
    if (needsRelogin || !s.account) {
      meta += ' · 请扫码登录后再启动';
    }
    setText('meta', meta);

    setText('stat-running', s.running ? ('运行中' + (s.pid ? ' · pid ' + s.pid : '')) : '未运行');
    setText('stat-account', s.account ? shortAccountId(s.account.accountId) : '未登录');
    setText('stat-pid', s.running && s.pid ? String(s.pid) : '—');
    setText('stat-hint', hint);

    $('btn-start').disabled = s.running || !s.account;
    $('btn-stop').disabled = !s.running;
    $('btn-logout').disabled = !s.account && !s.running;
    $('btn-login').textContent = s.account ? '重新扫码登录' : '扫码登录';
  } catch (e) {
    setText('status-text', '控制台连接失败');
    $('dot').className = 'dot off';
    var heroDot = $('dot-hero');
    if (heroDot) heroDot.className = 'dot off';
    var pill = $('status-pill');
    if (pill) pill.className = 'status-pill is-off';
    setText('meta', e.message || '无法连接 GUI API');
    setText('stat-running', '连接失败');
    setText('stat-account', '—');
    setText('stat-pid', '—');
    setText('stat-hint', '检查 GUI 是否仍在运行');
  }
}

async function refreshLogs() {
  try {
    var data = await api('/api/logs?lines=300');
    var box = $('log-box');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    if (data.text) {
      box.textContent = data.text;
      if ($('autoscroll').checked && atBottom !== false) {
        box.scrollTop = box.scrollHeight;
      }
    }
  } catch (e) { /* 静默 */ }
}

$('btn-start').onclick = async function () {
  try {
    var r = await api('/api/start', { method: 'POST' });
    toast(r.message || '通道启动中...');
  } catch (e) {
    toast('启动失败：' + e.message, 5000);
  }
  setTimeout(refreshStatus, 800);
};

$('btn-stop').onclick = async function () {
  try {
    var r = await api('/api/stop', { method: 'POST' });
    toast(r.message || '已停止');
  } catch (e) {
    toast('停止失败：' + e.message, 5000);
  }
  setTimeout(refreshStatus, 500);
};

$('btn-logout').onclick = async function () {
  if (!confirm('确定登出吗？将停止通道并清除本机微信凭据（收件箱文件保留）。')) return;
  try {
    var r = await api('/api/logout', { method: 'POST' });
    toast(r.message || '已登出');
  } catch (e) {
    toast('登出失败：' + e.message, 5000);
  }
  setTimeout(refreshStatus, 500);
};

$('btn-login').onclick = async function () {
  if (loginPolling) { toast('已有登录流程进行中'); return; }
  try {
    var r = await api('/api/login', { method: 'POST' });
    var qrCard = $('qr-card');
    qrCard.classList.add('show');
    var overviewTop = $('overview-top');
    if (overviewTop) overviewTop.classList.add('qr-open');
    setPanel('overview');
    $('qr-box').textContent = r.ascii;
    $('qr-hint').textContent = '请使用微信扫描上方二维码';
    pollLogin();
  } catch (e) {
    toast('获取二维码失败：' + e.message, 5000);
  }
};

async function pollLogin() {
  loginPolling = true;
  var deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      var s = await api('/api/login/status');
      if (s.status === 'scaned') {
        $('qr-hint').textContent = '已扫码，请在微信中点击确认...';
      } else if (s.status === 'confirmed') {
        $('qr-card').classList.remove('show');
        var overviewTop = $('overview-top');
        if (overviewTop) overviewTop.classList.remove('qr-open');
        toast('登录成功：' + s.accountId);
        loginPolling = false;
        refreshStatus();
        refreshBindings();
        return;
      } else if (s.status === 'expired') {
        $('qr-hint').textContent = '二维码已过期，请点击「扫码登录」重新获取';
        loginPolling = false;
        return;
      }
    } catch (e) {
      $('qr-hint').textContent = '登录状态查询失败：' + e.message;
    }
    await new Promise(function (r2) { setTimeout(r2, 1500); });
  }
  $('qr-hint').textContent = '登录超时，请重新获取二维码';
  loginPolling = false;
}

var currentBindingCode = '';
var bindingCodeTimer = null;

function formatExpireAt(expiresAt) {
  try {
    return new Date(expiresAt).toLocaleString();
  } catch (e) {
    return String(expiresAt);
  }
}

function remainingSeconds(expiresAt) {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

function showBindingCode(payload) {
  currentBindingCode = payload.code || '';
  var panel = $('binding-code-panel');
  panel.className = 'binding-code-panel show';
  $('binding-code-value').textContent = currentBindingCode;
  updateBindingCodeMeta(payload.expiresAt);
  if (bindingCodeTimer) clearInterval(bindingCodeTimer);
  bindingCodeTimer = setInterval(function () {
    updateBindingCodeMeta(payload.expiresAt);
  }, 1000);
}

function updateBindingCodeMeta(expiresAt) {
  var left = remainingSeconds(expiresAt);
  if (left <= 0) {
    $('binding-code-meta').textContent = '绑定码已过期，请重新生成。';
    if (bindingCodeTimer) {
      clearInterval(bindingCodeTimer);
      bindingCodeTimer = null;
    }
    return;
  }
  var mins = Math.floor(left / 60);
  var secs = left % 60;
  $('binding-code-meta').textContent =
    '有效期至 ' + formatExpireAt(expiresAt) +
    '（剩余 ' + mins + ' 分 ' + String(secs).padStart(2, '0') + ' 秒）。' +
    '在微信发送：/bind ' + currentBindingCode;
}

async function copyText(text, okMessage) {
  if (!text) {
    toast('没有可复制的内容');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    toast(okMessage || '已复制');
  } catch (e) {
    toast('复制失败：' + e.message, 5000);
  }
}

async function refreshBindings() {
  var list = $('binding-list');
  var empty = $('binding-empty');
  var summary = $('binding-summary');
  try {
    var data = await api('/api/bindings');
    var bindings = (data && data.bindings) || [];
    list.innerHTML = '';
    if (!bindings.length) {
      empty.style.display = 'block';
      summary.textContent = '暂无绑定聊天。生成绑定码后，在微信发送 /bind 六位码';
      return;
    }
    empty.style.display = 'none';
    summary.textContent = '已绑定 ' + bindings.length + ' 个聊天（仅显示脱敏标识）';
    bindings.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'binding-item';
      var info = document.createElement('div');
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = item.senderLabel || '已绑定聊天';
      var sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = '绑定于 ' + formatExpireAt(item.boundAt);
      info.appendChild(label);
      info.appendChild(sub);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'danger sm';
      btn.textContent = '解除绑定';
      btn.onclick = async function () {
        if (!confirm('确定解除这个聊天的绑定吗？对方需要重新 /bind 才能继续使用。')) return;
        try {
          await api('/api/bindings/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bindingId: item.bindingId }),
          });
          toast('已解除绑定');
          refreshBindings();
        } catch (e) {
          toast('解除失败：' + e.message, 5000);
        }
      };
      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
  } catch (e) {
    empty.style.display = 'block';
    empty.textContent = e.message && e.message.indexOf('未登录') >= 0
      ? '请先扫码登录微信，再生成绑定码。'
      : ('加载绑定列表失败：' + e.message);
    summary.textContent = '绑定列表暂不可用';
    list.innerHTML = '';
  }
}

$('btn-binding-code').onclick = async function () {
  try {
    var payload = await api('/api/bindings/code', { method: 'POST' });
    showBindingCode(payload);
    toast('已生成绑定码，请在微信发送 /bind ' + payload.code);
    setPanel('binding');
    refreshBindings();
  } catch (e) {
    toast('生成绑定码失败：' + e.message, 5000);
  }
};

$('btn-copy-binding-code').onclick = function () {
  copyText(currentBindingCode, '绑定码已复制');
};

$('btn-copy-bind-command').onclick = function () {
  if (!currentBindingCode) {
    toast('请先生成绑定码');
    return;
  }
  copyText('/bind ' + currentBindingCode, '已复制 /bind 命令');
};

refreshStatus();
refreshLogs();
refreshBindings();
setInterval(refreshStatus, 2000);
setInterval(refreshLogs, 2000);
setInterval(refreshBindings, 8000);
`;
