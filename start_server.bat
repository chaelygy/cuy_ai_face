@echo off
title CUY AI - Royal Amethyst Biometrics Launcher
color 0D
cd /d "%~dp0"
python launcher.py
if errorlevel 1 pause
