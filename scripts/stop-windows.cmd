@echo off
setlocal
chcp 65001 >nul

set "PID_FILE=%USERPROFILE%\.claude\channels\wechat\opencode-wechat.pid"

if not exist "%PID_FILE%" (
  echo 未找到运行中的 OpenCodeWeChat。
  pause
  exit /b 0
)

set /p PID=<"%PID_FILE%"
if "%PID%"=="" (
  del "%PID_FILE%" >nul 2>nul
  echo OpenCodeWeChat 未运行，已清理旧 pid 文件。
  pause
  exit /b 0
)

tasklist /fi "PID eq %PID%" | findstr /r /c:"^[^ ]" | findstr /c:"%PID%" >nul
if errorlevel 1 (
  del "%PID_FILE%" >nul 2>nul
  echo OpenCodeWeChat 未运行，已清理旧 pid 文件。
  pause
  exit /b 0
)

echo 正在停止 OpenCodeWeChat (pid=%PID%)...
taskkill /pid %PID% /t >nul 2>nul
timeout /t 2 /nobreak >nul
tasklist /fi "PID eq %PID%" | findstr /c:"%PID%" >nul
if not errorlevel 1 (
  echo 进程仍在运行，强制结束...
  taskkill /pid %PID% /t /f >nul 2>nul
)

del "%PID_FILE%" >nul 2>nul
echo 已停止 OpenCodeWeChat。
pause
endlocal
