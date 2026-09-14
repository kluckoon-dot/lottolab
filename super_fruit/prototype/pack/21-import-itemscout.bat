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
echo    1. In ItemScout, open 연관키워드 for a keyword you care
echo       about and use its download / export button.
echo    2. If it gives you .xlsx, open it in Excel and save as
echo       "CSV UTF-8". The importer reads CSV, not xlsx.
echo    3. Drop the .csv files into THIS folder.
echo    4. Run this file.
echo.
echo  Column names are detected automatically, Korean or English,
echo  in any order. Re-running merges - newest file wins.
echo.
setlocal enabledelayedexpansion
set FOUND=
for %%f in (*.csv) do set FOUND=1
if not defined FOUND goto nocsv
node import-itemscout.mjs *.csv
echo.
echo   Result: naver-out\shopcount.json
echo   Then run 16b-pack-sections.bat to put it on screen.
echo.
pause
exit /b
:nocsv
echo  [!] No .csv file in this folder.
echo      Put your ItemScout export here first.
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
