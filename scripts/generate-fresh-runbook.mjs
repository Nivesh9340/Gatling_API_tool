import { chromium } from "playwright";
import path from "node:path";
import { promises as fs } from "node:fs";

const root = path.resolve("c:/Users/nives/Desktop/myfiles/Tools/Kubernetes/gatling-api-tool");
const distDir = path.join(root, "dist");
const runbookAssets = path.join(root, "assets", "runbook");
const htmlOut = path.join(distDir, "Gatling-API-Tool-Fresh-Runbook.html");
const pdfOut = path.join(distDir, "Gatling-API-Tool-Fresh-Runbook.pdf");
const yamlOut = path.join(distDir, "dummy-full-feature-config.yaml");

await fs.mkdir(distDir, { recursive: true });

const dummyYaml = `applications:
  orders-service:
    enabled: true
    service:
      baseUrl: "https://qa.api.company.com"
      defaultHeaders:
        content-type: "application/json"
        x-client-id: "perf-suite"
      auth:
        type: bearer
        tokenEnv: API_TOKEN
      tls:
        enabled: true
        trustStorePath: "C:/certs/qa-truststore.jks"
        trustStoreType: JKS
        trustStorePasswordEnv: TRUSTSTORE_PASSWORD
        insecureSkipTlsVerify: false
    assertions:
      minSuccessPercent: 99
      maxResponseTimeMs: 2000
      p95ResponseTimeMs: 1200
      p99ResponseTimeMs: 2000
      maxFailedRequests: 0
    environments:
      qa:
        enabled: true
        baseUrl: "https://qa.api.company.com"
      prod-like:
        enabled: false
        baseUrl: "https://prodlike.api.company.com"
        auth:
          type: header
          headerName: "x-api-key"
          headerValueEnv: "PRODLIKE_API_KEY"
    injectionProfiles:
      smoke_5:
        injectionType: rampUsers
        users: 5
        rampSec: 15
      baseline_20:
        injectionType: rampUsers
        users: 20
        rampSec: 60
      stress_80:
        injectionType: rampUsers
        users: 80
        rampSec: 180
    scenarios:
      - name: "Order happy path"
        enabled: true
        feeder:
          type: csv
          file: "src/test/resources/data/users.csv"
          mode: circular
        load:
          profileRef: baseline_20
        flow:
          exitOnFail: true
        steps:
          - name: "List orders"
            method: GET
            path: "/orders"
            expectedStatus: 200
            queryParams:
              customerId: "#{customerId}"
              page: "1"
            checks:
              - type: jsonPathExists
                path: "$.items[0].id"
            captures:
              - jsonPath: "$.items[0].id"
                saveAs: "orderId"
              - jsonPath: "$.items[0].customerTier"
                saveAs: "customerTier"
          - name: "Route by tier"
            method: GET
            path: "/orders/#{orderId}"
            expectedStatus: 200
            branches:
              - name: "Premium route"
                when:
                  variable: customerTier
                  operator: equals
                  value: premium
                method: GET
                path: "/orders/premium/#{orderId}"
                expectedStatus: 200
            elseMethod: GET
            elsePath: "/orders/standard/#{orderId}"
            elseExpectedStatus: 200
            requestTimeoutMs: 30000
            disableFollowRedirect: true
          - name: "Create order"
            method: POST
            path: "/orders"
            bodyFile: "src/test/resources/bodies/create-order.json"
            bodyType: json
            expectedStatus: 201
            checks:
              - type: bodyContains
                value: "created"
      - name: "Import orders"
        enabled: true
        load:
          profileRef: smoke_5
        steps:
          - name: "Upload order file"
            method: POST
            path: "/orders/import"
            bodyType: multipart
            expectedStatus: 202
            formParams:
              source: "qa"
            formUploads:
              - fieldName: "file"
                filePath: "src/test/resources/data/upload-sample.txt"
`;

await fs.writeFile(yamlOut, dummyYaml, "utf8");

