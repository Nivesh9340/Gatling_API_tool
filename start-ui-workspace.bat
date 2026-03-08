@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%"

echo Starting Gatling UI workspace...
call "%ROOT%check-prerequisites.bat"
if errorlevel 1 (
  echo Prerequisite check failed. Fix issues above, then retry.
  popd
  endlocal
  exit /b 1
)
start "" "%ROOT%run-ui-backend.bat"
timeout /t 3 /nobreak >nul
start "" "%ROOT%ui\index.html"

popd
endlocal
