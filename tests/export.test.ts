import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { exportNotebook } from "../src/export";

test("exportNotebook writes bookmarks and notes to markdown", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-export-"));
  const exportPath = exportNotebook(
    tempDir,
    "A Will Eternal",
    "Er Gen",
    {
      currentChapter: 1,
      scrollPercent: 42,
      bookmarks: [
        {
          id: "bookmark-1",
          label: "Good cliffhanger",
          chapterIndex: 0,
          scrollPercent: 25,
          createdAt: "2026-04-10T00:00:00.000Z",
        },
      ],
      annotations: [
        {
          id: "annotation-1",
          note: "Check recurring sect politics here.",
          chapterIndex: 1,
          scrollPercent: 42,
          createdAt: "2026-04-10T00:00:00.000Z",
        },
      ],
    },
    [
      { id: "c1", title: "Chapter 1", order: 1 },
      { id: "c2", title: "Chapter 2", order: 2 },
    ],
  );

  const exportedContent = readFileSync(exportPath, "utf8");

  assert.match(exportedContent, /# A Will Eternal/);
  assert.match(exportedContent, /Good cliffhanger/);
  assert.match(exportedContent, /Check recurring sect politics here\./);
});

test("exportNotebook keeps exported notes in a private directory", () => {
  if (process.platform === "win32") {
    return;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-export-"));
  const exportPath = exportNotebook(
    tempDir,
    "A Will Eternal",
    "Er Gen",
    {
      currentChapter: 0,
      scrollPercent: 0,
      bookmarks: [],
      annotations: [],
    },
    [{ id: "c1", title: "Chapter 1", order: 1 }],
  );

  const exportDirMode = statSync(path.dirname(exportPath)).mode & 0o777;
  const exportFileMode = statSync(exportPath).mode & 0o777;

  assert.equal(exportDirMode, 0o700);
  assert.equal(exportFileMode, 0o600);
});
