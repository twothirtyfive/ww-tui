import { chmodSync, mkdirSync, writeFileSync } from "node:fs";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });

  if (process.platform !== "win32") {
    chmodSync(directoryPath, PRIVATE_DIRECTORY_MODE);
  }
}

export function writePrivateTextFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });

  if (process.platform !== "win32") {
    chmodSync(filePath, PRIVATE_FILE_MODE);
  }
}
