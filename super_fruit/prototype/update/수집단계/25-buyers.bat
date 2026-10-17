@echo off
chcp 65001 >nul
cd /d "%~dp0..\app"
title Shopping buyers - device, gender, age, weekday
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  Shopping buyers for the stored screen data (Naver Shopping Insight, food, last 1 year)
echo    weekday click share  - every keyword
echo    device / gender / age - biggest buying keywords first
echo.
echo  Uses up to 9,000 API HUB calls per run (monthly cap is 50,000).
echo  It continues where it stopped. Run it again next month for the rest.
echo.
node refresh-buyers.mjs --max-calls 9000
if errorlevel 1 goto fail
echo.
echo  Packing the five sections with the new values
node --max-old-space-size=8192 pack-data.mjs --section 1,2,3,4,5,6
if errorlevel 1 goto fail
node build-web.mjs ..\naver-out\pack .
if errorlevel 1 goto fail
echo.
echo   Done. Open "1" - buyer cards now show for more keywords.
echo.
pause
exit /b
:fail
echo.
echo  [X] Stopped with an error. Send the text above.
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
pause
