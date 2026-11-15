const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;

async function startLocalAppServer({ appPath, runtimePath, dataDirectory }) {
  const nextCli = path.join(appPath, "node_modules", "next", "dist", "bin", "next");
  const port = await getAvailablePort();
  const url = `http://${HOST}:${port}/`;
  const output = [];
  const env = { ELECTRON_RUN_AS_NODE: "1", HOSTNAME: HOST, MOSAIC_DESKTOP: "1", MOSAIC_DESKTOP_NO_LOGIN: "1", MOSAIC_DATA_DIR: path.resolve(dataDirectory), NODE_ENV: "production", PORT: String(port) };

  // Pass OS paths only. Do not inherit API keys from the desktop launch environment.
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[name]) env[name] = process.env[name];
  }

  // Start Next on loopback. Never expose Mosaic's local API to the network.
  const child = spawn(runtimePath, [nextCli, "start", "--hostname", HOST, "--port", String(port)], {
    cwd: appPath,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output.push(chunk.toString());
      if (output.join("").length > 8_000) output.shift();
    });
  }

  try {
    await waitUntilReady(child, url, output);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  let stopPromise;
  return {
    url,
    stop() {
      // Reuse one shutdown operation if multiple quit paths run together.
      stopPromise ||= stopChild(child);
      return stopPromise;
    },
  };
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(child, url, output) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let spawnError;
  child.once("error", (error) => { spawnError = error; });

  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start Mosaic's local server: ${spawnError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Mosaic's local server exited before startup. ${output.join("").trim()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // Keep polling while Next starts. The app window opens only after HTTP responds.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Mosaic's local server did not become ready. ${output.join("").trim()}`);
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForExit(child, 5_000)) return;

  if (process.platform === "win32") {
    // Stop Next and any worker processes when Windows does not end the child cleanly.
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  }

  if (!await waitForExit(child, 5_000)) throw new Error("Mosaic's local server did not stop.");
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onExit = () => finish(true);
    function finish(exited) {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    }
    child.once("exit", onExit);
  });
}

module.exports = { startLocalAppServer };
