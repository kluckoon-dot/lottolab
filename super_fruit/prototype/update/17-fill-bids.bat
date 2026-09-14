@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 17 - fill the missing bids
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 17 / Fill in the missing bid prices
echo.
echo  419,049 keywords, but only 190,832 have a bid price.
echo  Filling all of them takes about 9 hours.
echo  This fills only the 9,660 that are actually on the screen:
echo    about 1,932 calls, roughly 25 minutes.
echo.
echo  Search-ad API is free - this does NOT touch the API HUB monthly quota.
echo  Resumable: rerun any time and it picks up where it stopped.
echo.
node fetch-naver.mjs --bids-only --only bids-todo.txt
echo.
echo   Then run 16-pack.bat again and send the pack folder.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
