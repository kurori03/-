@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ============================================================
rem  まとめて実行.bat
rem  jobs フォルダにあるバッチを、ファイル名の順番に1つずつ実行します。
rem  ・共有フォルダ（\\サーバー名\...）に置いたままダブルクリックで動きます
rem  ・別のPCで実行中のときは、二重に動かないよう開始を止めます
rem  ・実行結果は logs フォルダに記録します
rem  ・タスクスケジューラから動かすときは引数に /auto を付けます（最後に止まりません）
rem ============================================================

set "AUTO="
if /i "%~1"=="/auto" set "AUTO=1"
set "LOG_DISP_DIR=%~dp0logs"

rem --- このバッチの場所に移動（共有フォルダは一時的にドライブ文字を割り当て）---
pushd "%~dp0" || (echo [エラー] フォルダに移動できません: %~dp0& goto :end_nolock)
set "BASE=%CD%"
if "%BASE:~-1%"=="\" set "BASE=%BASE:~0,-1%"

rem --- 共通設定 ---
set "STOP_ON_ERROR=1"
if exist "%BASE%\設定.bat" call "%BASE%\設定.bat"

if not exist "%BASE%\jobs\*.bat" (
  echo [エラー] jobs フォルダに実行するバッチがありません。
  popd
  goto :end_nolock
)

rem --- ログファイル ---
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
if not exist "%BASE%\logs" mkdir "%BASE%\logs"
set "LOGNAME=%TS%_%COMPUTERNAME%.log"
set "LOG=%BASE%\logs\%LOGNAME%"

rem --- 二重起動の防止（フォルダの作成は同時に1台しか成功しない）---
set "LOCK=%BASE%\実行中.lock"
mkdir "%LOCK%" 2>nul
if errorlevel 1 goto :locked
> "%LOCK%\info.txt" echo 実行者: %USERNAME%  PC: %COMPUTERNAME%  開始: %TS%

set /a OK=0, NG=0, N=0
call :log "===== 開始  実行者: %USERNAME%  PC: %COMPUTERNAME% ====="

for /f "delims=" %%F in ('dir /b /a-d /on "%BASE%\jobs\*.bat"') do (
  call :run_job "%%F"
  if errorlevel 1 if "%STOP_ON_ERROR%"=="1" (
    call :log "エラーのため、以降のバッチは実行しません。"
    goto :finish
  )
)

:finish
call :log "===== 終了  成功 %OK% 件 / 失敗 %NG% 件 ====="
rmdir /s /q "%LOCK%" 2>nul
popd
echo.
echo ログ: %LOG_DISP_DIR%\%LOGNAME%
if %NG% gtr 0 echo [注意] 失敗したバッチがあります。ログを確認してください。
if not defined AUTO pause
exit /b %NG%

:locked
echo [中止] 別のPCで実行中のため、開始できません。
if exist "%LOCK%\info.txt" type "%LOCK%\info.txt"
echo.
echo 誰も実行していないのにこの表示が出る場合は、前回の実行が途中で止まっています。
echo 次のフォルダを削除してから、もう一度実行してください:
echo   %~dp0実行中.lock
popd
if not defined AUTO pause
exit /b 1

:end_nolock
if not defined AUTO pause
exit /b 1

rem ------------------------------------------------------------
rem  1つのバッチを実行する
rem ------------------------------------------------------------
:run_job
set /a N+=1
set "JOB=%~1"
call :log "[%N%] 開始: %JOB%"
pushd "%BASE%\jobs"
cmd /c ""%BASE%\jobs\%JOB%""
set "RC=%errorlevel%"
popd
if "%RC%"=="0" (
  set /a OK+=1
  call :log "[%N%] 正常終了: %JOB%"
  exit /b 0
)
set /a NG+=1
call :log "[%N%] エラー 終了コード %RC%: %JOB%"
exit /b 1

rem ------------------------------------------------------------
rem  画面とログの両方に書く
rem ------------------------------------------------------------
:log
echo [%date% %time:~0,8%] %~1
>> "%LOG%" echo [%date% %time:~0,8%] %~1
exit /b 0
