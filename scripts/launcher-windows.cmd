@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\.." >nul
set "STATE_DIR=%USERPROFILE%\.claude\channels\wechat"
set "ACCOUNT_FILE=%STATE_DIR%\account.json"
set "PID_FILE=%STATE_DIR%\opencode-wechat.pid"
set "PATH=%LOCALAPPDATA%\Programs\OpenCode\bin;%LOCALAPPDATA%\Programs\OpenCode;%USERPROFILE%\AppData\Roaming\npm;%LOCALAPPDATA%\Microsoft\WinGet\Packages;%ProgramFiles%\OpenCode\bin;%ProgramFiles%\OpenCode;%ProgramFiles(x86)%\OpenCode\bin;%ProgramFiles(x86)%\OpenCode;%PATH%"

if exist "opencode-wechat.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("opencode-wechat.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

:menu
cls
echo ========================================
echo        OpenCodeWeChat 一键启动器
echo ========================================
call :check_running
if "%RUNNING_PID%"=="" (
  echo  状态: ○ 未运行
) else (
  echo  状态: ● 运行中 pid=%RUNNING_PID%
)
if exist "%ACCOUNT_FILE%" (
  echo  账号: 已登录
) else (
  echo  账号: 未登录
)
echo ----------------------------------------
echo   1. 登录微信（扫码）
echo   2. 登出并清除本机凭据
echo   3. 启动 OpenCodeWeChat
echo   4. 停止 OpenCodeWeChat
echo   5. 打开图形控制台 GUI
echo   q. 退出
echo ----------------------------------------
set "CHOICE="
set /p "CHOICE=请选择操作: "
if "%CHOICE%"=="1" goto login
if "%CHOICE%"=="2" goto logout
if "%CHOICE%"=="3" goto start
if "%CHOICE%"=="4" goto stop
if "%CHOICE%"=="5" goto gui
if /i "%CHOICE%"=="q" goto end
goto menu

:login
call :ensure_bun
if errorlevel 1 goto pause_menu
call :check_running
if not "%RUNNING_PID%"=="" (
  echo 检测到通道正在运行，重新登录前先停止...
  call :do_stop
)
bun setup.ts
goto pause_menu

:logout
call :ensure_bun
if errorlevel 1 goto pause_menu
bun scripts\logout.ts
goto pause_menu

:start
call :check_running
if not "%RUNNING_PID%"=="" (
  echo OpenCodeWeChat 已在运行 pid=%RUNNING_PID%，无需重复启动。
  goto pause_menu
)
call :ensure_bun
if errorlevel 1 goto pause_menu
if "%OPENCODE_BIN%"=="" (
  where opencode >nul 2>nul
  if errorlevel 1 (
    echo 未找到 OpenCode CLI。请确认 opencode 在 PATH 中，或在 opencode-wechat.env 设置 OPENCODE_BIN。
    goto pause_menu
  )
)
if not exist "%ACCOUNT_FILE%" (
  echo 未找到微信凭据，先启动扫码登录...
  bun setup.ts
  if errorlevel 1 goto pause_menu
)
echo 启动 OpenCodeWeChat...（按 Ctrl+C 停止）
bun index.ts
echo.
echo OpenCodeWeChat 已退出。
goto pause_menu

:stop
call :do_stop
goto pause_menu

:gui
call :ensure_bun
if errorlevel 1 goto pause_menu
echo 启动图形控制台...（按 Ctrl+C 退出）
bun gui\server.ts
goto pause_menu

:check_running
set "RUNNING_PID="
set "RAW_PID="
if not exist "%PID_FILE%" goto :eof
set /p RAW_PID=<"%PID_FILE%"
if "%RAW_PID%"=="" goto :eof
tasklist /fi "PID eq %RAW_PID%" 2>nul | findstr /c:"%RAW_PID%" >nul
if errorlevel 1 goto :eof
set "RUNNING_PID=%RAW_PID%"
goto :eof

:ensure_bun
where bun >nul 2>nul
if errorlevel 1 (
  echo 未找到 Bun。请先安装 Bun: https://bun.sh
  exit /b 1
)
if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  bun install
  if errorlevel 1 exit /b 1
)
exit /b 0

:do_stop
call :check_running
if "%RUNNING_PID%"=="" (
  if exist "%PID_FILE%" del "%PID_FILE%" >nul 2>nul
  echo OpenCodeWeChat 当前未运行。
  goto :eof
)
echo 正在停止 OpenCodeWeChat pid=%RUNNING_PID%...
taskkill /pid %RUNNING_PID% /t >nul 2>nul
timeout /t 2 /nobreak >nul
tasklist /fi "PID eq %RUNNING_PID%" 2>nul | findstr /c:"%RUNNING_PID%" >nul
if not errorlevel 1 (
  echo 进程仍在运行，强制结束...
  taskkill /pid %RUNNING_PID% /t /f >nul 2>nul
)
del "%PID_FILE%" >nul 2>nul
echo 已停止 OpenCodeWeChat。
goto :eof

:pause_menu
echo.
pause
goto menu

:end
popd >nul
endlocal
