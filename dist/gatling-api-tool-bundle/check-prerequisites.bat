@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%"

echo Checking gatling-api-tool prerequisites...
echo.

set "HAS_ERROR=0"
set "HAS_MAVEN=0"

where java >nul 2>nul
if not errorlevel 1 (
  echo [OK]   Java found:
  java -version 2>&1
  goto check_maven
)

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
  echo [OK]   Java found via JAVA_HOME:
  java -version 2>&1
  goto check_maven
)

for %%D in ("%ProgramFiles%\Java" "%ProgramFiles%\Eclipse Adoptium" "%ProgramFiles%\Microsoft") do (
  if exist "%%~D" (
    for /d %%J in ("%%~D\*") do (
      if exist "%%~fJ\bin\java.exe" (
        set "PATH=%%~fJ\bin;%PATH%"
        echo [OK]   Java found in:
        echo        %%~fJ
        java -version 2>&1
        goto check_maven
      )
    )
  )
)

echo [FAIL] Java was not found in PATH.
echo        Install Java 17+ and add it to PATH or set JAVA_HOME.
set "HAS_ERROR=1"

echo.

:check_maven
where mvn.cmd >nul 2>nul
if not errorlevel 1 (
  set "HAS_MAVEN=1"
  echo [OK]   Maven found:
  mvn.cmd -version
  goto check_files
)

where mvn >nul 2>nul
if not errorlevel 1 (
  set "HAS_MAVEN=1"
  echo [OK]   Maven found:
  mvn -version
  goto check_files
)

if exist "%ROOT%mvnw.cmd" (
  where powershell >nul 2>nul
  if not errorlevel 1 (
    set "HAS_MAVEN=1"
    echo [OK]   Maven wrapper found: %ROOT%mvnw.cmd
    goto check_files
  )
)

if exist "target\ui-gateway-backend.jar" (
  echo [OK]   Maven not found, but prebuilt backend jar exists.
) else if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
  echo [WARN] Maven not found and backend jar missing.
  echo        Existing compiled classes were found, so backend startup can still work.
) else (
  echo [WARN] Maven was not found in PATH.
  echo        Backend runtime jar also not found at target\ui-gateway-backend.jar.
  echo        Install Maven or run this tool from a bundle that includes the jar.
  set "HAS_ERROR=1"
)

:check_files
echo.

if exist "pom.xml" (
  echo [OK]   pom.xml found
) else (
  echo [FAIL] pom.xml not found in project folder.
  set "HAS_ERROR=1"
)

if exist "ui\index.html" (
  echo [OK]   UI entry page found
) else (
  echo [FAIL] ui\index.html not found.
  set "HAS_ERROR=1"
)

if exist "src\test\java\com\example\gatling\simulations\ConfigDrivenApiSimulation.java" (
  echo [OK]   Gatling simulation source found
) else (
  echo [FAIL] Gatling simulation source not found.
  set "HAS_ERROR=1"
)

if exist "target\ui-gateway-backend.jar" (
  echo [OK]   Runtime backend jar found
) else (
  if exist "target\classes\com\example\gatling\ui\UiGatewayServer.class" (
    echo [WARN] Runtime backend jar not found; classpath fallback is available.
  ) else if "%HAS_MAVEN%"=="1" (
    echo [WARN] Runtime backend jar not found yet; it will be built on first start.
  ) else (
    echo [FAIL] Runtime backend jar missing and Maven unavailable.
    set "HAS_ERROR=1"
  )
)

echo.
if "%HAS_ERROR%"=="1" (
  echo One or more prerequisite checks failed.
  popd
  endlocal
  exit /b 1
)

echo All prerequisite checks passed.
popd
endlocal
exit /b 0
