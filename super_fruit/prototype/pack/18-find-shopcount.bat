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
echo  We already have the searches. The product count is the
echo  only missing piece, so this step asks one question:
echo  can we get it at all?
echo.
echo  It sweeps 12 candidate addresses on two hosts with one
echo  test keyword. About 15 seconds. It writes nothing unless
echo  it actually finds a number.
echo.
echo  NOTE - the Search API uses a DIFFERENT key pair than the
echo  API HUB. If this step tells you to add SEARCH_ID and
echo  SEARCH_SECRET to key.txt, get them here (free, 5 min):
echo.
echo    1. https://developers.naver.com/apps/#/register
echo    2. Application name: anything. Check "검색".
echo    3. Environment: "WEB 설정", URL http://localhost
echo    4. Copy the Client ID and Client Secret it gives you.
echo    5. Open key.txt in Notepad, add two lines:
echo         SEARCH_ID=the Client ID
echo         SEARCH_SECRET=the Client Secret
echo    6. Save, then run this file again.
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
