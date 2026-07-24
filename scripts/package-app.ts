#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHANNEL_VERSION } from "../config";

type TargetKey =
  | "macos-arm64"
  | "macos-x64"
  | "linux-x64"
  | "linux-arm64"
  | "windows-x64";

type TargetFamily = "macos" | "linux" | "windows";

interface PackageTarget {
  family: TargetFamily;
  compileTarget: string;
  directoryName: string;
  displayName: string;
  executableName: string;
  guiExecutableName: string;
  guiLauncherName: string;
  setupExecutableName: string;
  stopLauncherName: string;
  launcherName: string;
  setupLauncherName: string;
  readmeName: string;
  envExampleName: string;
  lineEnding: "\n" | "\r\n";
  windowsMetadata?: {
    title: string;
    description: string;
    version: string;
    publisher: string;
  };
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_ROOT = path.join(PROJECT_ROOT, "dist", "one-click");

const TARGETS: Record<TargetKey, PackageTarget> = {
  "macos-arm64": {
    family: "macos",
    compileTarget: "bun-darwin-arm64-modern",
    directoryName: `OpenCodeWeChat-${CHANNEL_VERSION}-macos-arm64`,
    displayName: "macOS Apple Silicon",
    executableName: "OpenCodeWeChat",
    guiExecutableName: "OpenCodeWeChat-GUI",
    guiLauncherName: "OpenCodeWeChat GUI.command",
    setupExecutableName: "OpenCodeWeChat-Setup",
    stopLauncherName: "Stop OpenCodeWeChat.command",
    launcherName: "OpenCodeWeChat.command",
    setupLauncherName: "Login WeChat.command",
    readmeName: "README.txt",
    envExampleName: "opencode-wechat.env.example",
    lineEnding: "\n",
  },
  "macos-x64": {
    family: "macos",
    compileTarget: "bun-darwin-x64-modern",
    directoryName: `OpenCodeWeChat-${CHANNEL_VERSION}-macos-x64`,
    displayName: "macOS Intel",
    executableName: "OpenCodeWeChat",
    guiExecutableName: "OpenCodeWeChat-GUI",
    guiLauncherName: "OpenCodeWeChat GUI.command",
    setupExecutableName: "OpenCodeWeChat-Setup",
    stopLauncherName: "Stop OpenCodeWeChat.command",
    launcherName: "OpenCodeWeChat.command",
    setupLauncherName: "Login WeChat.command",
    readmeName: "README.txt",
    envExampleName: "opencode-wechat.env.example",
    lineEnding: "\n",
  },
  "linux-x64": {
    family: "linux",
    compileTarget: "bun-linux-x64-modern",
    directoryName: `OpenCodeWeChat-${CHANNEL_VERSION}-linux-x64`,
    displayName: "Linux x64 (glibc)",
    executableName: "OpenCodeWeChat",
    guiExecutableName: "OpenCodeWeChat-GUI",
    guiLauncherName: "OpenCodeWeChat-GUI.sh",
    setupExecutableName: "OpenCodeWeChat-Setup",
    stopLauncherName: "Stop-OpenCodeWeChat.sh",
    launcherName: "OpenCodeWeChat.sh",
    setupLauncherName: "Login-WeChat.sh",
    readmeName: "README.txt",
    envExampleName: "opencode-wechat.env.example",
    lineEnding: "\n",
  },
  "linux-arm64": {
    family: "linux",
    compileTarget: "bun-linux-arm64-modern",
    directoryName: `OpenCodeWeChat-${CHANNEL_VERSION}-linux-arm64`,
    displayName: "Linux arm64 (glibc)",
    executableName: "OpenCodeWeChat",
    guiExecutableName: "OpenCodeWeChat-GUI",
    guiLauncherName: "OpenCodeWeChat-GUI.sh",
    setupExecutableName: "OpenCodeWeChat-Setup",
    stopLauncherName: "Stop-OpenCodeWeChat.sh",
    launcherName: "OpenCodeWeChat.sh",
    setupLauncherName: "Login-WeChat.sh",
    readmeName: "README.txt",
    envExampleName: "opencode-wechat.env.example",
    lineEnding: "\n",
  },
  "windows-x64": {
    family: "windows",
    compileTarget: "bun-windows-x64-modern",
    directoryName: `OpenCodeWeChat-${CHANNEL_VERSION}-windows-x64`,
    displayName: "Windows x64",
    executableName: "OpenCodeWeChat.exe",
    guiExecutableName: "OpenCodeWeChat-GUI.exe",
    guiLauncherName: "OpenCodeWeChat GUI.bat",
    setupExecutableName: "OpenCodeWeChat-Setup.exe",
    stopLauncherName: "Stop OpenCodeWeChat.bat",
    launcherName: "OpenCodeWeChat.bat",
    setupLauncherName: "Login WeChat.bat",
    readmeName: "README.txt",
    envExampleName: "opencode-wechat.env.example",
    lineEnding: "\r\n",
    windowsMetadata: {
      title: "OpenCodeWeChat",
      description: "WeChat bridge for OpenCode",
      version: toWindowsVersion(CHANNEL_VERSION),
      publisher: "OpenCodeWeChat",
    },
  },
};

function toWindowsVersion(version: string): string {
  const parts = version.split(".").map((part) => part.trim()).filter(Boolean);
  while (parts.length < 4) parts.push("0");
  return parts.slice(0, 4).join(".");
}

function usage(): never {
  console.log(
    [
      "用法: bun scripts/package-app.ts [--target <target>] [--output-root <dir>]",
      "",
      "可用 target:",
      "  macos-arm64",
      "  macos-x64",
      "  linux-x64",
      "  linux-arm64",
      "  windows-x64",
      "",
      "示例:",
      "  bun scripts/package-app.ts",
      "  bun scripts/package-app.ts --target linux-x64 --target linux-arm64",
      "  bun scripts/package-app.ts --target macos-arm64 --target windows-x64",
    ].join("\n"),
  );
  process.exit(0);
}

function detectDefaultTarget(): TargetKey {
  if (process.platform === "darwin") {
    return process.arch === "x64" ? "macos-x64" : "macos-arm64";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
  if (process.platform === "win32") {
    return "windows-x64";
  }
  throw new Error(
    "当前系统不支持 package:current。请在 macOS、Linux 或 Windows 上运行，或显式传入 --target。",
  );
}

function parseArgs(argv: string[]): { targets: TargetKey[]; outputRoot: string } {
  const targets: TargetKey[] = [];
  let outputRoot = DEFAULT_OUTPUT_ROOT;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      usage();
    }

    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value || !(value in TARGETS)) {
        throw new Error(`未知 target: ${value ?? "<empty>"}`);
      }
      targets.push(value as TargetKey);
      index += 1;
      continue;
    }

    if (arg === "--output-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output-root 需要一个目录参数");
      }
      outputRoot = path.resolve(PROJECT_ROOT, value);
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  return {
    targets: targets.length > 0 ? targets : [detectDefaultTarget()],
    outputRoot,
  };
}

