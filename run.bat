@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3 -m venv .venv || python -m venv .venv
)
if not exist .venv\Scripts\python.exe (
  echo Python 3.10 or newer was not found. Install it from python.org and run this again.
  pause
  exit /b 1
)
echo Installing requirements...
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r backend\requirements.txt || (pause & exit /b 1)
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r backend\requirements-vision.txt || echo Hazard detector not installed. Everything else still works.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:8000/#demo"
echo Starting GuideEye on http://localhost:8000  (Ctrl+C to stop)
.venv\Scripts\python -m uvicorn backend.app.main:app --port 8000
pause
