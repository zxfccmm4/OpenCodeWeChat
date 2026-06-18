@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\.." >nul
set "PATH=%LOCALAPPDATA%\Programs\OpenCode\bin;%LOCALAPPDATA%\Programs\OpenCode;%USERPROFILE%\AppData\Roaming\npm;%LOCALAPPDATA%\Microsoft\WinGet\Packages;%ProgramFiles%\OpenCode\bin;%ProgramFiles%\OpenCode;%ProgramFiles(x86)%\OpenCode\bin;%ProgramFiles(x86)%\OpenCode;%PATH%"

if exist "opencode-wechat.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("opencode-wechat.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

where bun >nul 2>nul
if errorlevel 1 (
  echo 未找到 Bun。请先安装 Bun: https://bun.sh
  pause
  popd >nul
  exit /b 1
)

if "%OPENCODE_BIN%"=="" (
  where opencode >nul 2>nul
  if errorlevel 1 (
    echo 未找到 OpenCode CLI。
    echo.
    echo 请先在 Windows 上安装 OpenCode，并确认 opencode.cmd 或 opencode.exe 在 PATH 中。
    echo 如果已经安装但仍然找不到，请在本目录创建 opencode-wechat.env，并写入：
    echo OPENCODE_BIN=C:\Users\你的用户名\AppData\Roaming\npm\opencode.cmd
    echo.
    echo 常见路径还包括：
    echo   %%LOCALAPPDATA%%\Programs\OpenCode\bin\opencode.cmd
    echo   %%USERPROFILE%%\AppData\Roaming\npm\opencode.cmd
    pause
    popd >nul
    exit /b 1
  )
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  bun install
  if errorlevel 1 (
    pause
    popd >nul
    exit /b 1
  )
)

if not exist "%USERPROFILE%\.claude\channels\wechat\account.json" (
  echo 未找到微信凭据，先启动扫码登录...
  bun setup.ts
  if errorlevel 1 (
    pause
    popd >nul
    exit /b 1
  )
)

echo 启动 OpenCodeWeChat...
bun index.ts

popd >nul
endlocal
