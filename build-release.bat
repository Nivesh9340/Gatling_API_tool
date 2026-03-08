@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "DIST_DIR=%ROOT%dist"
set "LATEST_FILE=%DIST_DIR%\latest-bundle.txt"
set "CHECKSUM_FILE=%DIST_DIR%\latest-bundle.sha256"

pushd "%ROOT%"

echo Running prerequisite checks...
call "%ROOT%check-prerequisites.bat"
if errorlevel 1 (
  echo Release build aborted: prerequisite checks failed.
  popd
  endlocal
  exit /b 1
)

echo.
echo Creating portable bundle...
call "%ROOT%create-portable-bundle.bat"
if errorlevel 1 (
  echo Release build failed during bundle creation.
  popd
  endlocal
  exit /b 1
)

echo.
set "BUNDLE_PATH=Latest bundle file pointer was not created."
if exist "%LATEST_FILE%" (
  for /f "usebackq delims=" %%I in ("%LATEST_FILE%") do set "BUNDLE_PATH=%%I"
)
echo Latest bundle:
echo !BUNDLE_PATH!

if exist "%CHECKSUM_FILE%" (
  echo Checksum file:
  echo %CHECKSUM_FILE%
) else (
  echo Checksum file was not created.
)

popd
endlocal
exit /b 0
