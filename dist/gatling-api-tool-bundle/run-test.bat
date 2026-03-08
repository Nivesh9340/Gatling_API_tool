@echo off
setlocal

set "CONFIG_FILE=%~1"
if "%CONFIG_FILE%"=="" set "CONFIG_FILE=src/test/resources/sample-config.yaml"

set "MVN_CMD=%~2"
if not "%MVN_CMD%"=="" goto have_mvn

if exist "%~dp0mvnw.cmd" (
  set "MVN_CMD=%~dp0mvnw.cmd"
  goto have_mvn
)

where mvn.cmd >nul 2>nul
if not errorlevel 1 (
  set "MVN_CMD=mvn.cmd"
  goto have_mvn
)

where mvn >nul 2>nul
if not errorlevel 1 (
  set "MVN_CMD=mvn"
  goto have_mvn
)

echo Maven was not found.
echo Install Maven and add it to PATH, or pass the full mvn.cmd path as the second argument.
exit /b 1

:have_mvn
where java >nul 2>nul
if not errorlevel 1 goto have_java

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" (
  set "PATH=%JAVA_HOME%\bin;%PATH%"
  goto have_java
)

for %%D in ("%ProgramFiles%\Java" "%ProgramFiles%\Eclipse Adoptium" "%ProgramFiles%\Microsoft") do (
  if exist "%%~D" (
    for /d %%J in ("%%~D\*") do (
      if exist "%%~fJ\bin\java.exe" (
        set "PATH=%%~fJ\bin;%PATH%"
        goto have_java
      )
    )
  )
)

echo Java was not found in PATH.
echo Install Java 17+ and ensure java is available on PATH or via JAVA_HOME.
exit /b 1

:have_java
call "%MVN_CMD%" -Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation -DconfigFile=%CONFIG_FILE% gatling:test
