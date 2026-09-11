@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 4 - NAVER API HUB check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 4 / NAVER API HUB
echo  Finding the right call address and auth header...
echo.
node fetch-hub.mjs --probe > hub.txt 2>&1
type hub.txt
echo.
echo  ----------------------------------------------
echo   Saved to  hub.txt
echo   Notepad will open. Copy ALL of it and send it.
echo  ----------------------------------------------
echo.
notepad hub.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