function uniqueTargets(targets: TargetKey[]): TargetKey[] {
  return targets.filter((target, index) => targets.indexOf(target) === index);
}

function isMacTarget(target: PackageTarget): boolean {
  return target.family === "macos";
}

function isLinuxTarget(target: PackageTarget): boolean {
  return target.family === "linux";
}

function isWindowsTarget(target: PackageTarget): boolean {
  return target.family === "windows";
}

function compileExecutable(target: PackageTarget, entryFile: string, outputFile: string) {
  const args = [
    "build",
    "--compile",
    `--target=${target.compileTarget}`,
    `--outfile=${outputFile}`,
  ];

  if (target.windowsMetadata && process.platform === "win32") {
    args.push(
      `--windows-title=${target.windowsMetadata.title}`,
      `--windows-description=${target.windowsMetadata.description}`,
      `--windows-version=${target.windowsMetadata.version}`,
      `--windows-publisher=${target.windowsMetadata.publisher}`,
    );
  }

  args.push(entryFile);

  const result = spawnSync(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `编译 ${path.basename(outputFile)} 失败。首次跨平台打包时，Bun 可能需要联网下载目标 runtime。`,
    );
  }

  if (isMacTarget(target)) {
    codesignMacExecutable(outputFile);
  }
}

function codesignMacExecutable(filePath: string) {
  if (process.platform !== "darwin") {
    console.warn(`[package] 跳过 macOS 签名（当前平台不是 macOS）: ${filePath}`);
    return;
  }

  const result = spawnSync("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    filePath,
  ], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`签名 ${path.basename(filePath)} 失败。请确认 /usr/bin/codesign 可用。`);
  }
}

function writeFile(filePath: string, content: string, mode?: number) {
  fs.writeFileSync(filePath, content, "utf-8");
  if (typeof mode === "number") {
    fs.chmodSync(filePath, mode);
  }
}

