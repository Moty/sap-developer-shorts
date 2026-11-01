// Usage: node shot.mjs <url> <out.png> [width=1440] [height=1000] [fullPage=0] [clickSelector]
// Captures a screenshot and prints console errors and horizontal overflow.
import { chromium } from "playwright-core";

const [url, out, w = "1440", h = "1000", full = "0", click] = process.argv.slice(2);
const exe =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(url, { waitUntil: "load" });
await p.waitForTimeout(1200);
if (click) {
  await p.click(click);
  await p.waitForTimeout(600);
}
const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: innerWidth }));
await p.screenshot({ path: out, fullPage: full === "1" });
console.log(JSON.stringify({ out, overflow: o.sw > o.cw + 1 ? o : false, errors: errs }));
await b.close();
