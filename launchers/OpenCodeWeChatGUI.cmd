@echo off
setlocal
chcp 65001 >nul

pushd "%~dp0.." >nul

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

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  bun install
  if errorlevel 1 (
    pause
    popd >nul
    exit /b 1
  )
)

bun gui\server.ts

popd >nul
endlocal
