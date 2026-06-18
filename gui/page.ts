/**
 * GUI 控制台页面。以模板字符串内嵌，避免运行期文件依赖，
 * 方便后续 bun build --compile 打包。注意：内部 JS 一律不用反引号。
 */
export const GUI_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCodeWeChat 控制台</title>
<style>
  :root {
    --bg: #0f1115; --card: #171a21; --border: #262b36;
    --text: #e6e9ef; --muted: #8b93a3; --accent: #4f9cf9;
    --green: #34d399; --red: #f87171; --amber: #fbbf24;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text); min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    padding: 24px;
  }
  .wrap { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 4px 4px 0; }
  header h1 { font-size: 20px; font-weight: 700; }
  header .sub { color: var(--muted); font-size: 13px; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 20px;
  }
  .status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.on { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .dot.off { background: var(--red); }
  #status-text { font-size: 15px; font-weight: 600; }
  .meta { color: var(--muted); font-size: 13px; margin-top: 8px; line-height: 1.7; }
  .btns { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
  button {
    border: 1px solid var(--border); background: #1f242e; color: var(--text);
    padding: 9px 18px; border-radius: 8px; font-size: 14px; cursor: pointer;
    transition: all .15s;
  }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); color: #fff; }
  button.danger:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
  #toast {
    position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
    background: #232936; border: 1px solid var(--border); color: var(--text);
    padding: 10px 22px; border-radius: 10px; font-size: 14px; display: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.45); z-index: 10; max-width: 80vw;
  }
  .section-title { font-size: 14px; font-weight: 600; color: var(--muted); margin-bottom: 10px; }
  #qr-card { display: none; }
  #qr-box {
    background: #000; color: #fff; display: inline-block; padding: 14px;
    border-radius: 8px; font-family: "Menlo", "Consolas", monospace;
    font-size: 10px; line-height: 1.05; letter-spacing: 0; white-space: pre;
  }
  #qr-hint { color: var(--amber); font-size: 13px; margin-top: 10px; }
  #log-box {
    background: #0b0d11; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; height: 320px; overflow-y: auto; white-space: pre-wrap;
    word-break: break-all; font-family: "Menlo", "Consolas", monospace;
    font-size: 12px; line-height: 1.55; color: #b7c0d0;
  }
  .log-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  label.chk { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
</style>
</head>
<body>
<div id="toast"></div>
<div class="wrap">
  <header>
    <h1>OpenCodeWeChat 控制台</h1>
    <span class="sub">微信 × OpenCode 桥接通道</span>
  </header>

  <div class="card">
    <div class="status-row">
      <span class="dot" id="dot"></span>
      <span id="status-text">加载中...</span>
    </div>
    <div class="meta" id="meta"></div>
    <div class="btns">
      <button class="primary" id="btn-start">启动通道</button>
      <button id="btn-stop">停止通道</button>
      <button id="btn-login">扫码登录</button>
      <button class="danger" id="btn-logout">登出并清除凭据</button>
    </div>
  </div>

  <div class="card" id="qr-card">
    <div class="section-title">微信扫码登录</div>
    <div id="qr-box"></div>
    <div id="qr-hint">请使用微信扫描上方二维码</div>
  </div>

  <div class="card">
    <div class="log-head">
      <div class="section-title" style="margin:0">通道日志</div>
      <label class="chk"><input type="checkbox" id="autoscroll" checked> 自动滚动</label>
    </div>
    <div id="log-box">（通道由本控制台启动后，日志会显示在这里）</div>
  </div>
</div>

<script>
var loginPolling = false;

function $(id) { return document.getElementById(id); }

function toast(msg, ms) {
  var t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.style.display = 'none'; }, ms || 3200);
}

async function api(path, opts) {
  var res = await fetch(path, opts);
  var data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

async function refreshStatus() {
  try {
    var s = await api('/api/status');
    var dot = $('dot');
    dot.className = 'dot ' + (s.running ? 'on' : 'off');
    $('status-text').textContent = s.running ? '运行中 (pid ' + s.pid + ')' : '未运行';
    var meta = '';
    if (s.account) {
      meta += '账号：' + s.account.accountId + '（登录于 ' + s.account.savedAt + '）';
    } else {
      meta += '账号：未登录';
    }
    $('meta').textContent = meta;
    $('btn-start').disabled = s.running;
    $('btn-stop').disabled = !s.running;
    $('btn-logout').disabled = !s.account && !s.running;
    $('btn-login').textContent = s.account ? '重新扫码登录' : '扫码登录';
  } catch (e) {
    $('status-text').textContent = '控制台连接失败';
    $('dot').className = 'dot off';
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
    $('qr-card').style.display = 'block';
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
        $('qr-card').style.display = 'none';
        toast('登录成功：' + s.accountId);
        loginPolling = false;
        refreshStatus();
        return;
      } else if (s.status === 'expired') {
        $('qr-hint').textContent = '二维码已过期，请点击"扫码登录"重新获取';
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

refreshStatus();
refreshLogs();
setInterval(refreshStatus, 2000);
setInterval(refreshLogs, 2000);
</script>
</body>
</html>
`;
