@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 22 - supplier price sheets
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "supply" mkdir supply
echo.
echo  STEP 22 / Supplier price comparison
echo.
echo  Put the price sheets your suppliers publish into the
echo  "supply" folder next to this file. xlsx and csv both work.
echo.
echo  Name each file after the supplier - the part before the
echo  first underscore becomes the supplier name:
echo      ongreen_20260916.xlsx   -^>  ongreen
echo.
echo  It does NOT need a fixed column layout. It finds the
echo  product-name and price columns by name, and if the sheet
echo  has no header row at all it works them out from content.
echo.
echo  WHAT IT SOLVES:
echo    Suppliers write the same thing differently. One says
echo    "6 fruit per 2kg" is large, another says 8 per 2kg is
echo    large. The word is useless. So it reads the NUMBERS
echo    and computes grams-per-fruit and won-per-kg, then
echo    re-grades every listing on those alone.
echo.
dir /b supply\*.xlsx supply\*.csv >nul 2>nul
if errorlevel 1 goto nofile
node parse-supply.mjs
echo.
echo   Result: naver-out\supply.json
echo   Then run 16b-pack-sections.bat and send the pack folder.
echo.
pause
exit /b
:nofile
echo  [X] The "supply" folder is empty.
echo      Put your supplier price sheets in there first.
echo      The folder has been created for you.
echo.
start "" "%~dp0supply"
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
