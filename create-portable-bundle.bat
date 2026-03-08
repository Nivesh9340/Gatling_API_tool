@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%"

set "DIST_DIR=%ROOT%dist"
set "STAMP=%date:~-4%%date:~4,2%%date:~7,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "STAMP=%STAMP: =0%"
set "ZIP_FILE=%DIST_DIR%\gatling-api-tool-%STAMP%.zip"
set "LATEST_FILE=%DIST_DIR%\latest-bundle.txt"
set "CHECKSUM_FILE=%DIST_DIR%\latest-bundle.sha256"
set "MVN_CMD="

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

if not exist "target\ui-gateway-backend.jar" (
  call :resolve_maven
  if errorlevel 1 (
    if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
      jar --version >nul 2>nul
      if not errorlevel 1 (
        echo Maven unavailable; building backend jar from existing compiled classes...
        jar --create --file "target\ui-gateway-backend.jar" --main-class com.example.gatling.ui.UiGatewayServer -C target\classes .
      )
    )
    if not exist "target\ui-gateway-backend.jar" (
      echo Backend jar not found and Maven unavailable.
      echo Build it first, then re-run create-portable-bundle.bat.
      popd
      endlocal
      exit /b 1
    )
    goto package_bundle
  )
  echo Building backend runtime jar for bundle...
  call "%MVN_CMD%" -q -DskipTests package
  if errorlevel 1 (
    echo Failed to build backend runtime jar.
    popd
    endlocal
    exit /b 1
  )
)

:package_bundle
if not exist "target\ui-gateway-backend.jar" (
  echo Expected runtime jar not found at target\ui-gateway-backend.jar.
  popd
  endlocal
  exit /b 1
)

if exist "%ZIP_FILE%" del "%ZIP_FILE%" >nul 2>nul
jar --create --file "%ZIP_FILE%" ^
  -C . .github ^
  -C . .mvn ^
  -C . config ^
  -C . scripts ^
  -C . src ^
  -C . ui ^
  -C . target\ui-gateway-backend.jar ^
  -C . pom.xml ^
  -C . mvnw ^
  -C . mvnw.cmd ^
  -C . README.md ^
  -C . Jenkinsfile ^
  -C . run-test.bat ^
  -C . run-ui-backend.bat ^
  -C . check-prerequisites.bat ^
  -C . build-release.bat ^
  -C . start-ui-workspace.bat
if errorlevel 1 (
  echo Failed to create portable bundle archive.
  popd
  endlocal
  exit /b 1
)

> "%LATEST_FILE%" echo %ZIP_FILE%
java "%ROOT%scripts\Sha256File.java" "%ZIP_FILE%" > "%CHECKSUM_FILE%"
if errorlevel 1 (
  echo Bundle created, but checksum generation failed.
) else (
  echo SHA-256 checksum written to:
  echo %CHECKSUM_FILE%
)

echo Portable bundle created:
echo %ZIP_FILE%
popd
endlocal
exit /b 0

:resolve_maven
where mvn.cmd >nul 2>nul
if not errorlevel 1 (
  set "MVN_CMD=mvn.cmd"
  exit /b 0
)

where mvn >nul 2>nul
if not errorlevel 1 (
  set "MVN_CMD=mvn"
  exit /b 0
)

if exist "%ROOT%mvnw.cmd" (
  where powershell >nul 2>nul
  if not errorlevel 1 (
    set "MVN_CMD=%ROOT%mvnw.cmd"
    exit /b 0
  )
)

exit /b 1
