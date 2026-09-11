@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 1 - connection check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 1 / connection check
echo.
node fetch-naver.mjs --probe > probe.txt 2>&1
type probe.txt
echo.
echo   Saved to probe.txt - Notepad will open. Copy all of it and send it.
echo.
notepad probe.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
