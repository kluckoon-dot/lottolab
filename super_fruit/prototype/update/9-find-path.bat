@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 9 - find the API HUB path
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 9 / sweeping the API HUB gateway for the right path
echo  About 30 seconds.
echo.
node fetch-hub.mjs --find > path.txt 2>&1
type path.txt
echo.
echo   Saved to path.txt - Notepad will open. Copy all of it and send it.
echo.
notepad path.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
