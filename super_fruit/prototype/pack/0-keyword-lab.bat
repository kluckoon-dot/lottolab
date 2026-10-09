@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Super Fruit Keyword Lab - LIVE
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  SUPER FRUIT KEYWORD LAB - live
echo.
echo  Opens the lab in your browser and looks every keyword up
echo  on Naver the moment you search it - search volume, clicks,
echo  click rate, related keywords, and bids for rank 1-3 on PC
echo  and mobile. Same source as the Naver keyword tool.
echo.
echo  Uses the search-ad keys in key.txt. Runs only on this PC.
echo  Keep this window open while you work. Close it to stop.
echo.
node live-server.mjs --open
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
