const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { startLocalAppServer } = require("../src/local-app-server.cjs");

const localAppPath = process.env.MOSAIC_LOCAL_APP_PATH || path.resolve(__dirname, "../build/local-app");
const electronPath = require("electron");

test("staged desktop app serves locally through Electron runtime and stops on quit", async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-desktop-test-"));
  const localApp = await startLocalAppServer({ appPath: localAppPath, runtimePath: electronPath, dataDirectory });

  try {
    assert.equal(new URL(localApp.url).hostname, "127.0.0.1");
    const sessionResponse = await fetch(new URL("/api/auth/me", localApp.url));
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), {
      authenticated: true,
      desktopMode: true,
      user: { id: "mosaic-local", username: "Local User", email: "", initials: "LU", workspaceName: "This device" },
    });

    const accessResponse = await fetch(new URL("/api/forms/config", localApp.url));
    assert.equal(accessResponse.status, 200);
    const access = await accessResponse.json();
    assert.equal(access.source, "desktop-local");
    assert.equal(access.isAdmin, false);
    assert.ok(access.allowedPages.includes("dashboard"));
    assert.ok(access.allowedPages.includes("business-analysis"));

    const pageResponse = await fetch(localApp.url);
    assert.equal(pageResponse.status, 200);
  } finally {
    await localApp.stop();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }

  await assert.rejects(fetch(localApp.url));
});