function buildEnvExample(targetKey: TargetKey): string {
  const family = TARGETS[targetKey].family;
  if (family === "windows") {
    return [
      "# 复制本文件为 opencode-wechat.env 后按需取消注释。",
      "# 修改后请重新启动通道 / GUI。",
      "",
      "# 可选：固定使用 OMO / Sisyphus agent",
      "# OPENCODE_AGENT=omo",
      "",
      "# 可选：指定 OpenCode CLI 的绝对路径（找不到 opencode 时必填）",
      "# OPENCODE_BIN=C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\opencode.cmd",
      "# OPENCODE_BIN=C:\\Users\\你的用户名\\AppData\\Local\\Programs\\OpenCode\\bin\\opencode.cmd",
      "",
      "# 可选：固定 provider/model。通常建议留空，让 OpenCode / OMO 按自己的配置选择模型",
      "# OPENCODE_PROVIDER_ID=github-copilot",
      "# OPENCODE_MODEL_ID=claude-sonnet-4.6",
      "",
      "# 可选：GUI 控制台端口（默认 5179，仅本机 127.0.0.1）",
      "# OPENCODE_WECHAT_GUI_PORT=5180",
      "",
      "# 可选：长回复最终发送时每条微信文本的最大字符数",
      "# OPENCODE_WECHAT_TEXT_CHUNK_CHARS=500",
      "",
      "# 可选：普通任务 / 长任务（PDF、报告等）超时毫秒",
      "# OPENCODE_WECHAT_PROMPT_TIMEOUT_MS=60000",
      "# OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS=300000",
    ].join("\r\n");
  }

  const binHint = family === "linux"
    ? [
      "# 可选：指定 OpenCode CLI 的绝对路径（找不到 opencode 时必填）",
      "# OPENCODE_BIN=/usr/local/bin/opencode",
      "# OPENCODE_BIN=$HOME/.opencode/bin/opencode",
      "# OPENCODE_BIN=/usr/bin/opencode",
    ]
    : [
      "# 可选：指定 OpenCode CLI 的绝对路径（找不到 opencode 时必填）",
      "# OPENCODE_BIN=/opt/homebrew/bin/opencode",
      "# OPENCODE_BIN=/usr/local/bin/opencode",
    ];

  return [
    "# 复制本文件为 opencode-wechat.env 后按需取消注释。",
    "# 修改后请重新启动通道 / GUI。",
    "",
    "# 可选：固定使用 OMO / Sisyphus agent",
    "# OPENCODE_AGENT=omo",
    "",
    ...binHint,
    "",
    "# 可选：固定 provider/model。通常建议留空，让 OpenCode / OMO 按自己的配置选择模型",
    "# OPENCODE_PROVIDER_ID=github-copilot",
    "# OPENCODE_MODEL_ID=claude-sonnet-4.6",
    "",
    "# 可选：GUI 控制台端口（默认 5179，仅本机 127.0.0.1）",
    "# OPENCODE_WECHAT_GUI_PORT=5180",
    "",
    "# 可选：长回复最终发送时每条微信文本的最大字符数",
    "# OPENCODE_WECHAT_TEXT_CHUNK_CHARS=500",
    "",
    "# 可选：普通任务 / 长任务（PDF、报告等）超时毫秒",
    "# OPENCODE_WECHAT_PROMPT_TIMEOUT_MS=60000",
    "# OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS=300000",
  ].join("\n");
}

