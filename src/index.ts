#!/usr/bin/env node

import { WuxiaWorldApp } from "./app";

function printHelp(): void {
  console.log("Usage: wuxiaworld-tui");
  console.log("");
  console.log("Inside the TUI:");
  console.log("  l  log in and save a session");
  console.log("  u  clear the saved session");
  console.log("  f  search and sort novels from the live catalog");
  console.log("  o  open a novel by slug or URL");
  console.log("  g  open a chapter by slug or URL");
  console.log("  r  refresh the current chapter");
  console.log("  t  cycle reader theme");
  console.log("  c  cycle text color");
  console.log("  m  toggle page or scroll mode");
  console.log("  s  cycle text size");
  console.log("  w  cycle line width");
  console.log("  L  cycle line gap");
  console.log("  P  cycle paragraph gap");
  console.log("  i  toggle paragraph indent");
  console.log("  J  toggle justification");
  console.log("  z  toggle zen mode");
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === "--help" || argument === "-h") {
    printHelp();
    return;
  }

  const app = new WuxiaWorldApp();
  await app.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
