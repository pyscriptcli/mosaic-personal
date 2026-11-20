const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CodexAppServer } = require("../src/codex-app-server.cjs");

test("Codex threads receive the Mosaic archive policy and workspace root", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-codex-workspace-"));
  const server = new CodexAppServer(() => {});
  let request;
  server.start = async () => {};
  server.request = async (method, params) => {
    request = { method, params };
    return { thread: { id: "thread-test" } };
  };

  try {
    const result = await server.startThread(directory);
    assert.equal(result.cwd, path.resolve(directory));
    assert.equal(request.method, "thread/start");
    assert.equal(request.params.cwd, path.resolve(directory));
    assert.match(request.params.developerInstructions, /Recycle Bin/);
    assert.match(request.params.developerInstructions, /indefinitely/);
    assert.match(request.params.developerInstructions, /permanently delete/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Codex turns use the selected model and expose the available model catalog", async () => {
  const server = new CodexAppServer(() => {});
  let turnRequest;
  server.start = async () => {};
  server.threadId = "thread-test";
  server.currentCwd = process.cwd();
  server.request = async (method, params) => {
    if (method === "model/list") return { data: [{ model: "gpt-6-luna-medium", displayName: "GPT-6 Luna Medium" }] };
    turnRequest = { method, params };
    return { turn: { id: "turn-test" } };
  };

  assert.deepEqual(await server.listModels(), [{ model: "gpt-6-luna-medium", displayName: "GPT-6 Luna Medium" }]);
  await server.sendMessage("Hello", "gpt-6-luna-medium");
  assert.equal(turnRequest.method, "turn/start");
  assert.equal(turnRequest.params.model, "gpt-6-luna-medium");
});
