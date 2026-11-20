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

    const settingsResponse = await fetch(new URL("/api/local/settings?key=runtime-test", localApp.url));
    assert.equal(settingsResponse.status, 200);
    assert.deepEqual(await settingsResponse.json(), { value: null });

    const pageResponse = await fetch(localApp.url);
    assert.equal(pageResponse.status, 200);
  } finally {
    await localApp.stop();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }

  await assert.rejects(fetch(localApp.url));
});

test("Next development server launches on loopback and stops on quit", { timeout: 90_000 }, async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-desktop-dev-test-"));
  const appSourcePath = path.resolve(__dirname, "../app");
  const tsconfigPath = path.join(appSourcePath, "tsconfig.json");
  const originalTsconfig = fs.readFileSync(tsconfigPath);
  const originalDevArtifacts = fs.readdirSync(appSourcePath).filter((name) => name.startsWith(".next-mosaic-dev-") || name.startsWith(".tsconfig-mosaic-dev-")).sort();
  const localApp = await startLocalAppServer({ appPath: appSourcePath, runtimePath: electronPath, dataDirectory, development: true });

  try {
    assert.equal(new URL(localApp.url).hostname, "127.0.0.1");
    assert.equal((await fetch(localApp.url)).status, 200);
    assert.deepEqual(await (await fetch(new URL("/api/auth/me", localApp.url))).json(), {
      authenticated: true,
      desktopMode: true,
      user: { id: "mosaic-local", username: "Local User", email: "", initials: "LU", workspaceName: "This device" },
    });
  } finally {
    await localApp.stop();
    assert.deepEqual(fs.readFileSync(tsconfigPath), originalTsconfig, "development startup must not modify the shared tsconfig");
    assert.deepEqual(
      fs.readdirSync(appSourcePath).filter((name) => name.startsWith(".next-mosaic-dev-") || name.startsWith(".tsconfig-mosaic-dev-")).sort(),
      originalDevArtifacts,
      "development shutdown must remove its temporary build and TypeScript config",
    );
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }

  await assert.rejects(fetch(localApp.url));
});
