@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-material-review.ps1" -Catalog
if errorlevel 1 pause
