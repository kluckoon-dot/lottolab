@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 5 - NAVER API HUB check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 5 / NAVER API HUB
echo  Finding the call address and auth header...
echo.
node fetch-hub.mjs --probe > hub.txt 2>&1
type hub.txt
echo.
echo   Saved to hub.txt - Notepad will open. Copy all of it and send it.
echo.
notepad hub.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
