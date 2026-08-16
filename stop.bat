@echo off
setlocal
cd /d "%~dp0"
if not exist ".runtime\server.pid" (
  echo The local Whisper service is not running.
  pause
  exit /b 0
)
set /p DICTATION_PID=<".runtime\server.pid"
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%DICTATION_PID%' -ErrorAction SilentlyContinue; if ($p -and ($p.CommandLine -like '*server.py*')) { Stop-Process -Id %DICTATION_PID% -Force; exit 0 }; exit 1"
if errorlevel 1 (
  echo The saved process no longer belongs to Dictation. Nothing was stopped.
) else (
  del /q ".runtime\server.pid" >nul 2>nul
  echo The local Whisper service has stopped.
)
pause
