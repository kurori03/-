@echo off
rem 回送・納車依頼ボード（Node.js版）を起動します
rem このファイルをダブルクリックしてください。閉じるとアプリも止まります。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js が見つかりません。
  echo   https://nodejs.org/ja から LTS 版をインストールしてから、
  echo   もう一度このファイルを実行してください。
  echo.
  pause
  exit /b 1
)
node server.js
pause
