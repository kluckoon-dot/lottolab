@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 18 - can we get product counts?
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 18 / Product count probe
echo.
echo  Competition strength = product count / monthly searches.
echo  Right now we have the searches but not the product count,
echo  so this step only asks one question: can we get it at all?
echo.
echo  It sweeps 12 candidate addresses on two hosts with one
echo  test keyword. About 15 seconds. It writes nothing unless
echo  it actually finds a number.
echo.
node fetch-hub.mjs --shop-count
echo.
echo   If it found something: naver-out\hub-shopcount.json
echo   Either way, copy the whole screen output and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
