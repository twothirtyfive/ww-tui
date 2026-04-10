import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const seaTempDir = path.join(releaseDir, ".sea");
const seaEntryPath = path.join(seaTempDir, "entry.cjs");
const seaConfigPath = path.join(seaTempDir, "sea-config.json");
const seaBlobPath = path.join(seaTempDir, "sea-prep.blob");
const postjectCliPath = path.join(rootDir, "node_modules", "postject", "dist", "cli.js");

function outputBinaryName() {
  const baseName = `wuxiaworld-tui-${process.platform}-${process.arch}`;
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

async function buildSeaBundle() {
  await build({
    entryPoints: [path.join(rootDir, "src", "index.ts")],
    outfile: seaEntryPath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: false,
    legalComments: "none",
    external: ["term.js", "pty.js", "blessed/lib/colors"],
  });
}

function writeSeaConfig() {
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: seaEntryPath,
        output: seaBlobPath,
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function generateSeaBlob() {
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

function injectSeaBlob(outputBinaryPath) {
  const args = [
    postjectCliPath,
    outputBinaryPath,
    "NODE_SEA_BLOB",
    seaBlobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];

  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }

  execFileSync(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
}

function removeSignature(outputBinaryPath) {
  if (process.platform !== "darwin") {
    return;
  }

  execFileSync("codesign", ["--remove-signature", outputBinaryPath], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

function signBinary(outputBinaryPath) {
  if (process.platform !== "darwin") {
    return;
  }

  execFileSync("codesign", ["--sign", "-", outputBinaryPath], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

async function main() {
  mkdirSync(releaseDir, { recursive: true });
  rmSync(seaTempDir, { recursive: true, force: true });
  mkdirSync(seaTempDir, { recursive: true });

  const outputBinaryPath = path.join(releaseDir, outputBinaryName());
  rmSync(outputBinaryPath, { force: true });

  try {
    await buildSeaBundle();
    writeSeaConfig();
    generateSeaBlob();

    copyFileSync(process.execPath, outputBinaryPath);
    removeSignature(outputBinaryPath);
    injectSeaBlob(outputBinaryPath);
    signBinary(outputBinaryPath);

    if (process.platform !== "win32") {
      chmodSync(outputBinaryPath, 0o755);
    }
  } finally {
    rmSync(seaTempDir, { recursive: true, force: true });
  }

  console.log(`Binary ready: ${outputBinaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