const shot = (name) => `file:///${path.join(runbookAssets, name).replace(/\\/g, "/")}`;

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Gatling API Tool - Fresh Runbook</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; color:#0f172a; margin:0; padding:24px; line-height:1.45; }
    h1 { margin:0 0 6px; color:#0f5cc0; font-size:30px; }
    h2 { margin:0; font-size:22px; color:#134f9f; }
    h3 { margin:0 0 8px; font-size:18px; color:#1f3c5a; }
    .meta { margin:10px 0 18px; color:#42576b; }
    .section { border:1px solid #dbe5f0; border-radius:12px; padding:14px; margin:12px 0 18px; page-break-inside: avoid; }
    .sub { border:1px dashed #d6e2ef; border-radius:10px; padding:10px; margin:10px 0; }
    ul { margin: 8px 0 10px 22px; }
    ol { margin: 8px 0 10px 22px; }
    pre { background:#f4f8fc; border:1px solid #d8e5f5; border-radius:8px; padding:10px; overflow:auto; font-family:Consolas, monospace; font-size:12px; }
    code { font-family:Consolas, monospace; background:#f4f8fc; padding:1px 4px; border-radius:4px; }
    img { width:100%; border:1px solid #d7e3f2; border-radius:10px; margin-top:8px; }
    .small { font-size:12px; color:#516579; }
    .two { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
  </style>
</head>
<body>
  <h1>Gatling API Tool - Fresh Runbook</h1>
  <div class="meta">
    Version: fresh baseline • Coverage: startup, launch, business use cases, full-feature dummy config, expert mode, reporting, release packaging
  </div>

  <div class="section">
    <h2>1) Business Objectives and Use Cases</h2>
    <div class="sub">
      <h3>Primary Business Value</h3>
      <ul>
        <li>Prevent release regressions by validating response-time and success-rate gates before production deployment.</li>
        <li>Provide a repeatable QA baseline with saved suites and environment-aware configs.</li>
        <li>Accelerate incident triage through real run diagnostics and report drill-downs.</li>
      </ul>
    </div>
    <div class="sub">
      <h3>Business Use Cases</h3>
      <ol>
        <li>Pre-release performance gate for core order APIs.</li>
        <li>Daily regression run for QA environment.</li>
        <li>Partner onboarding load validation (header/basic auth variants).</li>
        <li>Capacity planning via smoke/baseline/stress profiles.</li>
        <li>Post-incident replay with raw YAML override for exact reproduction.</li>
      </ol>
    </div>
    <img src="${shot("rb01-overview.png")}" alt="overview"/>
  </div>

  <div class="section">
    <h2>2) Startup and Launch</h2>
    <ol>
      <li>Open terminal in <code>gatling-api-tool</code>.</li>
      <li>Run prerequisite checks.</li>
      <li>Start workspace (backend + UI).</li>
      <li>Verify runner endpoint in Run Setup.</li>
    </ol>
    <pre>cd gatling-api-tool
check-prerequisites.bat
start-ui-workspace.bat</pre>
    <img src="${shot("rb02-service-baseline.png")}" alt="startup"/>
    <img src="${shot("rb10-run-setup.png")}" alt="run setup"/>
  </div>

  <div class="section">
    <h2>3) Dummy Scenario Definition (orders-service)</h2>
    <div class="two">
      <div class="sub">
        <h3>Flow</h3>
        <ul>
          <li><code>GET /orders</code> -> capture <code>orderId</code> and <code>customerTier</code></li>
          <li>Conditional branch:
            if premium -> <code>/orders/premium/#{orderId}</code>
            else -> <code>/orders/standard/#{orderId}</code>
          </li>
          <li><code>POST /orders</code> with JSON payload</li>
          <li>Optional multipart import scenario</li>
        </ul>
      </div>
      <div class="sub">
        <h3>SLO Targets</h3>
        <ul>
          <li>Success >= 99%</li>
          <li>p95 <= 1200ms</li>
          <li>p99 <= 2000ms</li>
          <li>Max failed requests = 0</li>
        </ul>
      </div>
    </div>
    <img src="${shot("rb03-applications.png")}" alt="applications"/>
    <img src="${shot("rb04-scenarios-basic.png")}" alt="scenarios basic"/>
  </div>

  <div class="section">
    <h2>4) Feature-by-Feature Configuration Walkthrough</h2>
    <div class="sub">
      <h3>Service, Assertions, and App Setup</h3>
      <ul>
        <li>Set base URL, auth type, assertion thresholds.</li>
        <li>Add/activate app entry in Applications table.</li>
      </ul>
      <img src="${shot("rb02-service-baseline.png")}" alt="service baseline"/>
      <img src="${shot("rb03-applications.png")}" alt="applications"/>
    </div>
    <div class="sub">
      <h3>Scenarios, Checks, Captures, Conditional Branches</h3>
      <ul>
        <li>Define steps and expected statuses.</li>
        <li>Add checks and captures to drive data-dependent flow.</li>
        <li>Configure branch/else behavior and request flags.</li>
      </ul>
      <img src="${shot("rb05-scenarios-advanced.png")}" alt="advanced scenarios"/>
      <img src="${shot("rb09-certs-tls.png")}" alt="conditional/certs area"/>
    </div>
    <div class="sub">
      <h3>Injection Profiles, Environments, Headers, TLS</h3>
      <ul>
        <li>Create smoke/baseline/stress profiles and map to scenarios.</li>
        <li>Add QA/prod-like environments and auth overrides.</li>
        <li>Set global headers and optional TLS cert/truststore values.</li>
      </ul>
      <img src="${shot("rb06-injection-profiles.png")}" alt="injection"/>
      <img src="${shot("rb07-environments.png")}" alt="environments"/>
      <img src="${shot("rb08-headers.png")}" alt="headers"/>
      <img src="${shot("rb09-certs-tls.png")}" alt="certs tls"/>
    </div>
    <div class="sub">
      <h3>Run Setup, Raw YAML, Reports, Saved Suites</h3>
      <ul>
        <li>Use generated YAML and expert raw YAML override as needed.</li>
        <li>Run real load, inspect diagnostics, and validate report KPIs.</li>
        <li>Save suite for reusable regression execution.</li>
      </ul>
      <img src="${shot("rb11-generated-yaml.png")}" alt="generated yaml"/>
      <img src="${shot("rb12-raw-yaml.png")}" alt="raw yaml"/>
      <img src="${shot("rb13-reports.png")}" alt="reports"/>
      <img src="${shot("rb14-saved-suites.png")}" alt="saved suites"/>
    </div>
  </div>

  <div class="section">
    <h2>5) Full Dummy Config (All Major Features)</h2>
    <p class="small">File generated at: <code>dist/dummy-full-feature-config.yaml</code></p>
    <pre>${dummyYaml.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </div>

  <div class="section">
    <h2>6) Real Run Procedure</h2>
    <ol>
      <li>Go to Run Setup page.</li>
      <li>Click <b>Check Runner</b>.</li>
      <li>Click <b>Run Real Load (Gatling)</b>.</li>
      <li>Monitor status tiles (job ID, state, report availability).</li>
      <li>Analyze report tables and diagnostics.</li>
    </ol>
    <img src="${shot("rb10-run-setup.png")}" alt="run setup"/>
    <img src="${shot("rb13-reports.png")}" alt="reports"/>
  </div>

  <div class="section">
    <h2>7) Packaging, Handoff, and Governance</h2>
    <ul>
      <li>Use <code>build-release.bat</code> to run checks + bundle + checksum.</li>
      <li>Distribute zip plus <code>latest-bundle.sha256</code> for integrity verification.</li>
      <li>Track runbook and dummy config as versioned project artifacts.</li>
    </ul>
    <pre>build-release.bat</pre>
  </div>

  <div class="small">Generated runbook from local project context and captured UI screenshots.</div>
</body>
</html>`;

await fs.writeFile(htmlOut, html, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
await page.goto(`file:///${htmlOut.replace(/\\/g, "/")}`);
await page.waitForTimeout(1000);
await page.pdf({
  path: pdfOut,
  format: "A4",
  printBackground: true,
  margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
});
await browser.close();

console.log("Created runbook HTML:", htmlOut);
console.log("Created runbook PDF:", pdfOut);
console.log("Created dummy config:", yamlOut);
