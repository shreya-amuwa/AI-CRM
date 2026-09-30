@echo off
title Amuwa AI CRM Launcher
cd /d \%~dp0\
echo ===================================================
echo Starting Amuwa AI CRM ^& WabaStore Commerce OS
echo ===================================================
echo Opening http://localhost:3000 in your browser...
start http://localhost:3000/
npm run dev
pause
