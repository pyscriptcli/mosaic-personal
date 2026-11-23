const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;

async function startLocalAppServer({ appPath, runtimePath, dataDirectory, recordingsDirectory, internalDataDirectory, ffmpegPath, ffprobePath, apiKeys, transcriptionKeys = [], development = false }) {
  const nextCli = path.join(appPath, "node_modules", "next", "dist", "bin", "next");
  const port = await getAvailablePort();
  const url = `http://${HOST}:${port}/`;
  const output = [];
  const devBuildId = development ? `${process.pid}-${crypto.randomUUID()}` : null;
  const developmentDistDir = devBuildId ? `.next-mosaic-dev-${devBuildId}` : null;
  const developmentTsconfig = devBuildId ? `.tsconfig-mosaic-dev-${devBuildId}.json` : null;
  if (developmentTsconfig) {
    fs.copyFileSync(path.join(appPath, "tsconfig.json"), path.join(appPath, developmentTsconfig), fs.constants.COPYFILE_EXCL);
  }
  const env = {
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: HOST,
    MOSAIC_DESKTOP: "1",
    MOSAIC_DESKTOP_NO_LOGIN: "1",
    MOSAIC_DESKTOP_TRANSCRIPTION_ONLY: "1",
    MOSAIC_DATA_DIR: path.resolve(dataDirectory),
    MOSAIC_INTERNAL_DATA_DIR: path.resolve(internalDataDirectory || path.join(dataDirectory, ".internal")),
    MOSAIC_RECORDINGS_DIR: path.resolve(recordingsDirectory || path.join(dataDirectory, "recordings")),
    NODE_ENV: development ? "development" : "production",
    PORT: String(port),
    GROQ_TRANSCRIPTION_API_KEYS_JSON: JSON.stringify(Array.isArray(transcriptionKeys) ? transcriptionKeys : []),
  };
  if (ffmpegPath) env.MOSAIC_FFMPEG_PATH = path.resolve(ffmpegPath);
  if (ffprobePath) env.MOSAIC_FFPROBE_PATH = path.resolve(ffprobePath);
  if (developmentDistDir) env.MOSAIC_NEXT_DIST_DIR = developmentDistDir;
  if (developmentTsconfig) env.MOSAIC_NEXT_TSCONFIG_PATH = developmentTsconfig;

  const apiKeyEnvironment = {
    DEEPSEEK_API_KEY: "deepseek",
    OPENAI_API_KEY: "openai",
    OPENROUTER_API_KEY: "openrouter",
    GEMINI_API_KEY: "gemini",
  };
  for (const [name, provider] of Object.entries(apiKeyEnvironment)) {
    const value = apiKeys?.[provider];
    if (typeof value === "string" && value) env[name] = value;
  }

  // Pass OS paths only. Do not inherit API keys from the desktop launch environment.
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[name]) env[name] = process.env[name];
  }

  // Start Next on loopback. Never expose Mosaic's local API to the network.
  const nextCommand = development ? "dev" : "start";
  const child = spawn(runtimePath, [nextCli, nextCommand, "--hostname", HOST, "--port", String(port)], {
    cwd: appPath,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      if (output.join("").length > 8_000) output.shift();
      if (development) process.stdout.write(text);
    });
  }

  try {
    await waitUntilReady(child, url, output);
    try {
      const conversionResponse = await fetch(new URL("api/recordings/conversion", url), { signal: AbortSignal.timeout(5_000) });
      if (!conversionResponse.ok) console.warn(`[Mosaic] Recording migration scan could not start (HTTP ${conversionResponse.status}).`);
    } catch (error) {
      console.warn("[Mosaic] Recording migration scan could not start:", error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    await stopChild(child);
    removeDevelopmentArtifacts(appPath, developmentDistDir, developmentTsconfig);
    throw error;
  }

  let stopPromise;
  return {
    url,
    stop() {
      // Reuse one shutdown operation if multiple quit paths run together.
      stopPromise ||= stopChild(child).then(() => removeDevelopmentArtifacts(appPath, developmentDistDir, developmentTsconfig));
      return stopPromise;
    },
  };
}

function removeDevelopmentArtifacts(appPath, distDir, tsconfigPath) {
  const appRoot = path.resolve(appPath);
  if (distDir) {
    const target = path.resolve(appRoot, distDir);
    if (path.dirname(target) !== appRoot || !path.basename(target).startsWith(".next-mosaic-dev-")) {
      throw new Error("Refusing to remove an unexpected Next.js development build directory.");
    }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
  if (tsconfigPath) {
    const target = path.resolve(appRoot, tsconfigPath);
    if (path.dirname(target) !== appRoot || !path.basename(target).startsWith(".tsconfig-mosaic-dev-")) {
      throw new Error("Refusing to remove an unexpected Next.js development config.");
    }
    fs.rmSync(target, { force: true, maxRetries: 8, retryDelay: 250 });
  }
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
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Electron's Node runtime can leave Turbopack workers behind after its parent exits.
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    if (await waitForExit(child, 5_000)) return;
  }

  if (child.exitCode === null && child.signalCode === null) child.kill();
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
