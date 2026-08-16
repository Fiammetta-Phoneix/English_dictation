@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Whisper is not installed yet. Running setup first...
  call setup.bat
  if errorlevel 1 exit /b 1
)

rem If our local service is already healthy, simply open the app.
curl.exe --noproxy "*" -fsS http://127.0.0.1:8767/api/health >nul 2>nul
if not errorlevel 1 goto :open

rem Run Whisper in the background so closing this window will not stop it.
if not exist ".runtime" mkdir ".runtime"
powershell -NoProfile -Command "Start-Process -FilePath (Resolve-Path '.venv\Scripts\python.exe') -ArgumentList 'server.py' -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput '.runtime\server-out.log' -RedirectStandardError '.runtime\server-error.log'"

echo Starting local Whisper service...
for /l %%i in (1,1,30) do (
  curl.exe --noproxy "*" -fsS http://127.0.0.1:8767/api/health >nul 2>nul
  if not errorlevel 1 goto :open
  powershell -NoProfile -Command "Start-Sleep -Milliseconds 300" >nul
)

echo.
echo The local service could not start.
echo Please run stop.bat once, then try start.bat again.
pause
exit /b 1

:open
start "" http://127.0.0.1:8767
exit /b 0
