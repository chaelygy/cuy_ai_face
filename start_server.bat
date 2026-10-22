@echo off
title CUY AI - Royal Amethyst Biometrics Launcher
color 0D
cd /d "%~dp0"

set PYTHONUNBUFFERED=1

:: Deteksi python yang tersedia di sistem
set "PY_CMD=python"
where python >nul 2>&1
if errorlevel 1 (
    if exist "C:\Python314\python.exe" (
        set "PY_CMD=C:\Python314\python.exe"
    ) else if exist "C:\Python312\python.exe" (
        set "PY_CMD=C:\Python312\python.exe"
    ) else if exist "C:\Python311\python.exe" (
        set "PY_CMD=C:\Python311\python.exe"
    ) else if exist "C:\Python310\python.exe" (
        set "PY_CMD=C:\Python310\python.exe"
    ) else (
        echo [ERROR] Python tidak terdeteksi di PATH!
        echo Pastikan Python 3.10+ sudah terinstal.
        echo.
        pause
        exit /b 1
    )
)

echo ========================================================
echo   CUY AI // ROYAL AMETHYST BIOMETRIC SYSTEM
echo   Menjalankan launcher server...
echo ========================================================
echo.

%PY_CMD% launcher.py

if errorlevel 1 (
    echo.
    echo [ERROR] Launcher berhenti dengan error.
    pause
)
