const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopDirectory = path.resolve(__dirname, "..");
const appSourceDirectory = path.join(desktopDirectory, "app");
const appBuild = path.join(appSourceDirectory, ".next");
const buildDirectory = path.join(desktopDirectory, "build");
const localAppDirectory = path.join(buildDirectory, "local-app");

if (!localAppDirectory.startsWith(`${buildDirectory}${path.sep}`)) {
  throw new Error("Local app staging path must stay under desktop/build.");
}

if (!fs.existsSync(path.join(appBuild, "BUILD_ID"))) {
  throw new Error("Desktop app build is missing. Run npm --prefix app run build first.");
}

// Stage only production files so the installer can run without the checkout.
fs.rmSync(localAppDirectory, { recursive: true, force: true });
fs.mkdirSync(localAppDirectory, { recursive: true });
for (const file of ["package.json", "package-lock.json", "next.config.ts"]) {
  fs.copyFileSync(path.join(appSourceDirectory, file), path.join(localAppDirectory, file));
}
const runtimeBuild = path.join(localAppDirectory, ".next");
fs.mkdirSync(runtimeBuild, { recursive: true });
// Keep only files Next needs to serve requests; leave build caches and trace data out of the installer.
const buildOnlyDirectories = new Set(["cache", "diagnostics", "node_modules", "trace", "trace-build", "turbopack", "types"]);
for (const entry of fs.readdirSync(appBuild, { withFileTypes: true })) {
  if (entry.isDirectory() && buildOnlyDirectories.has(entry.name)) continue;
  fs.cpSync(path.join(appBuild, entry.name), path.join(runtimeBuild, entry.name), { recursive: true });
}
fs.cpSync(path.join(appSourceDirectory, "public"), path.join(localAppDirectory, "public"), { recursive: true });

// Install production dependencies into the staged app, not the developer checkout.
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installEnv = { ...process.env };
for (const name of Object.keys(installEnv)) if (/^npm_/i.test(name)) delete installEnv[name];
const install = spawnSync(npmCommand, ["ci", "--omit=dev", "--ignore-scripts"], {
  cwd: localAppDirectory,
  env: installEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

console.log(`Prepared local Mosaic app at ${localAppDirectory}`);
