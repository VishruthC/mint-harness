import { chromium } from "playwright-core";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.locator(".cat-stage-wrap").scrollIntoViewIfNeeded();
await page.waitForTimeout(1600);
await page.locator("[data-unlock-all]").click();
await page.waitForTimeout(200);

const read = () =>
  page.evaluate(() => {
    const image = document.querySelector("[data-cat-stage]");
    const wrap = image?.closest(".cat-canvas-wrap");
    return {
      src: image?.getAttribute("src"),
      alt: image?.getAttribute("alt"),
      natural: image ? [image.naturalWidth, image.naturalHeight] : null,
      mood: wrap?.dataset.mood,
      frame: document.querySelector("[data-cat-frame]")?.textContent,
      total: document.querySelector("[data-cat-frame-total]")?.textContent,
      visible: document.querySelector(".cat-stage-wrap")?.classList.contains("is-in"),
    };
  });

console.log("idle", JSON.stringify(await read()));
await page.locator(".cat-stage-wrap").screenshot({ path: "qa5-idle.png" });

for (const name of ["Happy eyes", "Heart eyes", "Zoomies", "Tiny wizard", "Chaos gremlin"]) {
  await page.locator(".expression-pill", { hasText: name }).click();
  await page.waitForTimeout(700);
  console.log(name, JSON.stringify(await read()));
  await page.locator(".cat-stage-wrap").screenshot({ path: `qa5-${name.toLowerCase().replaceAll(" ", "-")}.png` });
}

await page.locator("[data-pet]").click();
await page.waitForTimeout(350);
console.log("pet", JSON.stringify(await read()));
await page.locator("[data-pet]").click();
await page.locator("[data-pet]").click();
await page.waitForTimeout(250);
console.log("pet3", JSON.stringify(await read()));

await page.locator("[data-feed]").click();
await page.waitForTimeout(250);
console.log("feed", JSON.stringify(await read()));

await page.locator("[data-cat-animate]").uncheck();
await page.waitForTimeout(200);
console.log("paused", JSON.stringify(await read()));
await page.locator("[data-cat-animate]").check();
await page.waitForTimeout(700);
console.log("resumed", JSON.stringify(await read()));

await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".cat-stage-wrap").scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log("mobile", JSON.stringify(overflow));
await page.locator(".cat-stage-wrap").screenshot({ path: "qa5-mobile.png" });

console.log("errors", JSON.stringify(errors));
await browser.close();
