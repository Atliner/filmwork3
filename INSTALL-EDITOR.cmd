@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "scripts\editor-installer.mjs" goto missing_files
if not exist "worker.js" goto missing_files
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install the current LTS from https://nodejs.org
  pause
  exit /b 1
)
node scripts/editor-installer.mjs
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%

:missing_files
echo This launcher needs the WHOLE project, not just this CMD file.
echo Download the project ZIP from GitHub, Extract All, then run this file inside that folder.
echo Required: worker.js and scripts\editor-installer.mjs beside this launcher.
pause
exit /b 1