function buildReadme(target: PackageTarget, targetKey: TargetKey): string {
  const isWindows = target.family === "windows";
  const isLinux = target.family === "linux";
  const credentialsPath = isWindows
    ? "%USERPROFILE%\\.claude\\channels\\wechat"
    : "~/.claude/channels/wechat";

  let platformHints: string[] = [];
  if (target.family === "macos") {
    platformHints = [
      "macOS 若提示「已损坏，无法打开」：",
      "  在终端进入本目录后执行：",
      "  xattr -dr com.apple.quarantine .",
      "  （启动脚本也会尽量自动清除隔离属性）",
      "",
    ];
  } else if (isLinux) {
    platformHints = [
      "Linux 说明：",
      "  - 本包面向 glibc 发行版（Ubuntu / Debian / Fedora / openSUSE 等）。",
      "  - Alpine / musl 环境暂不支持。",
      "  - 首次请在终端执行并确认可执行权限：",
      "      chmod +x *.sh bin/*",
      "  - 启动示例：",
      `      ./OpenCodeWeChat-GUI.sh`,
      "    或：",
      `      bash OpenCodeWeChat-GUI.sh`,
      "  - 图形桌面可尝试双击 .sh；若无执行权限请先 chmod。",
      "  - 无桌面的服务器：用终端启动 GUI 后，浏览器访问 http://127.0.0.1:5179",
      "    （默认只监听本机；远程访问请自行用 SSH 端口转发，勿直接暴露到公网）",
      "",
    ];
  }

  const openCodeHint = isWindows
    ? [
        "- 已安装 OpenCode，且命令行能运行 opencode。",
        "  若找不到，请在 opencode-wechat.env 设置 OPENCODE_BIN 为绝对路径。",
      ]
    : [
        "- 已安装 OpenCode，且终端能运行 `opencode --version`。",
        "  若不在 PATH，请在 opencode-wechat.env 设置 OPENCODE_BIN。",
      ];

  const step2 = isLinux
    ? `2. 在终端进入解压目录，执行：chmod +x *.sh bin/* 后运行 ./${target.guiLauncherName}`
    : `2. 双击「${target.guiLauncherName}」打开图形控制台。`;

  const howToStart = isLinux
    ? [
        "推荐上手步骤（终端 / GUI）：",
        "============================================================",
        "1. 解压本压缩包到任意目录。",
        step2,
        "3. 浏览器打开控制台（一般会自动打开；否则访问 http://127.0.0.1:5179）。",
        "4. 扫码登录微信。",
        "5. 点击「启动通道」。",
        "6. 打开「聊天绑定」→ 生成六位绑定码。",
        "7. 在微信向 ClawBot 发送：",
        "     /bind 123456",
        "   （将 123456 换成你生成的码，约 10 分钟有效）",
        "8. 绑定成功后发送 /帮助，或直接描述任务。",
      ]
    : [
        "推荐上手步骤（GUI）",
        "============================================================",
        "1. 解压本压缩包到任意目录（路径尽量不要含特殊字符）。",
        step2,
        "3. 在浏览器控制台中扫码登录微信。",
        "4. 点击「启动通道」。",
        "5. 打开「聊天绑定」→ 生成六位绑定码。",
        "6. 在微信向 ClawBot 发送：",
        "     /bind 123456",
        "   （将 123456 换成你生成的码，约 10 分钟有效）",
        "7. 绑定成功后发送 /帮助，或直接描述任务。",
      ];

  return [
    `OpenCodeWeChat 一键启动包`,
    `版本: ${CHANNEL_VERSION}`,
    `平台: ${target.displayName}`,
    "",
    "============================================================",
    "这是什么",
    "============================================================",
    "把微信变成 OpenCode / Oh My OpenAgent (OMO) 的移动入口。",
    "本机通过官方 ClawBot ilink API 桥接微信消息与 opencode serve，",
    "可在微信里对话、跑工作流、收发图片/文件/PDF。",
    "",
    "============================================================",
    "运行前提（必读）",
    "============================================================",
    ...openCodeHint,
    "- 已在本机完成 OpenCode 登录（本机模型/Provider 配置可用）。",
    "- 微信账号可使用 ClawBot。",
    "- 使用 OMO 时，本机已配置好对应 agent。",
    "",
    "============================================================",
    ...howToStart,
    "",
    "GUI 默认只监听 127.0.0.1:5179，仅本机可访问。",
    "",
    "============================================================",
    "本包文件说明",
    "============================================================",
    `${target.guiLauncherName}`,
    "  推荐入口。启动图形控制台（扫码、启停通道、绑定、日志、Session）。",
    "",
    `${target.launcherName}`,
    "  仅启动微信通道（终端）。无凭据时会自动弹出扫码。",
    "",
    `${target.setupLauncherName}`,
    "  仅重新扫码登录微信（不启动长期轮询时可用）。",
    "",
    `${target.stopLauncherName}`,
    "  停止正在运行的通道进程。",
    "",
    "bin/",
    "  预编译可执行文件（通道 / Setup / GUI）。请勿单独挪走后运行。",
    "",
    "opencode-wechat.env.example",
    "  环境变量示例。复制为同目录下的 opencode-wechat.env 后生效。",
    "",
    "README.txt",
    "  本说明文件。",
    "",
    "============================================================",
    "常用微信命令（绑定后）",
    "============================================================",
    "/帮助          命令说明（无需绑定）",
    "/bind 六位码   绑定当前聊天（无需绑定）",
    "/状态          工作区、Session、模型、模式等",
    "/新建          新任务草稿",
    "/项目          列出或切换工作区",
    "/模型          列出或切换模型",
    "/模式          列出或切换 agent",
    "/思考          思考级别",
    "/回复          简洁 / 标准 / 详细",
    "",
    "OMO 示例（消息开头）：",
    "  #plan 把发布流程拆成可执行步骤",
    "  #start 按刚才的计划继续",
    "  #review 检查这次改动的回归风险",
    "  #ulw 修复 bug 并验证",
    "",
    "============================================================",
    "自定义配置",
    "============================================================",
    "1. 复制 opencode-wechat.env.example → opencode-wechat.env",
    "2. 按注释取消相关行并填写路径 / 参数",
    "3. 重新启动 GUI 或通道",
    "",
    "常见变量：",
    "  OPENCODE_BIN              OpenCode CLI 绝对路径",
    "  OPENCODE_AGENT            默认 agent（如 omo）",
    "  OPENCODE_WECHAT_GUI_PORT  GUI 端口，默认 5179",
    "  OPENCODE_WECHAT_TEXT_CHUNK_CHARS  回微信文本分片长度",
    "",
    "模型建议：不要设置 OPENCODE_PROVIDER_ID / OPENCODE_MODEL_ID，",
    "交给本机 OpenCode / OMO 默认配置。",
    "",
    "============================================================",
    "本地数据目录",
    "============================================================",
    credentialsPath,
    "",
    "主要文件：",
    "  account.json           微信登录凭据",
    "  bot_state.sqlite       绑定与会话偏好",
    "  channel.log            通道日志（GUI 可查看）",
    "  inbox/                 入站图片/文件",
    "  opencode-wechat.pid    通道进程 PID",
    "",
    "============================================================",
    "常见问题",
    "============================================================",
    ...platformHints,
    "找不到 OpenCode：",
    "  终端运行 opencode --version 确认可用；否则设置 OPENCODE_BIN。",
    "",
    "errcode=-14 / session timeout：",
    "  微信登录已过期。停止通道后重新扫码登录，再启动通道。",
    "  绑定偏好一般会保留，通常无需再次 /bind。",
    "",
    "回复被截断 / 长任务超时：",
    "  可调大 OPENCODE_WECHAT_LONG_PROMPT_TIMEOUT_MS（如 600000）。",
    "  分片默认 500 字符更稳。",
    "",
    "未绑定用户：",
    "  只会收到引导，不会调用本机 AI。请先在 GUI 生成码并 /bind。",
    "",
    "============================================================",
    "安全提示",
    "============================================================",
    "- GUI 与管理 API 仅监听本机 127.0.0.1。",
    "- 绑定码为一次性，生成新码会使旧码失效。",
    "- 勿把 account.json 或绑定信息分享给他人。",
    "",
    `版本 ${CHANNEL_VERSION} · 许可证 MIT`,
  ].join(target.lineEnding);
}

