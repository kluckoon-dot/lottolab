@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 6 - can we get seeds from Naver itself
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 6 / checking whether Naver can hand us the seed list
echo.
echo  === SEARCH AD === > raw.txt
node fetch-naver.mjs --raw >> raw.txt 2>&1
echo. >> raw.txt
echo  === API HUB === >> raw.txt
node fetch-hub.mjs --probe >> raw.txt 2>&1
type raw.txt
echo.
echo   Saved to raw.txt - Notepad will open. Copy all of it and send it.
echo.
notepad raw.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
