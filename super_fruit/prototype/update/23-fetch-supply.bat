@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 23 - supplier open APIs
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "suppliers.json" goto nocfg
echo.
echo  STEP 23 / Pull supply prices from supplier open APIs
echo.
echo  Reads suppliers.json and calls every supplier you enabled.
echo  Results merge with whatever STEP 22 read from files.
echo.
echo  IF YOU DO NOT KNOW THE RESPONSE SHAPE:
echo  run the probe first. It calls each API once, finds where
echo  the product array lives, prints the field names, and
echo  guesses the mapping. It saves nothing.
echo.
echo      node fetch-supply.mjs --probe
echo.
echo  Send that output and the mapping gets filled in for you.
echo.
node fetch-supply.mjs
echo.
echo   Result: naver-out\supply.json
echo   Then run 16b-pack-sections.bat and send the pack folder.
echo.
pause
exit /b
:nocfg
echo.
echo  [X] suppliers.json not found.
echo.
echo      Copy suppliers.example.json, rename it to
echo      suppliers.json, and fill in your API keys.
echo.
echo      Keep it to yourself - it holds your keys, and it is
echo      never included in the zips that get sent back.
echo.
notepad suppliers.example.json
pause
exit /b
:nonode
echo  [X] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
