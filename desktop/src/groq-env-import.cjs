const fs = require("node:fs");

const MAX_ENV_FILE_BYTES = 256 * 1024;

function readGroqTranscriptionKeys(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_ENV_FILE_BYTES) throw new Error("Choose a .env file smaller than 256 KB.");
  const source = fs.readFileSync(filePath, "utf8");
  const values = new Map();

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (name !== "GROQ_API_KEY" && name !== "GROQ_API_KEYS" && !/^GROQ_API_KEY_\d{1,2}$/.test(name)) continue;
    let value = rawValue;
    if (value.startsWith("\"") || value.startsWith("'")) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);
      if (end < 0 || (value.slice(end + 1).trim() && !value.slice(end + 1).trim().startsWith("#"))) continue;
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (!value || value.length > 500) continue;
    values.set(name, value);
  }

  const keys = [];
  if (values.has("GROQ_API_KEYS")) keys.push(...values.get("GROQ_API_KEYS").split(",").map((value) => value.trim()).filter(Boolean));
  if (values.has("GROQ_API_KEY")) keys.push(values.get("GROQ_API_KEY"));
  for (let index = 1; index <= 20; index += 1) {
    const key = values.get(`GROQ_API_KEY_${index}`);
    if (key) keys.push(key);
  }
  return [...new Set(keys.filter((key) => key.length <= 500))];
}

module.exports = { readGroqTranscriptionKeys };
