@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 19 - collect product counts
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "naver-out\hub-shopcount.json" goto noprobe
if not exist "naver-out\section-keywords.txt" goto nolist
echo.
echo  STEP 19 / Collect product counts
echo.
echo  Reads the address that STEP 18 found, then fills in the
echo  product count for every keyword the site actually shows,
echo  biggest search volume first.
echo.
echo  Daily cap is 24,000 calls. If it stops, just run this
echo  file again tomorrow - it picks up where it left off.
echo.
node fetch-hub.mjs --shop-count-all
echo.
echo   Result: naver-out\shopcount.json
echo.
pause
exit /b
:noprobe
echo.
echo  [!] Run 18-find-shopcount.bat first.
echo      Without it we do not know which address to call.
echo.
pause
exit /b
:nolist
echo.
echo  [!] Run 16b-pack-sections.bat first.
echo      It writes naver-out\section-keywords.txt, the target list.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
