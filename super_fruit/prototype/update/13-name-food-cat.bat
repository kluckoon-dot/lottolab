@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 13 - name the food sub-categories (OPTIONAL)
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 13 / Name the food sub-category IDs   *** OPTIONAL ***
echo.
echo  Step 12 found 58 live IDs but cannot say what any of them ARE.
echo  This asks, for each ID, which food keywords actually live inside it.
echo.
echo  Cost: about 750 calls out of the 30,000 monthly free tier.
echo  Skip this for now if you would rather spend the budget on step 11.
echo  Everything works on 50000006 (food) alone - this only adds precision.
echo.
pause
node fetch-hub.mjs --cat --scan 50000140-50000200 --name --probe food --name-limit 60
echo.
echo   Result: naver-out\hub-cat-identity.json
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
