#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHANNEL_VERSION } from "../config";

type TargetKey = "macos-arm64" | "macos-x64" | "windows-x64";

interface PackageTarget {
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
  "windows-x64": {
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
      "  windows-x64",
      "",
      "示例:",
      "  bun scripts/package-app.ts",
      "  bun scripts/package-app.ts --target macos-arm64 --target windows-x64",
    ].join("\n"),
  );
  process.exit(0);
}

function detectDefaultTarget(): TargetKey {
  if (process.platform === "darwin") {
    return process.arch === "x64" ? "macos-x64" : "macos-arm64";
  }
  if (process.platform === "win32") {
    return "windows-x64";
  }
  throw new Error(
    "当前系统不支持 package:current。请在 macOS 或 Windows 上运行，或显式传入 --target。",
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
  return target.compileTarget.startsWith("bun-darwin-");
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
  if (targetKey === "windows-x64") {
    return [
      "# 可选：固定使用 OMO / Sisyphus agent",
      "# OPENCODE_AGENT=omo",
      "",
      "# 可选：指定 OpenCode CLI 的绝对路径",
      "# OPENCODE_BIN=C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\opencode.cmd",
      "# OPENCODE_BIN=C:\\Users\\你的用户名\\AppData\\Local\\Programs\\OpenCode\\bin\\opencode.cmd",
      "",
      "# 可选：固定 provider/model。通常建议留空，让 OpenCode / OMO 按自己的配置选择模型",
      "# OPENCODE_PROVIDER_ID=github-copilot",
      "# OPENCODE_MODEL_ID=claude-sonnet-4.6",
      "",
      "# 可选：长回复最终发送时每条微信文本的最大字符数",
      "# OPENCODE_WECHAT_TEXT_CHUNK_CHARS=500",
    ].join("\r\n");
  }

  return [
    "# 可选：固定使用 OMO / Sisyphus agent",
    "# OPENCODE_AGENT=omo",
    "",
    "# 可选：指定 OpenCode CLI 的绝对路径",
    "# OPENCODE_BIN=/opt/homebrew/bin/opencode",
    "",
    "# 可选：固定 provider/model。通常建议留空，让 OpenCode / OMO 按自己的配置选择模型",
    "# OPENCODE_PROVIDER_ID=github-copilot",
    "# OPENCODE_MODEL_ID=claude-sonnet-4.6",
    "",
    "# 可选：长回复最终发送时每条微信文本的最大字符数",
    "# OPENCODE_WECHAT_TEXT_CHUNK_CHARS=500",
  ].join("\n");
}

function buildReadme(target: PackageTarget, targetKey: TargetKey): string {
  const launcher = target.launcherName;
  const setupLauncher = target.setupLauncherName;
  const stopLauncher = target.stopLauncherName;
  const credentialsPath = targetKey === "windows-x64"
    ? "%USERPROFILE%\\.claude\\channels\\wechat"
    : "~/.claude/channels/wechat";

  return [
    `OpenCodeWeChat 一键启动包 (${target.displayName})`,
    "",
    `1. 双击 ${launcher} 启动通道。`,
    "2. 如果当前机器还没有微信凭据，程序会自动显示二维码并等待扫码。",
    `3. 如果只想重新扫码登录，可以双击 ${setupLauncher}。`,
    `4. 如果要停止正在运行的通道，可以双击 ${stopLauncher}。`,
    `5. 推荐使用图形控制台：双击 ${target.guiLauncherName}，浏览器会自动打开，支持启动/停止/扫码登录/登出和实时日志。`,
    "6. 如需自定义 agent / model / OpenCode CLI 路径，可复制 opencode-wechat.env.example 为 opencode-wechat.env 后再启动。",
    "",
    "运行前提：",
    "- 已安装 OpenCode，且 `opencode` 命令可用。Windows 如果找不到 opencode，可在 opencode-wechat.env 设置 OPENCODE_BIN。",
    "- 已在本机完成 OpenCode 登录。",
    "",
    `凭据目录：${credentialsPath}`,
  ].join(target.lineEnding);
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

  if (targetKey === "windows-x64") {
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

  console.log(`[package] 输出目录: ${packageDir}`);
}

function main() {
  const { targets, outputRoot } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outputRoot, { recursive: true });

  for (const target of uniqueTargets(targets)) {
    prepareTarget(target, outputRoot);
  }

  console.log("\n[package] 全部完成。");
}

main();
