# Gatling API Performance Tool

Config-driven API performance testing with Gatling Java DSL.

## What this provides
- Multi-application support via top-level `applications` map.
- Per-application baseline service (`baseUrl`, default headers, optional bearer token from env).
- Auth modes for service-level or step-level overrides: `bearer`, `basic`, and custom `header`.
- Per-application named environments (`environments` + `activeEnvironment`) with overrides.
- Different applications can use different base URLs (set per app in `applications.<app>.service.baseUrl`).
- Per-application scenarios, feeders, checks/captures, and SLO assertions.
- Request-level API features: absolute `url` override, `queryParams`, `formParams`, inline `body`, and `bodyFile`.
- Multipart upload support with `formUploads`.
- Request execution flags: `requestTimeoutMs`, `disableFollowRedirect`, `disableUrlEncoding`, `silent`, and `ignoreProtocolHeaders`.
- HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- Payload content modes: `json`, `xml`, `text`, `form`.
- Per-application reusable injection profiles (`injectionProfiles`) referenced by scenarios.
- YAML-driven setup so non-developers can edit test plans quickly.
- Backward compatibility with legacy single-app (`service` + `scenarios`) schema.

## Project layout
- `pom.xml`: Maven build + Gatling plugin.
- `src/test/java/com/example/gatling/simulations/ConfigDrivenApiSimulation.java`: Main simulation.
- `src/test/java/com/example/gatling/config/ConfigModels.java`: Config model classes.
- `src/test/java/com/example/gatling/config/ConfigLoader.java`: YAML config parser and validator.
- `src/test/resources/sample-config.yaml`: Example user-provided service/scenario config.
- `src/test/resources/config-template.yaml`: Starter config with feeder + assertions.
- `src/test/resources/my-api-config.yaml`: Your editable working config file.
- `config/app.properties`: Runtime settings for UI gateway host/port and run/report directories.
- `src/test/resources/data/users.csv`: Example feeder data.
- `.github/workflows/gatling.yml`: GitHub Actions pipeline.
- `Jenkinsfile`: Jenkins pipeline.

## Prerequisites
- Java 17+
- Maven 3.9+ only when building tests/runs or creating the backend jar for the first time

## Portable handoff
This repo can be transferred to another machine and run from any folder. The target machine always needs Java 17+. Maven is optional at runtime when a prebuilt backend jar is present.

Recommended handoff steps:
1. Copy the whole `gatling-api-tool` folder.
2. On the target machine, open a terminal in the project root.
3. Run `check-prerequisites.bat`.
4. Start the workspace with `start-ui-workspace.bat` or start the backend with `run-ui-backend.bat`.
5. Open `ui/index.html` in a browser if it was not opened automatically.

Portable launcher behavior:
- `run-ui-backend.bat` prefers `target/ui-gateway-backend.jar` and starts immediately when that jar exists.
- If the backend jar is missing, `run-ui-backend.bat` builds it with Maven (`mvn.cmd`, `mvn`, or `mvnw.cmd`).
- If Maven is unavailable but compiled classes exist, scripts can assemble `target/ui-gateway-backend.jar` with the JDK `jar` tool.
- `run-test.bat` auto-detects `mvn.cmd` or `mvn` from `PATH`, or accepts explicit Maven path.
- `check-prerequisites.bat` treats Maven as optional when `target/ui-gateway-backend.jar` already exists.
- Scripts use path-relative resolution (`%~dp0`) so they can run from any install location.
- Runtime settings can be customized in `config/app.properties` or overridden with env vars (`UI_PORT`, `UI_HOST`, `UI_RUNS_DIR`, `UI_REPORTS_DIR`, `UI_CONFIG_FILE`).
- `run-ui-backend.bat` writes `ui/runner-config.js` with the effective backend URL so the UI can auto-fill `UI Runner API`.
- `create-portable-bundle.bat` now writes `dist/latest-bundle.txt` and `dist/latest-bundle.sha256`.

## Run with sample config
```bash
mvn -Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation gatling:test
```

## Run with your own config
```bash
mvn -Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation -DconfigFile=src/test/resources/my-config.yaml gatling:test
```

## Run with your prepared config
```bash
mvn -Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation -DconfigFile=src/test/resources/my-api-config.yaml gatling:test
```

## Optional auth token
If your YAML sets:
```yaml
service:
  auth:
    type: bearer
    tokenEnv: API_TOKEN
```
set the environment variable before running:

```bash
set API_TOKEN=your_token_here
```

Other supported auth shapes:
```yaml
service:
  auth:
    type: basic
    usernameEnv: API_USER
    passwordEnv: API_PASSWORD
```

```yaml
service:
  auth:
    type: header
    headerName: x-api-key
    headerValueEnv: API_KEY
```

## Config format
Preferred multi-app schema:
```yaml
applications:
  my-app:
    enabled: true
    service: ...
    activeEnvironment: "qa"
    environments: ...
    assertions: ...
    scenarios: ...
```
Useful step fields:
```yaml
steps:
  - name: "Search"
    method: "GET"
    path: "/v1/resources"
    queryParams:
      tenant: "#{tenant}"
      page: "1"
  - name: "Create"
    method: "POST"
    path: "/v1/resources"
    bodyFile: "src/test/resources/bodies/create-post.json"
    bodyType: "json"
  - name: "Form Search"
    method: "POST"
    path: "/v1/search"
    bodyType: "form"
    formParams:
      tenant: "#{tenant}"
      state: "ACTIVE"
  - name: "Upload"
    method: "POST"
    path: "/v1/import"
    bodyType: "multipart"
    formParams:
      tenant: "#{tenant}"
    formUploads:
      - fieldName: "file"
        filePath: "src/test/resources/data/upload-sample.txt"
    requestTimeoutMs: 30000
    disableFollowRedirect: true
```
See:
- `src/test/resources/config-template.yaml` for full multi-app template.
- `src/test/resources/my-api-config.yaml` for editable starter.
- `src/test/resources/sample-config.yaml` for legacy minimal example.

