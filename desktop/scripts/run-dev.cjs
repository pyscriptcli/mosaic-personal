const { spawn } = require("node:child_process");
const path = require("node:path");

const electronPath = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [".", "--mosaic-dev", ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(`Could not start Mosaic Desktop development mode: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
