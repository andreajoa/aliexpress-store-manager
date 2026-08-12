import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const OFFICIAL_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const executablePath = await chromium.executablePath(OFFICIAL_PACK);
assert(Boolean(executablePath), "chromium-min não resolveu o pack remoto oficial");

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
  console.log(JSON.stringify({ ok: true, remotePack: OFFICIAL_PACK, executablePath: Boolean(executablePath), rendered: marker }));
} finally {
  await browser.close().catch(() => undefined);
}
