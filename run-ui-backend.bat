@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%"

set "BACKEND_JAR=target\ui-gateway-backend.jar"
set "MVN_CMD=%~1"
set "JAVA_OPTS=%JAVA_OPTS%"
if not "%UI_PORT%"=="" set "JAVA_OPTS=%JAVA_OPTS% -Dui.port=%UI_PORT%"
if not "%UI_HOST%"=="" set "JAVA_OPTS=%JAVA_OPTS% -Dui.host=%UI_HOST%"
if not "%UI_RUNS_DIR%"=="" set "JAVA_OPTS=%JAVA_OPTS% -Dui.runsDir=%UI_RUNS_DIR%"
if not "%UI_REPORTS_DIR%"=="" set "JAVA_OPTS=%JAVA_OPTS% -Dui.reportsDir=%UI_REPORTS_DIR%"
if not "%UI_CONFIG_FILE%"=="" set "JAVA_OPTS=%JAVA_OPTS% -Dui.config=%UI_CONFIG_FILE%"

call :ensure_java
if errorlevel 1 goto fail
call :prepare_runner_config

if exist "%BACKEND_JAR%" goto start_from_jar

echo Backend jar not found at %BACKEND_JAR%.
echo Attempting Maven build...
if "%MVN_CMD%"=="" (
  call :resolve_maven
  if errorlevel 1 goto no_maven
)

call "%MVN_CMD%" -q -DskipTests package
if errorlevel 1 (
  echo Maven build failed.
  goto class_fallback
)

if exist "%BACKEND_JAR%" goto start_from_jar

:class_fallback
if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
  echo Starting backend from compiled classes fallback.
  goto start_from_classes
)
echo Failed to prepare backend runtime.
goto fail

:start_from_jar
echo Starting UI gateway backend...
if defined MVN_CMD (
  echo Using Maven command for runs: %MVN_CMD%
  java %JAVA_OPTS% -Dui.mvnCmd="%MVN_CMD%" -jar "%BACKEND_JAR%"
) else (
  java %JAVA_OPTS% -jar "%BACKEND_JAR%"
)
goto done

:start_from_classes
echo Starting UI gateway backend...
if defined MVN_CMD (
  echo Using Maven command for runs: %MVN_CMD%
  java %JAVA_OPTS% -Dui.mvnCmd="%MVN_CMD%" -cp target\classes com.example.gatling.ui.UiGatewayServer
) else (
  java %JAVA_OPTS% -cp target\classes com.example.gatling.ui.UiGatewayServer
)
goto done

:no_maven
if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
  jar --version >nul 2>nul
  if not errorlevel 1 (
    echo Maven was not found; building backend jar from existing classes.
    jar --create --file "%BACKEND_JAR%" --main-class com.example.gatling.ui.UiGatewayServer -C target\classes .
    if exist "%BACKEND_JAR%" goto start_from_jar
  )
)
if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
  echo Maven was not found; using compiled classes fallback.
  goto start_from_classes
)
echo Maven was not found.
echo Build the backend once with Maven, then rerun this script.
echo Expected runtime artifact: %BACKEND_JAR%
goto fail

:ensure_java
where java >nul 2>nul
if not errorlevel 1 exit /b 0

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
  exit /b 0
)

for %%D in ("%ProgramFiles%\Java" "%ProgramFiles%\Eclipse Adoptium" "%ProgramFiles%\Microsoft") do (
  if exist "%%~D" (
    for /d %%J in ("%%~D\*") do (
      if exist "%%~fJ\bin\java.exe" (
        set "PATH=%%~fJ\bin;%PATH%"
        exit /b 0
      )
    )
  )
)
echo Java was not found in PATH.
echo Install Java 17+ and ensure java is available on PATH or via JAVA_HOME.
exit /b 1

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

:prepare_runner_config
set "EFFECTIVE_UI_HOST=127.0.0.1"
set "EFFECTIVE_UI_PORT=8787"
set "CONFIG_FILE=%UI_CONFIG_FILE%"
if "%CONFIG_FILE%"=="" set "CONFIG_FILE=%ROOT%config\app.properties"

if exist "%CONFIG_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONFIG_FILE%") do (
    set "KEY_RAW=%%A"
    set "VAL_RAW=%%B"
    call :apply_config_pair
  )
)

if not "%UI_HOST%"=="" set "EFFECTIVE_UI_HOST=%UI_HOST%"
if not "%UI_PORT%"=="" set "EFFECTIVE_UI_PORT=%UI_PORT%"

> "%ROOT%ui\runner-config.js" echo window.__RUNNER_CONFIG__ = { runnerApiBase: "http://%EFFECTIVE_UI_HOST%:%EFFECTIVE_UI_PORT%" };
exit /b 0

:apply_config_pair
set "CFG_KEY=%KEY_RAW%"
set "CFG_VAL=%VAL_RAW%"
for /f "tokens=* delims= " %%K in ("%CFG_KEY%") do set "CFG_KEY=%%K"
for /f "tokens=* delims= " %%V in ("%CFG_VAL%") do set "CFG_VAL=%%V"
if /I "%CFG_KEY%"=="ui.host" set "EFFECTIVE_UI_HOST=%CFG_VAL%"
if /I "%CFG_KEY%"=="ui.port" set "EFFECTIVE_UI_PORT=%CFG_VAL%"
exit /b 0

:fail
popd
endlocal
exit /b 1

:done
popd
endlocal
