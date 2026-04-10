import os from "node:os";
import path from "node:path";

export function expandHomePath(inputPath: string): string {
  if (!inputPath.startsWith("~")) {
    return inputPath;
  }

  return path.join(os.homedir(), inputPath.slice(1));
}

export function resolveAppHome(): string {
  const configuredPath =
    process.env.WUXIAWORLD_TUI_HOME?.trim() || path.join(os.homedir(), ".wuxiaworld-tui");

  return path.resolve(expandHomePath(configuredPath));
}