## CI
- GitHub Actions runs Gatling on `push`, `pull_request`, and manual trigger.
- Jenkins pipeline runs Gatling with configurable YAML path via `CONFIG_FILE`.

## UI for API Inputs + Multi-API Hits
- Open [ui/index.html](c:\Users\nives\Desktop\myfiles\Tools\Kubernetes\gatling-api-tool\ui\index.html) in a browser.
- Fill (per active application):
  - Baseline service config
  - Named environments in `Environments` tab (enable/disable, active, base URL, auth/tls/header overrides)
  - Global headers in `Headers` tab
  - Optional TLS certificate details in `Certificates` tab
  - Optional auth (`bearer` + `tokenEnv`)
  - Injection profiles in `Injection Profiles` tab and bind each scenario to one profile
  - Optional feeder (`csv`, file, mode)
  - API endpoints, methods, expected status, sample body
  - Per-API headers inside each API card
  - Per-API checks (`bodyContains`, `regex`, `jsonPathExists`, `jsonPathEquals`)
  - Per-API captures (`jsonPath` + `saveAs`) and reuse with `#{var}` in path/body/headers
  - SLO thresholds (success %, max RT, p95)

TLS notes:
- Certificate settings are exported to `service.tls` in YAML and applied by Gatling runtime.
- If `keyStorePath` is set, provide the password via `keyStorePasswordEnv`.
- If `trustStorePath` is set, provide the password via `trustStorePasswordEnv`.
- Click `Run Concurrent Hits` to execute all enabled applications and enabled environments sequentially.
- `UI Iterations per Scenario` affects only the browser preview runner. Gatling backend execution uses scenario injection profile settings.

## Run Real Gatling Load Directly From UI
1. Start backend runner once:
```bat
cd gatling-api-tool
run-ui-backend.bat
```
2. Open `ui/index.html`.
3. `UI Runner API` is auto-filled from `ui/runner-config.js` (generated on backend start). Update it manually only when targeting a different host/port.
4. Click `Run Real Load (Gatling)`.
5. The UI will show status, logs, and load report link/embedded report.
- Embedded reports are served through the backend over `http://127.0.0.1:8787/reports/...` so the iframe does not depend on `file:///...` browser behavior.
- Click `Generate YAML` or `Download YAML` to produce `my-api-config.yaml`.
- In `Run Results`, enable `Interactive report explanations` to see tab-specific guidance (`Scenarios`, `Headers`, `Certificates`) while analyzing metrics.
- In `Run Results`, click `Why?` on any API row to see top failure reasons (status mismatch/check failure/network issues).
- Use `Gatling Report UI Link` + `Open Gatling Report` to open generated Gatling HTML report quickly.
- UI runner is feeder-aware for CSV scenario feeders (when file is browser-accessible) and now shows `Parity` warnings where UI behavior may differ from Gatling (for example complex JSONPath).
- Run Results now includes app tabs -> environment tabs, each with detailed KPI cards, per-step latency percentiles (p90/p95/p99), status breakdowns, scenario summaries, top failure reasons, parity diagnostics, and deep per-row `Why` details.

Optional: copy downloaded YAML into project config path:
```powershell
powershell -ExecutionPolicy Bypass -File ui/save-config.ps1 -InputYamlPath "C:\path\to\my-api-config.yaml"
```

## Portable script examples
Run backend with auto-detected Maven:
```bat
run-ui-backend.bat
```

Run backend with explicit Maven path:
```bat
run-ui-backend.bat "C:\path\to\mvn.cmd"
```

Start backend and open the UI in one step:
```bat
start-ui-workspace.bat
```

Run Gatling test with sample config:
```bat
run-test.bat
```

Run Gatling test with explicit config and Maven path:
```bat
run-test.bat src\test\resources\my-api-config.yaml "C:\path\to\mvn.cmd"
```

Create a portable zip bundle:
```bat
create-portable-bundle.bat
```

Build a full release bundle (precheck + package + checksum):
```bat
build-release.bat
```

## Branching and fallback in UI (updated)
- Each API step supports multiple `branches` and one final fallback.
- Branch rules are evaluated in order (top to bottom); the first matching rule is executed.
- If no branch matches, the fallback request runs when configured (`elseMethod` + `elsePath` in legacy form, or `fallback` in YAML).
- If no branch matches and no fallback is configured, the base API step request is used.

### Branch-level checks and captures
- Each branch can now define its own `checks`.
- Each branch can now define its own `captures`.
- Branch checks/captures override base step checks/captures for that branch execution path.

### How to configure in the UI
1. Open an API step, expand **Branching And Fallback**.
2. Click **Add Branch Rule** for each condition.
3. Fill `Variable`, `Operator`, `Value`/`Values CSV`, and branch method/path/url/status overrides.
4. Under the same branch, add **Branch Checks** and **Branch Captures** as needed.
5. Configure fallback (`Fallback Method`, `Fallback Path`, optional status/body) for unmatched requests.
6. Save/export YAML and verify generated `branches[].checks` and `branches[].captures`.

### Example logic pattern
- `if tier == premium` -> `/orders/premium/#{orderId}`
- `else if tier == vip` -> `/orders/vip/#{orderId}`
- `else if tier == trial` -> `/orders/trial/#{orderId}`
- `else` -> `/orders/standard/#{orderId}`
