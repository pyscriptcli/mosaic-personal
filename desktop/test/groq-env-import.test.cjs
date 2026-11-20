const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readGroqTranscriptionKeys } = require("../src/groq-env-import.cjs");

test("imports only Groq transcription keys and removes duplicates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-groq-env-test-"));
  const filePath = path.join(directory, ".env");
  fs.writeFileSync(filePath, [
    "OPENAI_API_KEY=not-a-transcription-key",
    "GROQ_API_KEY_2='second-key' # local note",
    "export GROQ_API_KEY_1=first-key",
    "GROQ_API_KEY_3=second-key",
    "GROQ_API_KEY_21=ignored-key",
    "GROQ_API_KEY=first-key",
    "",
  ].join("\n"));

  try {
    assert.deepEqual(readGroqTranscriptionKeys(filePath), ["first-key", "second-key"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects oversized env files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-groq-env-test-"));
  const filePath = path.join(directory, ".env");
  fs.writeFileSync(filePath, "x".repeat(256 * 1024 + 1));
  try {
    assert.throws(() => readGroqTranscriptionKeys(filePath), /smaller than 256 KB/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
