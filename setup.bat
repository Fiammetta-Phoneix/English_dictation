@echo off
setlocal
set "BUNDLED_PYTHON=C:\Users\刘彤\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%BUNDLED_PYTHON%" set "BUNDLED_PYTHON=python"
if not exist ".venv\Scripts\python.exe" "%BUNDLED_PYTHON%" -m venv .venv
if errorlevel 1 goto :error
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
call ".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error
echo.
echo Setup complete. You can now run start.bat.
pause
exit /b 0
:error
echo.
echo Setup failed. Please check the message above.
pause
exit /b 1
