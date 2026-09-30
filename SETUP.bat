@echo off
REM Setup Script for Amuwa CRM - Enhanced HR Dashboard
REM This script will install all dependencies and start the development server

echo.
echo ============================================
echo   Amuwa CRM - Enhanced HR Dashboard Setup
echo ============================================
echo.

REM Clear npm cache
echo Clearing npm cache...
call npm cache clean --force
if errorlevel 1 goto error

echo.
echo Installing dependencies... (This may take 2-5 minutes)
echo.

REM Install dependencies
call npm install
if errorlevel 1 goto error

echo.
echo ============================================
echo   ✓ Installation Complete!
echo ============================================
echo.
echo Starting development server...
echo.
echo Open your browser and go to:
echo   → http://localhost:3000
echo.

REM Start development server
call npm run dev
if errorlevel 1 goto error

goto end

:error
echo.
echo ✗ ERROR: Setup failed!
echo Please try the manual steps:
echo   1. Delete node_modules folder
echo   2. Delete package-lock.json
echo   3. Run: npm cache clean --force
echo   4. Run: npm install
echo   5. Run: npm run dev
echo.
pause
exit /b 1

:end
pause
