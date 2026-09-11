@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Naver keyword collector - STEP 1 check
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 1 / check   -  please wait...
echo.
node fetch-naver.mjs --probe > probe.txt 2>&1
type probe.txt
echo.
echo  ----------------------------------------------
echo   Saved to  probe.txt
echo   Notepad will open. Copy ALL of it and send it.
echo  ----------------------------------------------
echo.
notepad probe.txt
pause
exit /b
:nonode
echo.
echo  [!] Node.js is not installed on this PC.
echo      A download page will open. Install the LTS version,
echo      then run this file again.
echo.
start https://nodejs.org/ko
pause
