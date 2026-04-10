import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const entries = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => !name.startsWith("."))
  .filter((name) => !name.endsWith(".sha256"));

for (const name of readdirSync(releaseDir)) {
  if (name.endsWith(".sha256")) {
    rmSync(path.join(releaseDir, name), { force: true });
  }
}

for (const name of entries) {
  const hash = sha256(path.join(releaseDir, name));
  writeFileSync(path.join(releaseDir, `${name}.sha256`), `${hash}  ${name}\n`, "utf8");
}

console.log(`Wrote checksums for ${entries.length} release file(s).`);
