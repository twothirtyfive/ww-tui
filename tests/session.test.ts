import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../src/session";

test("SessionStore persists cookies and auth tokens together", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-session-"));
  const store = new SessionStore(tempDir);

  store.save(
    [
      {
        name: "identity",
        value: "cookie-value",
        domain: "identity.wuxiaworld.com",
        path: "/",
        secure: true,
        hostOnly: true,
      },
    ],
    {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresAt: "2026-04-10T00:00:00.000Z",
    },
  );

  const reloaded = store.read();
  assert.equal(reloaded.cookies.length, 1);
  assert.equal(reloaded.cookies[0]?.name, "identity");
  assert.equal(reloaded.auth?.accessToken, "access-token");
  assert.equal(reloaded.auth?.refreshToken, "refresh-token");
  assert.equal(reloaded.auth?.tokenType, "Bearer");
});

test("SessionStore writes private permissions for the app home and session file", () => {
  if (process.platform === "win32") {
    return;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wuxiaworld-session-"));
  const store = new SessionStore(path.join(tempDir, ".wuxiaworld-tui"));

  store.save([], {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
  });

  const homeMode = statSync(store.homeDir).mode & 0o777;
  const sessionMode = statSync(store.sessionFilePath).mode & 0o777;

  assert.equal(homeMode, 0o700);
  assert.equal(sessionMode, 0o600);
});
