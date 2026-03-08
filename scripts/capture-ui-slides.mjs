import { chromium } from "playwright";
import path from "node:path";
import { promises as fs } from "node:fs";

const root = path.resolve("c:/Users/nives/Desktop/myfiles/Tools/Kubernetes/gatling-api-tool");
const htmlPath = path.join(root, "ui", "index.html");
const outDir = path.join(root, "assets", "presentation");

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
await page.waitForTimeout(1200);

async function setFlowPage(n) {
  await page.evaluate((num) => {
    const btn = document.querySelector(`.flow-tab[data-page="${num}"]`);
    if (btn) btn.click();
  }, n);
  await page.waitForTimeout(500);
}

async function setMode(mode) {
  const id = mode === "expert" ? "#modeExpertBtn" : mode === "advanced" ? "#modeAdvancedBtn" : "#modeBasicBtn";
  await page.click(id);
  await page.waitForTimeout(300);
}

async function setTab(tabId) {
  await page.click(tabId);
  await page.waitForTimeout(350);
}

async function focus(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
  }, selector);
  await page.waitForTimeout(350);
}

async function shot(name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

// seed visible values for alignment with content
await page.evaluate(() => {
  const base = document.getElementById("baseUrl");
  if (base) base.value = "https://qa.api.company.com";
  const minSuccess = document.getElementById("minSuccess");
  if (minSuccess) minSuccess.value = "99";
  const p95 = document.getElementById("p95");
  if (p95) p95.value = "1200";
  const real = document.getElementById("realRunStatus");
  if (real) real.textContent = "Runner status demo: ready for real run.";
  const suiteMeta = document.getElementById("savedSuiteMeta");
  if (suiteMeta) suiteMeta.textContent = "Saved: orders-qa-regression | Apps: 1 | Scenarios: 3 | Mode: expert";
});

// slide1: title + flow overview
await setFlowPage(1);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide1.png");

// slide2: run setup + runner endpoint
await setFlowPage(3);
await page.evaluate(() => window.scrollTo(0, 0));
await focus("#runnerApiBase");
await shot("slide2.png");

// slide3: scenario definition context on page1
await setFlowPage(1);
await focus(".card.flow-page[data-page='1']:nth-of-type(4)");
await shot("slide3.png");

// slide4: service baseline + assertions
await setFlowPage(1);
await focus("#baseUrl");
await shot("slide4.png");

// slide5: injection profiles
await setFlowPage(2);
await setMode("advanced");
await setTab("#tabInjectBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide5.png");

// slide6: core scenarios
await setFlowPage(2);
await setMode("basic");
await setTab("#tabScenariosBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide6.png");

// slide7: checks/captures (advanced scenario cards)
await setFlowPage(2);
await setMode("advanced");
await setTab("#tabScenariosBtn");
await focus("#scenarios");
await shot("slide7.png");

// slide8: environments
await setFlowPage(2);
await setMode("advanced");
await setTab("#tabEnvsBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide8.png");

// slide9: certs + branching reference area
await setFlowPage(2);
await setMode("advanced");
await setTab("#tabCertsBtn");
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide9.png");

// slide10: expert mode run setup
await setFlowPage(2);
await setMode("expert");
await setFlowPage(3);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide10.png");

// slide11: raw yaml panel
await setFlowPage(2);
await setMode("expert");
await setFlowPage(3);
await focus("#rawYamlPanel");
await shot("slide11.png");

// slide12: run setup diagnostics status area
await setFlowPage(3);
await focus("#realRunStatus");
await shot("slide12.png");

// slide13: reports dashboard
await setFlowPage(4);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("slide13.png");

// slide14: saved suites and release section
await setFlowPage(3);
await focus(".saved-suite-panel");
await shot("slide14.png");

await browser.close();
console.log("Captured aligned slide screenshots in", outDir);