function createZipArchive(packageDir: string, zipPath: string) {
  fs.rmSync(zipPath, { force: true });
  const parentDir = path.dirname(packageDir);
  const folderName = path.basename(packageDir);

  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path ${JSON.stringify(packageDir)} -DestinationPath ${JSON.stringify(zipPath)} -Force`,
      ],
      { cwd: PROJECT_ROOT, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`打包 zip 失败: ${zipPath}`);
    }
    return;
  }

  const result = spawnSync(
    "zip",
    ["-qry", zipPath, folderName],
    { cwd: parentDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`打包 zip 失败: ${zipPath}（请确认系统已安装 zip 命令）`);
  }
}

function buildRootUsageGuide(builtTargets: TargetKey[]): string {
  const lines = [
    "OpenCodeWeChat 一键包分发说明",
    `版本: ${CHANNEL_VERSION}`,
    "",
    "------------------------------------------------------------",
    "按平台选择对应 zip，解压后阅读包内 README.txt 即可使用。",
    "------------------------------------------------------------",
    "",
    "文件对照：",
  ];

  for (const key of builtTargets) {
    const target = TARGETS[key];
    lines.push(
      `  ${target.directoryName}.zip`,
      `    → ${target.displayName}`,
      `    → 解压后双击「${target.guiLauncherName}」`,
      "",
    );
  }

  lines.push(
    "通用步骤：",
    "  1. 本机已安装并可运行 opencode",
    "  2. 解压对应平台 zip",
    "  3. 启动 GUI：",
    "       macOS / Windows: 双击 GUI 启动器",
    "       Linux: chmod +x *.sh bin/* 后执行 ./OpenCodeWeChat-GUI.sh",
    "  4. 扫码登录微信 → 启动通道",
    "  5. 生成绑定码，微信发送 /bind 六位码",
    "  6. 发送 /帮助 或直接对话",
    "",
    "macOS 若提示已损坏：",
    "  xattr -dr com.apple.quarantine .",
    "",
    "Linux 说明：",
    "  - 面向 glibc（Ubuntu/Debian/Fedora 等），非 Alpine/musl",
    "  - 无桌面服务器可用终端启动 GUI，浏览器访问 http://127.0.0.1:5179",
    "  - 远程请用 SSH 端口转发，勿把 GUI 直接暴露到公网",
    "",
    "校验（可选）：",
    "  macOS / Linux:  shasum -a 256 OpenCodeWeChat-*.zip",
    "  Windows PowerShell:  Get-FileHash .\\OpenCodeWeChat-*.zip -Algorithm SHA256",
    "",
    "更完整的命令、环境变量与排障见各 zip 包内 README.txt。",
    `版本 ${CHANNEL_VERSION} · MIT`,
    "",
  );

  return lines.join("\n");
}

function buildMacLauncher(executableName: string): string {
  return [
    "#!/bin/bash",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"",
    "cd \"$SCRIPT_DIR\"",
    "",
    "if [ -f \"$SCRIPT_DIR/opencode-wechat.env\" ]; then",
    "  set -a",
    "  . \"$SCRIPT_DIR/opencode-wechat.env\"",
    "  set +a",
    "fi",
    "",
    "export PATH=\"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"",
    "",
    "if command -v xattr >/dev/null 2>&1; then",
    "  xattr -dr com.apple.quarantine \"$SCRIPT_DIR\" >/dev/null 2>&1 || true",
    "fi",
    "",
    "echo \"OpenCodeWeChat\"",
    "echo",
    "",
    "set +e",
    "\"$SCRIPT_DIR/bin/" + executableName + "\"",
    "EXIT_CODE=$?",
    "set -e",
    "",
    "echo",
    "if [ \"$EXIT_CODE\" -ne 0 ]; then",
    "  echo \"程序已退出，错误码: $EXIT_CODE\"",
    "else",
    "  echo \"程序已退出。\"",
    "fi",
    "echo",
    "read -r -p \"按回车关闭窗口...\" _",
    "exit \"$EXIT_CODE\"",
  ].join("\n");
}

function buildMacStopLauncher(): string {
  return [
    "#!/bin/bash",
    "PID_FILE=\"$HOME/.claude/channels/wechat/opencode-wechat.pid\"",
    "",
    "if [ ! -f \"$PID_FILE\" ]; then",
    "  echo \"未找到运行中的 OpenCodeWeChat。\"",
    "  read -r -p \"按回车关闭窗口...\" _",
    "  exit 0",
    "fi",
    "",
    "PID=\"$(tr -d '[:space:]' < \"$PID_FILE\")\"",
    "",
    "if [ -z \"$PID\" ] || ! kill -0 \"$PID\" >/dev/null 2>&1; then",
    "  rm -f \"$PID_FILE\"",
    "  echo \"OpenCodeWeChat 未运行，已清理旧 pid 文件。\"",
    "  read -r -p \"按回车关闭窗口...\" _",
    "  exit 0",
    "fi",
    "",
    "echo \"正在停止 OpenCodeWeChat (pid=$PID)...\"",
    "kill \"$PID\"",
    "sleep 2",
    "",
    "if kill -0 \"$PID\" >/dev/null 2>&1; then",
    "  echo \"进程仍在运行，强制结束...\"",
    "  kill -9 \"$PID\" >/dev/null 2>&1 || true",
    "fi",
    "",
    "rm -f \"$PID_FILE\"",
    "echo \"已停止 OpenCodeWeChat。\"",
    "read -r -p \"按回车关闭窗口...\" _",
  ].join("\n");
}

function buildLinuxLauncher(executableName: string): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"",
    "cd \"$SCRIPT_DIR\"",
    "",
    "if [ -f \"$SCRIPT_DIR/opencode-wechat.env\" ]; then",
    "  set -a",
    "  # shellcheck disable=SC1091",
    "  . \"$SCRIPT_DIR/opencode-wechat.env\"",
    "  set +a",
    "fi",
    "",
    "export PATH=\"$HOME/.opencode/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"",
    "",
    "BIN=\"$SCRIPT_DIR/bin/" + executableName + "\"",
    "if [ ! -x \"$BIN\" ]; then",
    "  if [ -f \"$BIN\" ]; then",
    "    chmod +x \"$BIN\" || true",
    "  else",
    "    echo \"未找到可执行文件: $BIN\"",
    "    exit 1",
    "  fi",
    "fi",
    "",
    "echo \"OpenCodeWeChat\"",
    "echo",
    "",
    "set +e",
    "\"$BIN\"",
    "EXIT_CODE=$?",
    "set -e",
    "",
    "echo",
    "if [ \"$EXIT_CODE\" -ne 0 ]; then",
    "  echo \"程序已退出，错误码: $EXIT_CODE\"",
    "else",
    "  echo \"程序已退出。\"",
    "fi",
    "",
    "if [ -t 0 ]; then",
    "  echo",
    "  read -r -p \"按回车关闭...\" _ || true",
    "fi",
    "exit \"$EXIT_CODE\"",
  ].join("\n");
}

function buildLinuxStopLauncher(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "PID_FILE=\"$HOME/.claude/channels/wechat/opencode-wechat.pid\"",
    "",
    "if [ ! -f \"$PID_FILE\" ]; then",
    "  echo \"未找到运行中的 OpenCodeWeChat。\"",
    "  if [ -t 0 ]; then",
    "    read -r -p \"按回车关闭...\" _ || true",
    "  fi",
    "  exit 0",
    "fi",
    "",
    "PID=\"$(tr -d '[:space:]' < \"$PID_FILE\")\"",
    "",
    "if [ -z \"$PID\" ] || ! kill -0 \"$PID\" >/dev/null 2>&1; then",
    "  rm -f \"$PID_FILE\"",
    "  echo \"OpenCodeWeChat 未运行，已清理旧 pid 文件。\"",
    "  if [ -t 0 ]; then",
    "    read -r -p \"按回车关闭...\" _ || true",
    "  fi",
    "  exit 0",
    "fi",
    "",
    "echo \"正在停止 OpenCodeWeChat (pid=$PID)...\"",
    "kill \"$PID\" || true",
    "sleep 2",
    "",
    "if kill -0 \"$PID\" >/dev/null 2>&1; then",
    "  echo \"进程仍在运行，强制结束...\"",
    "  kill -9 \"$PID\" >/dev/null 2>&1 || true",
    "fi",
    "",
    "rm -f \"$PID_FILE\"",
    "echo \"已停止 OpenCodeWeChat。\"",
    "if [ -t 0 ]; then",
    "  read -r -p \"按回车关闭...\" _ || true",
    "fi",
  ].join("\n");
}

function buildWindowsLauncher(executableName: string): string {
  return [
    "@echo off",
    "setlocal",
    "chcp 65001 >nul",
    "cd /d \"%~dp0\"",
    "",
    "if exist \"%~dp0opencode-wechat.env\" (",
    "  for /f \"usebackq eol=# tokens=1* delims==\" %%A in (\"%~dp0opencode-wechat.env\") do (",
    "    if not \"%%A\"==\"\" set \"%%A=%%B\"",
    "  )",
    ")",
    "",
    "set \"PATH=%LOCALAPPDATA%\\Programs\\OpenCode\\bin;%LOCALAPPDATA%\\Programs\\OpenCode;%USERPROFILE%\\AppData\\Roaming\\npm;%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages;%ProgramFiles%\\OpenCode\\bin;%ProgramFiles%\\OpenCode;%ProgramFiles(x86)%\\OpenCode\\bin;%ProgramFiles(x86)%\\OpenCode;%PATH%\"",
    "",
    "echo OpenCodeWeChat",
    "echo.",
    "bin\\" + executableName,
    "set \"EXIT_CODE=%ERRORLEVEL%\"",
    "echo.",
    "if not \"%EXIT_CODE%\"==\"0\" (",
    "  echo 程序已退出，错误码: %EXIT_CODE%",
    ") else (",
    "  echo 程序已退出。",
    ")",
    "echo.",
    "pause",
    "exit /b %EXIT_CODE%",
  ].join("\r\n");
}

function buildWindowsStopLauncher(): string {
  return [
    "@echo off",
    "setlocal",
    "chcp 65001 >nul",
    "",
    "set \"PID_FILE=%USERPROFILE%\\.claude\\channels\\wechat\\opencode-wechat.pid\"",
    "",
    "if not exist \"%PID_FILE%\" (",
    "  echo 未找到运行中的 OpenCodeWeChat。",
    "  pause",
    "  exit /b 0",
    ")",
    "",
    "set /p PID=<\"%PID_FILE%\"",
    "if \"%PID%\"==\"\" (",
    "  del \"%PID_FILE%\" >nul 2>nul",
    "  echo OpenCodeWeChat 未运行，已清理旧 pid 文件。",
    "  pause",
    "  exit /b 0",
    ")",
    "",
    "tasklist /fi \"PID eq %PID%\" | findstr /c:\"%PID%\" >nul",
    "if errorlevel 1 (",
    "  del \"%PID_FILE%\" >nul 2>nul",
    "  echo OpenCodeWeChat 未运行，已清理旧 pid 文件。",
    "  pause",
    "  exit /b 0",
    ")",
    "",
    "echo 正在停止 OpenCodeWeChat (pid=%PID%)...",
    "taskkill /pid %PID% /t >nul 2>nul",
    "timeout /t 2 /nobreak >nul",
    "tasklist /fi \"PID eq %PID%\" | findstr /c:\"%PID%\" >nul",
    "if not errorlevel 1 (",
    "  echo 进程仍在运行，强制结束...",
    "  taskkill /pid %PID% /t /f >nul 2>nul",
    ")",
    "",
    "del \"%PID_FILE%\" >nul 2>nul",
    "echo 已停止 OpenCodeWeChat。",
    "pause",
    "endlocal",
  ].join("\r\n");
}

function prepareTarget(targetKey: TargetKey, outputRoot: string) {
  const target = TARGETS[targetKey];
  const packageDir = path.join(outputRoot, target.directoryName);
  const binDir = path.join(packageDir, "bin");

  fs.rmSync(packageDir, { force: true, recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  console.log(`\n[package] 正在构建 ${target.displayName}...`);

  compileExecutable(
    target,
    "index.ts",
    path.join(binDir, target.executableName),
  );
  compileExecutable(
    target,
    "setup.ts",
    path.join(binDir, target.setupExecutableName),
  );
  compileExecutable(
    target,
    "gui/server.ts",
    path.join(binDir, target.guiExecutableName),
  );

  writeFile(
    path.join(packageDir, target.readmeName),
    buildReadme(target, targetKey),
  );
  writeFile(
    path.join(packageDir, target.envExampleName),
    buildEnvExample(targetKey),
  );

  if (isWindowsTarget(target)) {
    writeFile(
      path.join(packageDir, target.launcherName),
      buildWindowsLauncher(target.executableName),
    );
    writeFile(
      path.join(packageDir, target.setupLauncherName),
      buildWindowsLauncher(target.setupExecutableName),
    );
    writeFile(
      path.join(packageDir, target.guiLauncherName),
      buildWindowsLauncher(target.guiExecutableName),
    );
    writeFile(
      path.join(packageDir, target.stopLauncherName),
      buildWindowsStopLauncher(),
    );
  } else if (isLinuxTarget(target)) {
    writeFile(
      path.join(packageDir, target.launcherName),
      buildLinuxLauncher(target.executableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.setupLauncherName),
      buildLinuxLauncher(target.setupExecutableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.guiLauncherName),
      buildLinuxLauncher(target.guiExecutableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.stopLauncherName),
      buildLinuxStopLauncher(),
      0o755,
    );
  } else {
    writeFile(
      path.join(packageDir, target.launcherName),
      buildMacLauncher(target.executableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.setupLauncherName),
      buildMacLauncher(target.setupExecutableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.guiLauncherName),
      buildMacLauncher(target.guiExecutableName),
      0o755,
    );
    writeFile(
      path.join(packageDir, target.stopLauncherName),
      buildMacStopLauncher(),
      0o755,
    );
  }

  const zipPath = path.join(outputRoot, `${target.directoryName}.zip`);
  console.log(`[package] 正在压缩: ${path.basename(zipPath)}`);
  createZipArchive(packageDir, zipPath);
  console.log(`[package] 输出目录: ${packageDir}`);
  console.log(`[package] 压缩包: ${zipPath}`);
}

function main() {
  const { targets, outputRoot } = parseArgs(process.argv.slice(2));
  const selected = uniqueTargets(targets);
  fs.mkdirSync(outputRoot, { recursive: true });

  for (const target of selected) {
    prepareTarget(target, outputRoot);
  }

  const guidePath = path.join(outputRoot, "使用说明.txt");
  writeFile(guidePath, buildRootUsageGuide(selected));
  console.log(`[package] 分发说明: ${guidePath}`);

  console.log("\n[package] 全部完成。");
  console.log(`[package] 产物目录: ${outputRoot}`);
  for (const key of selected) {
    console.log(`  - ${TARGETS[key].directoryName}.zip`);
  }
  console.log("  - 使用说明.txt");
}

main();
