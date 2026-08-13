import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const executablePath = await chromium.executablePath();
assert(Boolean(executablePath), "Chromium empacotado não resolveu o executável");

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: chromium.args,
});

try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body><h1 id='marker'>OFFICIAL_REMOTE_PACK_OK</h1></body></html>");
  const marker = await page.$eval("#marker", (element) => element.textContent);
  assert(marker === "OFFICIAL_REMOTE_PACK_OK", "Chromium remoto abriu, mas não renderizou corretamente");
  console.log(JSON.stringify({ ok: true, bundledChromium: true, executablePath: Boolean(executablePath), rendered: marker }));
} finally {
  await browser.close().catch(() => undefined);
}
