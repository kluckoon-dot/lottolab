@echo off
chcp 65001 >nul
cd /d "%~dp0"
title STEP 8 - find the Naver keys on this PC
where node >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo  STEP 8 / looking for Naver credentials on this PC
echo.
echo  Drag the project folder onto this window and press Enter,
echo  or just press Enter to use the default path.
echo.
set "TARGET=%USERPROFILE%\Downloads\3. 판매상품\상세페이지_참고\saengsaeng-agri-command"
set /p "IN=folder: "
if not "%IN%"=="" set "TARGET=%IN%"
set "TARGET=%TARGET:"=%"
echo.
node find-keys.mjs "%TARGET%" > keys-found.txt 2>&1
type keys-found.txt
echo.
echo  ----------------------------------------------
echo   Values are masked. keys-found.txt is safe to send.
echo  ----------------------------------------------
echo.
notepad keys-found.txt
pause
exit /b
:nonode
echo  [!] Node.js is not installed. https://nodejs.org
start https://nodejs.org/ko
pause
