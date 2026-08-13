function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let browser: Awaited<ReturnType<(typeof import("puppeteer-core"))["launch"]>> | null = null;

try {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = await import("puppeteer-core");
  const executablePath = await chromium.executablePath();
  assert(Boolean(executablePath), "Chromium empacotado não resolveu o executável");

  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: chromium.args,
  });

  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body><h1 id='marker'>STORE_MANAGER_BROWSER_OK</h1></body></html>");
  const marker = await page.$eval("#marker", (element) => element.textContent);
  assert(marker === "STORE_MANAGER_BROWSER_OK", "Chromium serverless abriu, mas não renderizou corretamente");

  console.log(JSON.stringify({
    ok: true,
    bundledChromium: true,
    executablePath: Boolean(executablePath),
    rendered: marker,
  }));
} finally {
  await browser?.close().catch(() => undefined);
}
