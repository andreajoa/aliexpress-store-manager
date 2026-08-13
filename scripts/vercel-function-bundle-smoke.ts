import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = process.cwd();
const tracePath = resolve(
  projectRoot,
  ".next/server/app/api/import/aliexpress/route.js.nft.json",
);
assert(existsSync(tracePath), "Execute npm run build antes do smoke do pacote Vercel.");

const trace = JSON.parse(readFileSync(tracePath, "utf8")) as {
  files?: unknown;
};
const tracedFiles = Array.isArray(trace.files)
  ? trace.files.filter((value): value is string => typeof value === "string")
  : [];
const routeDirectory = dirname(tracePath);
const nodeModulesMarker = `${sep}node_modules${sep}`;
const runtimeRoot = mkdtempSync(join(tmpdir(), "aliexpress-vercel-runtime-"));

try {
  for (const relativeFile of tracedFiles) {
    const source = resolve(routeDirectory, relativeFile);
    const markerIndex = source.indexOf(nodeModulesMarker);
    if (
      markerIndex < 0 ||
      !existsSync(source) ||
      !statSync(source).isFile()
    ) continue;

    const packageRelativePath = source.slice(
      markerIndex + nodeModulesMarker.length,
    );
    const destination = join(runtimeRoot, "node_modules", packageRelativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }

  const manifest = readFileSync(resolve(projectRoot, "package.json"), "utf8");
  const browserProvider = readFileSync(
    resolve(projectRoot, "src/lib/aliexpress-browser-provider.ts"),
    "utf8",
  );
  assert(
    !manifest.includes("puppeteer-extra"),
    "Pacote Vercel não pode depender novamente de puppeteer-extra.",
  );
  assert(
    !browserProvider.includes("puppeteer-extra"),
    "Browser provider não pode importar a cadeia que perdeu dependências na Vercel.",
  );
  assert(
    tracedFiles.some((file) => file.includes("@sparticuz/chromium/bin/chromium.br")),
    "Trace da função não contém o executável Chromium.",
  );

  const launchBrowser = process.env.CI === "true";
  const probe = `
    import chromium from "@sparticuz/chromium";
    import puppeteer from "puppeteer-core";
    const executablePath = await chromium.executablePath();
    if (!executablePath) throw new Error("Chromium executable missing");
    if (${JSON.stringify(launchBrowser)}) {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [...chromium.args, "--disable-dev-shm-usage"],
      });
      try {
        const page = await browser.newPage();
        await page.setContent("<h1 id='marker'>VERCEL_FUNCTION_BUNDLE_OK</h1>");
        const marker = await page.$eval("#marker", (node) => node.textContent);
        if (marker !== "VERCEL_FUNCTION_BUNDLE_OK") {
          throw new Error("Reduced package browser did not render");
        }
      } finally {
        await browser.close();
      }
    }
    console.log("VERCEL FUNCTION BUNDLE: PASS");
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", probe],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      env: { ...process.env, FONTCONFIG_PATH: join(runtimeRoot, "fonts") },
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert(result.status === 0, "Pacote reduzido da função Vercel não inicializou.");
} finally {
  rmSync(runtimeRoot, { recursive: true, force: true });
}
