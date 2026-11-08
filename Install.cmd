@echo off
"%~dp0runtime\node.exe" "%~dp0scripts\setup.mjs" install %*
if errorlevel 1 echo Installation failed. No existing agent configuration was overwritten.
pause
