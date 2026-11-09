@echo off
REM Bloom & Brew Cafe POS - local server
REM 1) Start MySQL in the XAMPP Control Panel first.
REM 2) Run this file, then open http://localhost:8000 in your browser.
cd /d "%~dp0"
echo Bloom ^& Brew POS running at http://localhost:8000  (Ctrl+C to stop)
"C:\xampp\php\php.exe" -S localhost:8000
