import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { StateStore } from "../src/state";

test("StateStore persists book progress", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-state-"));
  const store = new StateStore(tempDir);
  const state = store.load();
  const progress = store.ensureProgress(state, "book-1");

  progress.currentChapter = 7;
  progress.scrollPercent = 64;
  progress.bookmarks.push({
    id: "bookmark-1",
    label: "Return here",
    chapterIndex: 7,
    scrollPercent: 64,
    createdAt: "2026-04-10T00:00:00.000Z",
  });

  store.save(state);

  const reloadedState = store.load();
  assert.equal(reloadedState.books["book-1"]?.currentChapter, 7);
  assert.equal(reloadedState.books["book-1"]?.scrollPercent, 64);
  assert.equal(reloadedState.books["book-1"]?.bookmarks.length, 1);
});

test("StateStore writes private permissions for the app home and state file", () => {
  if (process.platform === "win32") {
    return;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-state-"));
  const store = new StateStore(path.join(tempDir, ".wuxiaworld-tui"));

  store.save({
    books: {},
    recentNovels: [],
    preferences: undefined,
  });

  const homeMode = statSync(store.homeDir).mode & 0o777;
  const stateMode = statSync(store.stateFilePath).mode & 0o777;

  assert.equal(homeMode, 0o700);
  assert.equal(stateMode, 0o600);
});

test("StateStore infers legacy text color from saved theme", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-state-"));
  const stateFilePath = path.join(tempDir, "state.json");

  writeFileSync(
    stateFilePath,
    JSON.stringify({
      books: {},
      recentNovels: [],
      preferences: {
        theme: "amber",
        textScale: "comfortable",
        zenMode: false,
        lineWidth: "balanced",
        lineSpacing: "normal",
        paragraphSpacing: "normal",
        paragraphIndent: false,
        justify: false,
      },
    }),
    "utf8",
  );

  const store = new StateStore(tempDir);
  const state = store.load();

  assert.equal(state.preferences?.textColor, "yellow");
});

test("StateStore preserves explicit bright white text color", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-state-"));
  const stateFilePath = path.join(tempDir, "state.json");

  writeFileSync(
    stateFilePath,
    JSON.stringify({
      books: {},
      recentNovels: [],
      preferences: {
        theme: "midnight",
        textColor: "brightwhite",
        textScale: "comfortable",
        readerMode: "paged",
        zenMode: false,
        lineWidth: "balanced",
        lineSpacing: "normal",
        paragraphSpacing: "normal",
        paragraphIndent: false,
        justify: false,
      },
    }),
    "utf8",
  );

  const store = new StateStore(tempDir);
  const state = store.load();

  assert.equal(state.preferences?.textColor, "brightwhite");
});
