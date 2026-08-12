import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const packPath = resolve("public/chromium-pack.tar");
assert(existsSync(packPath), "postinstall precisa gerar public/chromium-pack.tar");
assert(statSync(packPath).size > 1_000_000, "chromium-pack.tar parece incompleto");

const server = createServer((request, response) => {
  if (request.url !== "/chromium-pack.tar") {
    response.statusCode = 404;
    response.end("not found");
    return;
  }
  response.setHeader("Content-Type", "application/x-tar");
  response.setHeader("Content-Length", String(statSync(packPath).size));
  createReadStream(packPath).pipe(response);
});

await new Promise<void>((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolveListen());
});

const address = server.address();
assert(address && typeof address === "object", "servidor local do pack não iniciou");
const packUrl = `http://127.0.0.1:${address.port}/chromium-pack.tar`;

let browser: Awaited<ReturnType<(typeof import("puppeteer-core"))["launch"]>> | null = null;
try {
  const chromium = (await import("@sparticuz/chromium-min")).default;
  const puppeteer = await import("puppeteer-core");
  const executablePath = await chromium.executablePath(packUrl);
  assert(Boolean(executablePath), "chromium-min não resolveu o executável");

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
    packBytes: statSync(packPath).size,
    executablePath: Boolean(executablePath),
    rendered: marker,
  }));
} finally {
  await browser?.close().catch(() => undefined);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
