@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Super Fruit Keyword Lab - LIVE
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  SUPER FRUIT KEYWORD LAB - live
echo.
echo  Opens the lab in your browser and looks every keyword up
echo  on Naver the moment you search it.
echo  Excel files in the inbox folder are read automatically.
echo.
echo  Keep this window open while you work. Close it to stop.
echo.
node live-server.mjs --open
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
