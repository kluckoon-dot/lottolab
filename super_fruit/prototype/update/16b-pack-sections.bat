@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 16b - pack only the five sections
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 16b / Pack ONLY the five sections
echo.
echo  16-pack.bat packs all 566,276 keywords - that came out at 82 MB,
echo  too big to upload. The screen only uses the five sections
echo  (fruit/veg, grain/nut, seafood, meat, gift sets) - about 40,000 keywords.
echo.
echo  This packs just those. Expect roughly 10 MB, about 4 MB zipped.
echo  Nothing is deleted. The other keywords stay in keywords.json untouched.
echo.
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5
echo.
echo   Result: naver-out\pack\
echo   Zip that ONE folder and send it.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
