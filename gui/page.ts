import { CONTROL_PAGE_SCRIPT } from "./control-page";
import { PAGE_RUNTIME_SCRIPT } from "./page-runtime";
import { GUI_PAGE_STYLES } from "./page-styles";
import { SESSION_PAGE_SCRIPT } from "./session-page";

/**
 * GUI 控制台页面。以模板字符串内嵌，避免运行期文件依赖，
 * 方便后续 bun build --compile 打包。注意：内部 JS 一律不用反引号。
 */
export const GUI_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCodeWeChat 设置</title>
<style>${GUI_PAGE_STYLES}</style>
</head>
<body>
  <div id="toast" role="status" aria-live="polite"></div>

  <div class="app">
    <div class="window">
      <aside class="sidebar">
        <div class="traffic" aria-hidden="true">
          <span class="c1"></span><span class="c2"></span><span class="c3"></span>
        </div>
        <div class="sidebar-brand">
          <div class="brand-mark">OC</div>
          <div>
            <h1>OpenCodeWeChat</h1>
            <div class="sub">本地桥接</div>
          </div>
        </div>

        <div class="sidebar-search">
          <label class="search-field" for="sidebar-search">
            <span class="search-glyph" aria-hidden="true">⌕</span>
            <input id="sidebar-search" type="search" placeholder="搜索" autocomplete="off" spellcheck="false" />
            <button type="button" class="search-clear" id="sidebar-search-clear" aria-label="清除搜索">×</button>
          </label>
          <div class="search-empty" id="sidebar-search-empty">无匹配项</div>
        </div>

        <nav class="nav-tabs" role="tablist" aria-label="设置分类">
          <button type="button" class="nav-tab active" data-panel="overview" data-search="通用 通道 登录 启动 状态 general overview" role="tab" aria-selected="true">
            <span class="nav-icon i-general" aria-hidden="true">通</span>
            <span>通用</span>
          </button>
          <button type="button" class="nav-tab" data-panel="binding" data-search="聊天绑定 bind 绑定码 微信" role="tab" aria-selected="false">
            <span class="nav-icon i-bind" aria-hidden="true">绑</span>
            <span>聊天绑定</span>
          </button>
          <button type="button" class="nav-tab" data-panel="sessions" data-search="sessions 会话 通知 opencode" role="tab" aria-selected="false">
            <span class="nav-icon i-sessions" aria-hidden="true">会</span>
            <span>Sessions</span>
          </button>
          <button type="button" class="nav-tab" data-panel="logs" data-search="日志 log channel" role="tab" aria-selected="false">
            <span class="nav-icon i-logs" aria-hidden="true">志</span>
            <span>日志</span>
          </button>
        </nav>

        <div class="sidebar-foot">
          <div class="appearance" role="group" aria-label="外观">
            <button type="button" class="appearance-btn" data-theme="system" id="theme-system">自动</button>
            <button type="button" class="appearance-btn" data-theme="light" id="theme-light">浅色</button>
            <button type="button" class="appearance-btn" data-theme="dark" id="theme-dark">深色</button>
          </div>
          <div class="status-pill" id="status-pill" title="通道运行状态">
            <span class="dot" id="dot"></span>
            <span id="status-text">加载中…</span>
          </div>
          <div class="top-meta" id="meta">正在读取状态…</div>
        </div>
      </aside>

      <main class="detail">
        <header class="detail-titlebar">
          <div>
            <div class="detail-title" id="detail-title">通用</div>
            <div class="detail-sub" id="detail-sub">通道状态与基础控制</div>
          </div>
        </header>

        <div class="panel-body">
          <section class="panel active" id="panel-overview" role="tabpanel">
            <div class="stack">
              <div class="pane-intro">
                <h2>通用</h2>
                <p>管理微信登录、桥接通道，以及本机监听状态。</p>
              </div>

              <div class="row-2" id="overview-top">
                <div>
                  <div class="section-label">通道</div>
                  <div class="group" id="control-card">
                    <div class="row">
                      <div class="row-main">
                        <div class="row-title">运行状态</div>
                      </div>
                      <div class="hero-signal">
                        <span class="dot" id="dot-hero" aria-hidden="true"></span>
                        <div class="value" id="stat-running">—</div>
                      </div>
                    </div>
                    <div class="row">
                      <div class="row-main"><div class="row-title">账号</div></div>
                      <div class="row-value" id="stat-account">—</div>
                    </div>
                    <div class="row">
                      <div class="row-main"><div class="row-title">进程 PID</div></div>
                      <div class="row-value mono" id="stat-pid">—</div>
                    </div>
                    <div class="row">
                      <div class="row-main"><div class="row-title">提示</div></div>
                      <div class="row-value" id="stat-hint">—</div>
                    </div>
                    <div class="row">
                      <div class="row-main"><div class="row-title">监听地址</div></div>
                      <div class="row-value mono">127.0.0.1</div>
                    </div>
                    <div class="row">
                      <div class="row-main">
                        <div class="row-title">操作</div>
                        <div class="row-desc">启动或停止本地桥接通道。</div>
                      </div>
                      <div class="row-actions">
                        <button class="primary" id="btn-start" type="button">启动</button>
                        <button id="btn-stop" type="button">停止</button>
                      </div>
                    </div>
                    <div class="row">
                      <div class="row-main">
                        <div class="row-title">微信登录</div>
                        <div class="row-desc">扫码后凭据保存在本机。</div>
                      </div>
                      <div class="row-actions">
                        <button id="btn-login" type="button">扫码登录</button>
                        <button class="danger" id="btn-logout" type="button">登出</button>
                      </div>
                    </div>
                  </div>
                  <div class="section-footer">仅监听本机地址，管理令牌每次启动随机生成。</div>
                </div>

                <div id="qr-card">
                  <div class="section-label">扫码登录</div>
                  <div class="group">
                    <div class="qr-wrap">
                      <div id="qr-box"></div>
                      <div id="qr-hint">请使用微信扫描上方二维码</div>
                    </div>
                  </div>
                </div>
              </div>

              <div id="overview-help">
                <div class="section-label">使用步骤</div>
                <div class="group">
                  <div class="steps">
                    <div class="step">
                      <div class="step-title">登录</div>
                      <div class="step-body">扫码登录微信，保存 bot 凭据</div>
                    </div>
                    <div class="step">
                      <div class="step-title">启动</div>
                      <div class="step-body">启动通道，开始接收 ClawBot 消息</div>
                    </div>
                    <div class="step">
                      <div class="step-title">绑定</div>
                      <div class="step-body">生成六位码，微信发送 /bind</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel" id="panel-binding" role="tabpanel">
            <div class="stack">
              <div class="pane-intro">
                <h2>聊天绑定</h2>
                <p id="binding-summary">生成一次性绑定码后，在微信发给 ClawBot。</p>
              </div>

              <div id="binding-card">
                <div class="section-label">绑定码</div>
                <div class="group">
                  <div class="row">
                    <div class="row-main">
                      <div class="row-title">一次性绑定码</div>
                      <div class="row-desc">约 10 分钟有效，生成新码会使旧码失效。</div>
                    </div>
                    <div class="row-actions">
                      <button class="primary" id="btn-binding-code" type="button">生成绑定码</button>
                    </div>
                  </div>
                  <div class="binding-code-panel" id="binding-code-panel">
                    <div class="binding-code-label">当前绑定码</div>
                    <div class="binding-code-value" id="binding-code-value">------</div>
                    <div class="binding-code-meta" id="binding-code-meta"></div>
                    <div class="toolbar">
                      <button id="btn-copy-binding-code" type="button">复制绑定码</button>
                      <button id="btn-copy-bind-command" type="button">复制 /bind 命令</button>
                    </div>
                  </div>
                </div>
                <div class="binding-help">
                  通道运行且已登录时，向 ClawBot 发送
                  <code>/bind 123456</code>
                  。绑定成功后可用
                  <code>/帮助</code>
                  。
                </div>

                <div class="section-label" style="margin-top:16px">已绑定聊天</div>
                <div class="group">
                  <div class="binding-list" id="binding-list"></div>
                  <div class="binding-empty" id="binding-empty">暂无绑定。生成绑定码后在微信完成 /bind。</div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel" id="panel-sessions" role="tabpanel">
            <div class="stack" style="max-width:none">
              <div class="pane-intro" style="max-width:none">
                <h2>Sessions</h2>
                <p id="session-summary">正在加载 Session…</p>
              </div>

              <div class="group session-card">
                <div class="row">
                  <div class="row-main">
                    <div class="row-title">完成通知</div>
                    <div class="row-desc">任务完成或失败时，可通过浏览器通知提醒。</div>
                  </div>
                  <div class="row-actions">
                    <button id="enable-notifications" type="button">开启通知</button>
                  </div>
                </div>
              </div>

              <div class="sessions-layout">
                <div>
                  <div class="section-label">会话列表</div>
                  <div class="group">
                    <div class="session-list" id="session-list"></div>
                  </div>
                </div>
                <div>
                  <div class="section-label" id="history-title">历史记录</div>
                  <div class="group">
                    <div class="session-history" id="session-history"></div>
                  </div>
                </div>
              </div>

              <div class="notification-panel">
                <div class="section-label">最近通知 <span class="session-meta" id="notification-status" role="status" aria-live="polite">等待状态变化</span></div>
                <div class="group">
                  <div class="notification-list" id="notification-list"></div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel" id="panel-logs" role="tabpanel">
            <div class="stack" style="max-width:none">
              <div class="pane-intro" style="max-width:none">
                <h2>日志</h2>
                <p>读取 channel.log 尾部。通道启动后自动刷新。</p>
              </div>
              <div class="group" style="padding:12px">
                <div class="log-head">
                  <div class="row-title">通道日志</div>
                  <label class="chk"><input type="checkbox" id="autoscroll" checked> 自动滚动</label>
                </div>
                <div id="log-box">（通道由本控制台启动后，日志会显示在这里）</div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>

<script>${PAGE_RUNTIME_SCRIPT}
${SESSION_PAGE_SCRIPT}
${CONTROL_PAGE_SCRIPT}</script>
</body>
</html>
`;
