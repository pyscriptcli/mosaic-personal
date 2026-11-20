const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const APP_VERSION = require("../package.json").version;

const REQUEST_TIMEOUT_MS = 30_000;

class CodexAppServer {
  constructor(onEvent, getAppOrigin = () => null) {
    this.onEvent = onEvent;
    this.getAppOrigin = getAppOrigin;
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.approvals = new Map();
    this.readBuffer = "";
    this.threadId = null;
    this.turnId = null;
    this.currentCwd = null;
    this.startPromise = null;
    this.stopping = false;
  }

  async start() {
    if (this.child && this.child.exitCode === null) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async readAccount() {
    await this.start();
    const response = await this.request("account/read", {});
    return response;
  }

  async listModels() {
    await this.start();
    const response = await this.request("model/list", { limit: 100, includeHidden: false });
    return Array.isArray(response.data) ? response.data : [];
  }

  async startThread(workspacePath) {
    await this.start();
    const cwd = path.resolve(workspacePath);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("Choose an existing workspace folder first.");
    const mosaicApiUrl = String(this.getAppOrigin() || "unavailable").replace(/\/$/, "");
    const response = await this.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      developerInstructions: [
        "You are working in the user's Mosaic workspace. Treat the selected workspace folder as the complete working area for their Mosaic files and records.",
        "When the user asks for a report or other saved deliverable, preserve the requested file format; if the format is unspecified, ask which format to use before creating it. Save reports inside `Outputs/` at the workspace root, creating that folder if needed, and confirm the resulting relative path only after verifying the file exists.",
        `When creating records, the loopback Mosaic API base URL is ${mosaicApiUrl}. For a Notebook task, POST JSON to /api/my-day with {action: "create", date: "YYYY-MM-DD", name, description, dueDate, priority, listId}. For a Notebook list, POST {action: "create-list", name} to that route. For day notes, POST {action: "note", date: "YYYY-MM-DD", notes}. For a meeting, POST {meeting: {title, date, meeting_type, location, summary, items}} to /api/meetings. For an IT project, GET /api/business-analysis, append a project shaped like the existing entries in state.projects, then PUT {state} to that route. Use these endpoints only when asked to create a record; verify the response and report its type and ID. Do not claim success when a request fails.`,
        "After a direct creation request succeeds, end the final response with one machine-readable line `MOSAIC_CREATED_ACTION: {json}`. Supported kinds are task `{kind, id, date, title}`, list `{kind, id, title}`, note `{kind, date, title, previousNotes, createdNotes}`, meeting `{kind, id, title}`, project `{kind, id, title}`, and report `{kind, path, sha256, title}`. For notes, read and preserve the prior note text before changing it, and report the exact createdNotes. For reports, use a workspace-relative path under Outputs/ and calculate the SHA-256 after writing. Do not emit the marker unless the item was successfully created and verified.",
        "When the user asks to remove or delete a file or folder inside the workspace, archive it by moving it into `Recycle Bin/<YYYYMMDD-HHmmss>/<original relative path>` at the workspace root. Create the archive directory as needed. Never automatically empty or clean this archive; retain archived items indefinitely. Do not use permanent-delete commands for workspace data.",
        "Do not claim deletion is fully protected: shell commands and native CLI tools can still permanently delete data. Follow the archive rule yourself and ask before any action that would permanently remove workspace data.",
      ].join("\n\n"),
    });
    this.threadId = response.thread?.id;
    this.currentCwd = cwd;
    this.turnId = null;
    if (!this.threadId) throw new Error("Codex started a thread without returning its ID.");
    this.onEvent({ type: "thread/started", threadId: this.threadId, cwd });
    return { threadId: this.threadId, cwd };
  }

  async listThreads(workspacePath) {
    await this.start();
    const cwd = path.resolve(workspacePath);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("Choose an existing workspace folder first.");
    const response = await this.request("thread/list", {
      cwd,
      limit: 50,
      sortKey: "updated_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    });
    return (Array.isArray(response.data) ? response.data : []).map((thread) => ({
      id: thread.id,
      preview: typeof thread.preview === "string" ? thread.preview : "New conversation",
      updatedAt: Number(thread.updatedAt || thread.createdAt || 0),
      cwd: typeof thread.cwd === "string" ? thread.cwd : cwd,
    }));
  }

  async resumeThread(threadId, workspacePath) {
    await this.start();
    const cwd = path.resolve(workspacePath);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("Choose an existing workspace folder first.");
    if (typeof threadId !== "string" || !threadId.trim()) throw new Error("Choose a conversation to resume.");
    const threads = await this.listThreads(cwd);
    if (!threads.some((thread) => thread.id === threadId && path.resolve(thread.cwd) === cwd)) {
      throw new Error("That conversation is not available in the selected workspace.");
    }
    const response = await this.request("thread/resume", {
      threadId,
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      runtimeWorkspaceRoots: [cwd],
      excludeTurns: false,
    });
    this.threadId = response.thread?.id;
    this.currentCwd = cwd;
    this.turnId = null;
    if (!this.threadId) throw new Error("Codex resumed a conversation without returning its ID.");
    this.onEvent({ type: "thread/resumed", threadId: this.threadId, cwd });
    return { threadId: this.threadId, cwd, turns: response.thread?.turns || [] };
  }

  async sendMessage(text, model) {
    if (!this.threadId) throw new Error("Choose a workspace before sending a message.");
    if (typeof model !== "string" || !model.trim()) throw new Error("Choose an available Codex model first.");
    const response = await this.request("turn/start", {
      threadId: this.threadId,
      model: model.trim(),
      input: [{ type: "text", text, text_elements: [] }],
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [this.currentCwd],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });
    this.turnId = response.turn?.id || null;
    return { turnId: this.turnId };
  }

  async interruptTurn() {
    if (!this.threadId || !this.turnId) return false;
    await this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    return true;
  }

  respondToApproval(id, accepted) {
    const key = String(id);
    const method = this.approvals.get(key);
    if (!method) return false;
    this.approvals.delete(key);
    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      this.write({ id, result: { decision: accepted ? "approved" : { denied: { rejection: "Declined in Mosaic." } } } });
      return true;
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      this.write({ id, result: { decision: accepted ? "accept" : "decline" } });
      return true;
    }
    this.write({ id, error: { code: -32000, message: "This approval type is not supported by Mosaic." } });
    return false;
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.threadId = null;
    this.turnId = null;
    this.currentCwd = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }

  async startProcess() {
    this.stopping = false;
    const executable = findCodexExecutable();
    if (!executable) throw new Error("Codex CLI was not found. Install Codex CLI, then restart Mosaic.");
    const child = spawn(executable, ["app-server", "--stdio"], {
      cwd: os.homedir(),
      env: codexEnvironment(this.getAppOrigin()),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.readBuffer = "";
    let startupError = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { startupError = (startupError + chunk).slice(-8_000); });
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code, signal) => {
      this.child = null;
      this.threadId = null;
      this.turnId = null;
      this.currentCwd = null;
      const expected = this.stopping;
      this.failAll(new Error(expected ? "Codex CLI stopped." : `Codex CLI exited (${code ?? signal ?? "unknown"}). ${startupError.trim()}`));
      if (!expected) this.onEvent({ type: "process/exited", code, signal, message: startupError.trim() });
    });

    try {
      const initialized = await this.request("initialize", {
        clientInfo: { name: "mosaic_desktop", title: "Mosaic", version: APP_VERSION },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      if (!initialized) throw new Error("Codex CLI initialization failed.");
      this.write({ method: "initialized", params: {} });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  write(message) {
    if (!this.child || this.child.exitCode !== null || this.child.stdin.destroyed) throw new Error("Codex CLI is not connected.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleStdout(chunk) {
    this.readBuffer += chunk;
    let newline;
    while ((newline = this.readBuffer.indexOf("\n")) >= 0) {
      const line = this.readBuffer.slice(0, newline).trim();
      this.readBuffer = this.readBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        this.onEvent({ type: "protocol/error", message: "Codex CLI returned an unreadable response." });
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || `Codex request failed: ${pending.method}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      const method = message.method;
      this.approvals.set(String(message.id), method);
      if (["execCommandApproval", "applyPatchApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)) {
        this.onEvent({ type: "approval", id: message.id, method, params: message.params || {} });
      } else {
        this.onEvent({ type: "unsupported-request", id: message.id, method });
        this.write({ id: message.id, error: { code: -32000, message: "Mosaic does not support this Codex request." } });
      }
      return;
    }
    if (typeof message.method === "string") {
      const params = message.params || {};
      if (message.method === "item/agentMessage/delta" && params.delta) {
        this.onEvent({ type: message.method, threadId: params.threadId, turnId: params.turnId, delta: params.delta });
        return;
      }
      if (message.method === "turn/started") this.turnId = params.turn?.id || this.turnId;
      if (message.method === "turn/completed") this.turnId = null;
      if (["account/updated", "turn/started", "turn/completed", "item/started", "item/completed"].includes(message.method)) {
        this.onEvent({ type: message.method, params });
      }
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
  }
}

function codexEnvironment(appOrigin = null) {
  const env = {};
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "CODEX_HOME"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  try {
    const parsed = new URL(String(appOrigin || ""));
    if (parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname)) env.MOSAIC_APP_URL = parsed.origin;
  } catch { /* Codex can work with files when no local app server is configured. */ }
  return env;
}

function findCodexExecutable() {
  const env = codexEnvironment();
  const candidates = [];
  const pathValue = env.PATH || env.Path || "";
  for (const directory of pathValue.split(path.delimiter)) candidates.push(path.join(directory, "codex.exe"));

  const localCodexBin = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin") : null;
  if (localCodexBin && fs.existsSync(localCodexBin)) {
    for (const entry of fs.readdirSync(localCodexBin, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(localCodexBin, entry.name, "codex.exe"));
    }
  }

  try {
    const located = execFileSync("where.exe", ["codex.exe"], { encoding: "utf8", timeout: 2_000, windowsHide: true, env });
    candidates.unshift(...located.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  } catch {
    // Search known native install locations if PATH lookup is unavailable.
  }
  return candidates.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate)) || null;
}

module.exports = { CodexAppServer, findCodexExecutable };
