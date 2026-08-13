import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const packPath = resolve("public/chromium-pack.tar");
assert(existsSync(packPath), "postinstall precisa gerar public/chromium-pack.tar");
assert(statSync(packPath).size > 1_000_000, "chromium-pack.tar parece incompleto");

const extractedDir = mkdtempSync(join(tmpdir(), "store-manager-chromium-pack-"));
let browser: Awaited<ReturnType<(typeof import("puppeteer-core"))["launch"]>> | null = null;

try {
  execFileSync("tar", ["-xf", packPath, "-C", extractedDir], { stdio: "inherit" });

  const chromium = (await import("@sparticuz/chromium-min")).default;
  const puppeteer = await import("puppeteer-core");
  const executablePath = await chromium.executablePath(extractedDir);
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
  rmSync(extractedDir, { recursive: true, force: true });
}
