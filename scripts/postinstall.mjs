import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);

async function main() {
  try {
    const chromiumResolved = import.meta.resolve("@sparticuz/chromium");
    const chromiumFile = fileURLToPath(chromiumResolved);
    const chromiumRoot = dirname(dirname(dirname(chromiumFile)));
    const binDir = join(chromiumRoot, "bin");

    if (!existsSync(binDir)) {
      console.warn("Chromium bin directory not found; runtime browser pack was not generated.");
      return;
    }

    const publicDir = join(projectRoot, "public");
    const outputPath = join(publicDir, "chromium-pack.tar");
    mkdirSync(publicDir, { recursive: true });

    execFileSync("tar", ["-cf", outputPath, "-C", binDir, "."], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    console.log(`Chromium runtime pack generated: ${outputPath}`);
  } catch (error) {
    console.warn("Chromium pack generation skipped:", error instanceof Error ? error.message : error);
  }
}

await main();
