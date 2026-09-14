@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 21 - import ItemScout export
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 21 / Import an ItemScout export
echo.
echo  The Shopping Search API shut down on 2026-07-31, so there
echo  is no official source for product counts any more.
echo.
echo  One legitimate route is left: the file YOU download from
echo  YOUR OWN ItemScout account. That is your data, exported
echo  through their own export button - not scraping their site.
echo.
echo  HOW:
echo    1. In ItemScout, open the related-keyword tab and
echo       press its download button.
echo    2. Drop the file into THIS folder. xlsx works as-is -
echo       no need to convert it to CSV any more.
echo    3. Run this file.
echo.
echo  Column names are detected automatically, Korean or English,
echo  in any order. Re-running merges - newest file wins.
echo  It also picks up the category and the shopping/info label.
echo.
dir /b *.xlsx *.csv >nul 2>nul
if errorlevel 1 goto nofile
node import-itemscout.mjs *.xlsx *.csv
echo.
echo   Result: naver-out\shopcount.json
echo   Then run 16b-pack-sections.bat to put it on screen.
echo.
pause
exit /b
:nofile
echo  [X] No .xlsx or .csv file in this folder.
echo      Put your ItemScout download here first.
echo.
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
