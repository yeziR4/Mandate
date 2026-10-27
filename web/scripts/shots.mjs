/**
 * Visual QA: renders the built preview at two viewports and writes PNGs.
 * Run from the repo root:  node mandate/../web/scripts/shots.mjs
 */
import { chromium } from "playwright-core";

const base = process.env.SHOT_URL ?? "http://localhost:5173";
const out = process.env.SHOT_DIR ?? "shots";

const routes = [
  ["/", "board"],
  ["/model/4", "model"],
  ["/certificates", "certificates"],
  ["/certificate/2", "certificate"],
  ["/methodology", "methodology"],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ?? undefined,
});

for (const [width, height, tag] of [
  [1440, 960, "desktop"],
  [390, 844, "mobile"],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  for (const [route, name] of routes) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
    console.log(`${tag}-${name}`);
  }
  await page.close();
}

await browser.close();
