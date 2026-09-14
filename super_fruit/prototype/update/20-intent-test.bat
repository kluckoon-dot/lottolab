@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 20 - can 지식iN doc counts tell shopping from info?
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 20 / Intent separation test
echo.
echo  The Shopping Search API is gone, so competition strength
echo  cannot be rebuilt. But the other problem - golden keywords
echo  coming out as recipes and health tips - may still be fixable.
echo.
echo  Four ideas were measured and all four failed:
echo    ad presence      info keywords have ads too (100%% false)
echo    bid level        920 vs 1,230 won - 1.3x, not enough
echo    shopping insight 90%% vs 100%% once volume is controlled
echo    shop click ratio direction flips - gift sets score LOWER
echo.
echo  Fifth idea: 지식iN document counts. People ASK about
echo  "콜라비효능". Nobody asks about "한우선물세트".
echo.
echo  This is a hypothesis, not a promise. So it is measured on
echo  80 keywords first - 80 calls, under a minute - before any
echo  thought of spending 42,000.
echo.
echo  FIRST: in NCP console, API HUB, Application, edit your
echo  application and tick 지식iN, then save. Same key, no
echo  new key needed. Then run this.
echo.
node fetch-hub.mjs --intent-test --api kin
echo.
echo   Copy the whole screen output and send it.
echo   (To try a different one: --api blog / cafe / webkr)
echo.
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
