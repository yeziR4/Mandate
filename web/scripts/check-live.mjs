import { chromium } from "playwright-core";

const base = "https://mandate-delta-three.vercel.app";
const routes = ["/", "/certificates", "/methodology", "/model/4", "/certificate/1"];

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });

for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));

  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    rootKids: document.querySelector("#root")?.children.length ?? -1,
    bodyLen: document.body.innerText.length,
    h1: document.querySelector("h1")?.textContent?.trim().slice(0, 40) ?? null,
    rows: document.querySelectorAll(".board__row").length,
    title: document.title,
  }));

  console.log(route.padEnd(16), JSON.stringify(state), errors.length ? "\n   " + errors.join("\n   ") : "");
  await page.close();
}

await browser.close();
