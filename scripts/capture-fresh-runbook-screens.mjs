import { chromium } from "playwright";
import path from "node:path";
import { promises as fs } from "node:fs";

const root = path.resolve("c:/Users/nives/Desktop/myfiles/Tools/Kubernetes/gatling-api-tool");
const htmlPath = path.join(root, "ui", "index.html");
const outDir = path.join(root, "assets", "runbook");

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1660, height: 980 } });
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
await page.waitForTimeout(1200);

async function flow(n) {
  await page.evaluate((num) => {
    const btn = document.querySelector(`.flow-tab[data-page="${num}"]`);
    if (btn) btn.click();
  }, n);
  await page.waitForTimeout(450);
}
async function mode(m) {
  const id = m === "expert" ? "#modeExpertBtn" : m === "advanced" ? "#modeAdvancedBtn" : "#modeBasicBtn";
  await page.click(id);
  await page.waitForTimeout(300);
}
async function tab(id) {
  await page.click(id);
  await page.waitForTimeout(300);
}
async function focus(sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
  }, sel);
  await page.waitForTimeout(320);
}
async function shot(name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

// Apply the exact YAML config into the UI workspace model
const yamlPlan = {
  applications: {
    "orders-service": {
      enabled: true,
      service: {
        baseUrl: "https://qa.api.company.com",
        defaultHeaders: {
          "content-type": "application/json",
          "x-client-id": "perf-suite"
        },
        auth: {
          type: "bearer",
          tokenEnv: "API_TOKEN"
        },
        tls: {
          enabled: true,
          trustStorePath: "C:/certs/qa-truststore.jks",
          trustStoreType: "JKS",
          trustStorePasswordEnv: "TRUSTSTORE_PASSWORD",
          insecureSkipTlsVerify: false
        }
      },
      assertions: {
        minSuccessPercent: 99,
        maxResponseTimeMs: 2000,
        p95ResponseTimeMs: 1200,
        p99ResponseTimeMs: 2000,
        maxFailedRequests: 0
      },
      environments: {
        qa: {
          enabled: true,
          baseUrl: "https://qa.api.company.com"
        },
        "prod-like": {
          enabled: false,
          baseUrl: "https://prodlike.api.company.com",
          auth: {
            type: "header",
            headerName: "x-api-key",
            headerValueEnv: "PRODLIKE_API_KEY"
          }
        }
      },
      injectionProfiles: {
        smoke_5: {
          injectionType: "rampUsers",
          users: 5,
          rampSec: 15
        },
        baseline_20: {
          injectionType: "rampUsers",
          users: 20,
          rampSec: 60
        },
        stress_80: {
          injectionType: "rampUsers",
          users: 80,
          rampSec: 180
        }
      },
      scenarios: [
        {
          name: "Order happy path",
          enabled: true,
          feeder: {
            type: "csv",
            file: "src/test/resources/data/users.csv",
            mode: "circular"
          },
          load: {
            profileRef: "baseline_20"
          },
          flow: {
            exitOnFail: true
          },
          steps: [
            {
              name: "List orders",
              method: "GET",
              path: "/orders",
              expectedStatus: 200,
              queryParams: {
                customerId: "#{customerId}",
                page: "1"
              },
              checks: [
                {
                  type: "jsonPathExists",
                  path: "$.items[0].id"
                }
              ],
              captures: [
                { jsonPath: "$.items[0].id", saveAs: "orderId" },
                { jsonPath: "$.items[0].customerTier", saveAs: "customerTier" }
              ]
            },
            {
              name: "Route by tier",
              method: "GET",
              path: "/orders/#{orderId}",
              expectedStatus: 200,
              branches: [
                {
                  name: "Premium route",
                  when: {
                    variable: "customerTier",
                    operator: "equals",
                    value: "premium"
                  },
                  method: "GET",
                  path: "/orders/premium/#{orderId}",
                  expectedStatus: 200
                }
              ],
              elseMethod: "GET",
              elsePath: "/orders/standard/#{orderId}",
              elseExpectedStatus: 200,
              requestTimeoutMs: 30000,
              disableFollowRedirect: true
            },
            {
              name: "Create order",
              method: "POST",
              path: "/orders",
              bodyFile: "src/test/resources/bodies/create-order.json",
              bodyType: "json",
              expectedStatus: 201,
              checks: [
                { type: "bodyContains", value: "created" }
              ]
            }
          ]
        },
        {
          name: "Import orders",
          enabled: true,
          load: {
            profileRef: "smoke_5"
          },
          steps: [
            {
              name: "Upload order file",
              method: "POST",
              path: "/orders/import",
              bodyType: "multipart",
              expectedStatus: 202,
              formParams: {
                source: "qa"
              },
              formUploads: [
                {
                  fieldName: "file",
                  filePath: "src/test/resources/data/upload-sample.txt"
                }
              ]
            }
          ]
        }
      ]
    }
  }
};

await page.evaluate((plan) => {
  const snapshot = {
    name: "orders-qa-regression",
    uiMode: "expert",
    rawYamlOverride: false,
    rawYaml: "",
    activeApp: "orders-service",
    plan
  };
  if (typeof applyWorkspaceSnapshot === "function") {
    applyWorkspaceSnapshot(snapshot);
  }
  if (typeof setMode === "function") {
    setMode("expert");
  }
  if (typeof generateYaml === "function") {
    generateYaml();
  }
}, yamlPlan);

// Seed visible status/meta text
await page.evaluate(() => {
  const status = document.getElementById("realRunStatus");
  if (status) status.textContent = "Runner ready. Demo status: connected.";
  const suite = document.getElementById("savedSuiteMeta");
  if (suite) suite.textContent = "Saved: orders-qa-regression | Apps: 1 | Scenarios: 2 | Mode: expert";
});

// rb01: landing / test flow
await flow(1);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("rb01-overview.png");

// rb02: service baseline
await flow(1);
await focus("#baseUrl");
await shot("rb02-service-baseline.png");

// rb03: applications table
await flow(1);
await focus("#appRowsBody");
await shot("rb03-applications.png");

// rb04: scenarios basic
await flow(2);
await mode("basic");
await tab("#tabScenariosBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("rb04-scenarios-basic.png");

// rb05: scenarios advanced (checks/captures/branch areas)
await flow(2);
await mode("advanced");
await tab("#tabScenariosBtn");
await focus("#scenarios");
await shot("rb05-scenarios-advanced.png");

// rb06: injection profiles
await flow(2);
await mode("advanced");
await tab("#tabInjectBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("rb06-injection-profiles.png");

// rb07: environments
await flow(2);
await mode("advanced");
await tab("#tabEnvsBtn");
await shot("rb07-environments.png");

// rb08: global headers
await flow(2);
await mode("advanced");
await tab("#tabHeadersBtn");
await shot("rb08-headers.png");

// rb09: certificates / TLS
await flow(2);
await mode("advanced");
await tab("#tabCertsBtn");
await shot("rb09-certs-tls.png");

// rb10: run setup / runner controls
await flow(3);
await page.evaluate(() => window.scrollTo(0, 0));
await focus("#runnerApiBase");
await shot("rb10-run-setup.png");

// rb11: generated YAML area
await flow(3);
await focus("#yamlOut");
await shot("rb11-generated-yaml.png");

// rb12: expert raw yaml
await flow(2);
await mode("expert");
await flow(3);
await focus("#rawYamlPanel");
await shot("rb12-raw-yaml.png");

// rb13: reports dashboard
await flow(4);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("rb13-reports.png");

// rb14: saved suites panel
await flow(3);
await focus(".saved-suite-panel");
await shot("rb14-saved-suites.png");

await browser.close();
console.log("Captured fresh runbook screenshots in", outDir);
