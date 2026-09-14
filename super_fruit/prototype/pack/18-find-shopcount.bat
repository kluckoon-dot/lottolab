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
echo  We have the searches. The product count is the only
echo  missing piece.
echo.
echo  First run said: API HUB 404 everywhere, openapi.naver.com
echo  401. Reports say the Shopping Search API was shut down on
echo  2026-07-31 while blog/news search moved to the HUB.
echo.
echo  So this run settles it with one control. If blog/news
echo  search answers on OUR key but shopping does not, the
echo  shopping API is genuinely gone. If blog/news is ALSO 404,
echo  then 404 just means we never subscribed to Search on NCP
echo  and it is worth applying for.
echo.
echo  Do NOT go to developers.naver.com - the search options are
echo  no longer in that dropdown. That path is closed.
echo.
node fetch-hub.mjs --shop-count
echo.
echo   Copy the whole screen output and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
