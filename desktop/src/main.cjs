const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const { startLocalAppServer } = require("./local-app-server.cjs");
const { CodexAppServer } = require("./codex-app-server.cjs");
const { syncWorkspace } = require("./workspace-sync.cjs");

const developmentRun = process.argv.includes("--mosaic-dev");
const developmentQuitRequest = developmentRun && process.argv.includes("--mosaic-dev-quit");
if (developmentRun) {
  app.setName("Mosaic Desktop Dev");
  app.setPath("userData", path.join(app.getPath("appData"), "Mosaic Desktop Dev"));
}
let APP_ORIGIN = null;
let localAppServer;
let localAppOptions;
let codexAppServer;
let backupTimer;
let dailyBackupInProgress = false;
const APP_PARTITION = developmentRun ? "persist:mosaic-local-first-dev" : "persist:mosaic-local-first";
const CLICKUP_HOST = "clickup.com";
let mainWindow;
let mainWindowWasShown = false;
let reminderWindow;
let reminderTimer;
let reminderCanClose = false;
let tray;
let isQuitting = false;
let updatePollTimer;
let workspaceWatcher;
let workspaceSyncTimer;
let workspaceSyncInterval;
let workspaceSyncInProgress = false;
let workspaceSyncState = { status: "idle", uploaded: 0, downloaded: 0, deleted: 0, syncedAt: null, error: null };
const updateState = { status: "idle", currentVersion: app.getVersion(), version: null, percent: 0, releaseNotes: null, error: null };
let settings = { startWithWindows: false, closeToTrayNoticeShown: false, mediaPermissionGranted: false, codexWorkspaceDirectory: null, workspaceParentDirectory: null, devWorkspaceDirectory: null, supabaseUrl: "", encryptedSupabaseKey: null, encryptedApiKeys: {}, encryptedGroqTranscriptionKeys: [] };
let displayCaptureSequence = 0;
const pendingDisplayCaptures = new Map();

function normalizeReminderTasks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((task) => {
    if (!task || typeof task !== "object") return [];
    const name = typeof task.name === "string" ? task.name.trim().slice(0, 240) : "";
    if (!name) return [];
    return [{
      id: typeof task.id === "string" ? task.id.slice(0, 100) : name,
      name,
      description: typeof task.description === "string" ? task.description.slice(0, 1200) : "",
      priority: task.priority === "high" ? "high" : null,
      dueDate: typeof task.dueDate === "string" ? task.dueDate.slice(0, 10) : "",
      notebookDate: typeof task.notebookDate === "string" ? task.notebookDate.slice(0, 10) : "",
      overdue: task.overdue === true,
      completed: task.completed === true,
    }];
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (developmentQuitRequest) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (developmentRun && commandLine.includes("--mosaic-dev-quit")) {
      isQuitting = true;
      app.quit();
      return;
    }
    showMainWindow();
  });
  app.on("session-end", () => { isQuitting = true; });

  app.whenReady().then(async () => {
    app.setAppUserModelId(developmentRun ? "com.primephilippines.mosaic.dev" : "com.primephilippines.mosaic");
    readSettings();
    removeLegacyClickUpRecords();
    if (!developmentRun && settings.workspaceParentDirectory && isGitCheckout(path.join(settings.workspaceParentDirectory, "Mosaic"))) {
      settings.workspaceParentDirectory = null;
    }
    if (developmentRun) {
      if (settings.devWorkspaceDirectory && isGitCheckout(settings.devWorkspaceDirectory)) settings.devWorkspaceDirectory = null;
      if (!settings.devWorkspaceDirectory) {
        const choice = await dialog.showMessageBox({
          type: "question",
          title: "Choose Mosaic development data",
          message: "Use existing Mosaic records or create a separate development workspace?",
          detail: "Choose the Mosaic data folder itself, such as Documents\\Mosaic. Development settings and browser data stay separate from the installed app.",
          buttons: ["Choose existing Mosaic folder", "Create development workspace", "Quit"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (choice.response === 2) { app.quit(); return; }
        if (choice.response === 1) {
          settings.devWorkspaceDirectory = path.join(app.getPath("userData"), "data", "Mosaic");
          saveSettings();
        } else {
          const selected = await dialog.showOpenDialog({ title: "Choose the existing Mosaic data folder", properties: ["openDirectory"] });
          if (selected.canceled || !selected.filePaths[0]) { app.quit(); return; }
          const candidate = path.resolve(selected.filePaths[0]);
          if (isGitCheckout(candidate)) {
            await dialog.showMessageBox({
              type: "warning",
              title: "Choose the Mosaic data folder, not its source checkout",
              message: "This folder is a Git checkout.",
              detail: "Choose the folder that contains your Mosaic records, such as Documents\\Mosaic.",
              buttons: ["Quit"],
              noLink: true,
            });
            app.quit();
            return;
          }
          settings.devWorkspaceDirectory = candidate;
          saveSettings();
        }
      }
    } else if (!settings.workspaceParentDirectory) {
      while (!settings.workspaceParentDirectory) {
        const selected = await dialog.showOpenDialog({ title: "Choose where Mosaic saves its local files", properties: ["openDirectory", "createDirectory"] });
        if (selected.canceled || !selected.filePaths[0]) {
          app.quit();
          return;
        }
        const candidate = path.resolve(selected.filePaths[0]);
        if (isGitCheckout(path.join(candidate, "Mosaic"))) {
          await dialog.showMessageBox({
            type: "warning",
            title: "Choose a different Mosaic data folder",
            message: "This location already contains a Mosaic Git checkout.",
            detail: "Mosaic cannot use a source repository as its local data folder. Choose another parent folder, such as Documents.",
            buttons: ["Choose another folder"],
            noLink: true,
          });
          continue;
        }
        settings.workspaceParentDirectory = candidate;
        saveSettings();
      }
    }
    const workspaceDirectory = developmentRun
      ? settings.devWorkspaceDirectory
      : path.join(settings.workspaceParentDirectory, "Mosaic");
    for (const folder of ["IT Projects", "Meetings", "Notebook", "Notetaker", path.join("Notetaker", "Recordings")]) {
      fs.mkdirSync(path.join(workspaceDirectory, folder), { recursive: true });
    }
    const appPath = app.isPackaged
      ? path.join(process.resourcesPath, "local-app")
      : path.join(__dirname, "..", developmentRun ? "app" : "build/local-app");
    localAppOptions = {
      appPath,
      runtimePath: process.execPath,
      dataDirectory: workspaceDirectory,
      internalDataDirectory: path.join(app.getPath("userData"), "data"),
      recordingsDirectory: path.join(workspaceDirectory, "Notetaker", "Recordings"),
      apiKeys: decryptApiKeys(settings.encryptedApiKeys),
      transcriptionKeys: decryptGroqTranscriptionKeys(),
      development: developmentRun,
    };

    try {
      // Start the local Mosaic app before opening its desktop window.
      localAppServer = await startLocalAppServer(localAppOptions);
      APP_ORIGIN = new URL(localAppServer.url).origin;
      if (developmentRun) console.info(`[Mosaic] Development mode: ${APP_ORIGIN}`);
    } catch (error) {
      dialog.showErrorBox("Mosaic could not start", error instanceof Error ? error.message : String(error));
      isQuitting = true;
      app.quit();
      return;
    }

    setPermissionPolicy();
    registerReminderBridge();
    registerRecordingBridge();
    registerWorkspaceBridge();
    registerCodexBridge();
    registerUpdateBridge();
    createTray();
    createMainWindow();
    startUpdateChecks();
    applyStartupSetting();
    scheduleNextReminder();
    backupTimer = setInterval(() => { tryDailyBackup(); }, 60 * 60 * 1000);
    tryDailyBackup();

    app.on("activate", showMainWindow);
  });

  app.on("before-quit", (event) => {
    if (isQuitting) {
      if (!localAppServer) return;
      event.preventDefault();
      const server = localAppServer;
      localAppServer = null;
      void server.stop()
        .catch((error) => console.error("Could not stop Mosaic's local server:", error))
        .then(() => codexAppServer?.stop())
        .catch((error) => console.error("Could not stop Codex CLI:", error))
        .finally(() => app.quit());
      return;
    }
    event.preventDefault();
    confirmQuit();
  });

  app.on("will-quit", () => {
    if (backupTimer) clearInterval(backupTimer);
    if (updatePollTimer) clearInterval(updatePollTimer);
    if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer);
    if (workspaceSyncInterval) clearInterval(workspaceSyncInterval);
    workspaceWatcher?.close();
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
}

function readSettings() {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings = {
      startWithWindows: saved.startWithWindows === true,
      closeToTrayNoticeShown: saved.closeToTrayNoticeShown === true,
      mediaPermissionGranted: saved.mediaPermissionGranted === true,
      workspaceParentDirectory: typeof saved.workspaceParentDirectory === "string" && fs.existsSync(saved.workspaceParentDirectory) && fs.statSync(saved.workspaceParentDirectory).isDirectory()
        ? path.resolve(saved.workspaceParentDirectory) : null,
      devWorkspaceDirectory: typeof saved.devWorkspaceDirectory === "string" && fs.existsSync(saved.devWorkspaceDirectory) && fs.statSync(saved.devWorkspaceDirectory).isDirectory()
        ? path.resolve(saved.devWorkspaceDirectory) : null,
      supabaseUrl: typeof saved.supabaseUrl === "string" ? saved.supabaseUrl : "",
      encryptedSupabaseKey: typeof saved.encryptedSupabaseKey === "string" ? saved.encryptedSupabaseKey : null,
      encryptedApiKeys: saved.encryptedApiKeys && typeof saved.encryptedApiKeys === "object" && !Array.isArray(saved.encryptedApiKeys) ? saved.encryptedApiKeys : {},
      encryptedGroqTranscriptionKeys: Array.isArray(saved.encryptedGroqTranscriptionKeys) ? saved.encryptedGroqTranscriptionKeys.filter((value) => typeof value === "string") : [],
      codexWorkspaceDirectory: typeof saved.codexWorkspaceDirectory === "string" && fs.existsSync(saved.codexWorkspaceDirectory) && fs.statSync(saved.codexWorkspaceDirectory).isDirectory()
        ? path.resolve(saved.codexWorkspaceDirectory) : null,
      reminder: saved.reminder && saved.reminder.enabled === true && Number.isFinite(Number(saved.reminder.intervalSeconds))
        ? { enabled: true, intervalSeconds: Math.max(1, Math.min(359999, Number(saved.reminder.intervalSeconds))), nextAt: Number.isFinite(Number(saved.reminder.nextAt)) ? Number(saved.reminder.nextAt) : Date.now() + 30 * 60_000, tasks: [] }
        : null,
    };
  } catch {
    // A missing or unreadable preference file uses safe defaults.
  }
}

function isGitCheckout(directory) {
  return fs.existsSync(path.join(directory, ".git"));
}

function removeLegacyClickUpRecords() {
  const legacyDatabase = path.join(app.getPath("userData"), "data", "mosaic.sqlite");
  if (!fs.existsSync(legacyDatabase)) return;
  let database;
  try {
    database = new DatabaseSync(legacyDatabase);
    database.exec("PRAGMA busy_timeout = 10000");
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
    if (tables.has("local_records")) {
      const columns = new Set(database.prepare("PRAGMA table_info(local_records)").all().map((row) => String(row.name)));
      const conditions = ["clickup_id IS NOT NULL", "clickup_list_id IS NOT NULL"].filter((column) => columns.has(column));
      if (conditions.length) database.prepare(`DELETE FROM local_records WHERE ${conditions.join(" OR ")}`).run();
    }
    if (tables.has("local_settings")) database.prepare("DELETE FROM local_settings WHERE lower(key) LIKE '%clickup%'").run();
  } catch (error) {
    console.error("Could not remove legacy ClickUp records:", error);
  } finally {
    database?.close();
  }
}

function decryptValue(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(value, "base64")); }
  catch { return ""; }
}

function decryptApiKeys(encrypted = settings.encryptedApiKeys) {
  return Object.fromEntries(Object.entries(encrypted || {}).map(([provider, value]) => [provider, decryptValue(value)]).filter(([, value]) => value));
}

function decryptGroqTranscriptionKeys() {
  return settings.encryptedGroqTranscriptionKeys.map(decryptValue).filter(Boolean);
}

function publicWorkspaceSettings() {
  const apiKeys = decryptApiKeys();
  return {
    directory: workspaceDirectory(),
    supabaseConfigured: Boolean(settings.supabaseUrl && decryptValue(settings.encryptedSupabaseKey)),
    apiKeys: Object.fromEntries(["deepseek", "openai", "openrouter", "gemini"].map((provider) => [provider, Boolean(apiKeys[provider])])),
    groqTranscriptionKeyCount: decryptGroqTranscriptionKeys().length,
    codexWorkspaceDirectory: settings.codexWorkspaceDirectory,
    sync: { ...workspaceSyncState },
  };
}

function publishWorkspaceSync(nextState) {
  workspaceSyncState = { ...workspaceSyncState, ...nextState };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mosaic:supabase-sync-status", { ...workspaceSyncState });
}

async function runWorkspaceSync() {
  if (workspaceSyncInProgress) return { ...workspaceSyncState };
  const key = decryptValue(settings.encryptedSupabaseKey);
  if (!settings.supabaseUrl || !key) return publishWorkspaceSync({ status: "not-configured", error: null });
  workspaceSyncInProgress = true;
  publishWorkspaceSync({ status: "syncing", error: null });
  try {
    const result = await syncWorkspace({ root: workspaceDirectory(), url: settings.supabaseUrl, key });
    publishWorkspaceSync({ status: "synced", ...result, error: null });
  } catch (error) {
    publishWorkspaceSync({ status: "failed", error: error instanceof Error ? error.message : String(error) });
  } finally {
    workspaceSyncInProgress = false;
  }
  return { ...workspaceSyncState };
}

function scheduleWorkspaceSync(delay = 2500) {
  if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer);
  workspaceSyncTimer = setTimeout(() => { void runWorkspaceSync(); }, delay);
}

function watchWorkspaceFolder() {
  workspaceWatcher?.close();
  try {
    workspaceWatcher = fs.watch(workspaceDirectory(), { recursive: true }, (_eventType, filename) => {
      const name = String(filename || "").replace(/\\/g, "/");
      if (!name || name.startsWith(".sync/") || name.startsWith("Notetaker/Recordings/")) return;
      if (!workspaceSyncInProgress) scheduleWorkspaceSync();
    });
  } catch (error) {
    console.error("Could not watch Mosaic workspace files:", error);
  }
  if (workspaceSyncInterval) clearInterval(workspaceSyncInterval);
  workspaceSyncInterval = setInterval(() => { void runWorkspaceSync(); }, 120_000);
  scheduleWorkspaceSync(4_000);
}

function saveSettings() {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const saved = { ...settings, reminder: settings.reminder ? { enabled: true, intervalSeconds: settings.reminder.intervalSeconds, nextAt: settings.reminder.nextAt, tasks: [] } : null };
  fs.writeFileSync(settingsPath, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function workspaceDirectory() {
  if (developmentRun) {
    if (!settings.devWorkspaceDirectory) throw new Error("Choose a Mosaic data folder first.");
    return settings.devWorkspaceDirectory;
  }
  if (!settings.workspaceParentDirectory) throw new Error("Choose a folder for Mosaic data first.");
  return path.join(settings.workspaceParentDirectory, "Mosaic");
}

function trustedAppSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && isAppOrigin(event.senderFrame?.url || ""));
}

function registerWorkspaceBridge() {
  ipcMain.handle("mosaic:workspace-settings", (event) => {
    if (!trustedAppSender(event)) throw new Error("Workspace settings are only available inside Mosaic.");
    return publicWorkspaceSettings();
  });

  ipcMain.handle("mosaic:workspace-choose-folder", async (event) => {
    if (!trustedAppSender(event)) throw new Error("Workspace settings are only available inside Mosaic.");
    if (developmentRun) {
      const result = await dialog.showOpenDialog(mainWindow, { title: "Choose the existing Mosaic data folder", properties: ["openDirectory"] });
      if (result.canceled || !result.filePaths[0]) return null;
      const nextRoot = path.resolve(result.filePaths[0]);
      if (isGitCheckout(nextRoot)) throw new Error("Choose the Mosaic data folder, not its source checkout.");
      if (path.resolve(workspaceDirectory()).toLowerCase() === nextRoot.toLowerCase()) return { directory: nextRoot, unchanged: true };
      settings.devWorkspaceDirectory = nextRoot;
      saveSettings();
      localAppOptions.dataDirectory = nextRoot;
      localAppOptions.recordingsDirectory = path.join(nextRoot, "Notetaker", "Recordings");
      await localAppServer?.stop();
      localAppServer = await startLocalAppServer(localAppOptions);
      APP_ORIGIN = new URL(localAppServer.url).origin;
      await mainWindow.loadURL(localAppServer.url);
      watchWorkspaceFolder();
      return { directory: nextRoot };
    }
    const result = await dialog.showOpenDialog(mainWindow, { title: "Choose the parent folder for Mosaic", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const nextParent = path.resolve(result.filePaths[0]);
    const currentRoot = workspaceDirectory();
    const nextRoot = path.join(nextParent, "Mosaic");
    if (path.resolve(currentRoot).toLowerCase() === path.resolve(nextRoot).toLowerCase()) return { directory: currentRoot, unchanged: true };
    if (fs.existsSync(nextRoot)) throw new Error("That location already contains a Mosaic folder. Choose an empty parent folder to avoid overwriting data.");
    fs.cpSync(currentRoot, nextRoot, { recursive: true, errorOnExist: true, force: false });
    settings.workspaceParentDirectory = nextParent;
    saveSettings();
    localAppOptions.dataDirectory = nextRoot;
    localAppOptions.recordingsDirectory = path.join(nextRoot, "Notetaker", "Recordings");
    if (!localAppServer) throw new Error("Mosaic's local server is not ready.");
    await localAppServer.stop();
    localAppServer = await startLocalAppServer(localAppOptions);
    APP_ORIGIN = new URL(localAppServer.url).origin;
    await mainWindow.loadURL(localAppServer.url);
    watchWorkspaceFolder();
    return { directory: nextRoot };
  });

  ipcMain.handle("mosaic:open-workspace-folder", (event) => {
    if (!trustedAppSender(event)) throw new Error("Workspace settings are only available inside Mosaic.");
    return shell.openPath(workspaceDirectory());
  });

  ipcMain.handle("mosaic:open-credential-manager", (event) => {
    if (!trustedAppSender(event)) throw new Error("Settings are only available inside Mosaic.");
    const { spawn } = require("node:child_process");
    const child = spawn("control.exe", ["/name", "Microsoft.CredentialManager"], { windowsHide: true, stdio: "ignore" });
    child.once("error", (error) => console.error("Could not open Credential Manager:", error));
    return true;
  });

  ipcMain.handle("mosaic:supabase-config", (event, config) => {
    if (!trustedAppSender(event)) throw new Error("Supabase settings are only available inside Mosaic.");
    if (!config || typeof config.url !== "string" || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url.trim())) throw new Error("Enter a valid Supabase project URL.");
    if (typeof config.secretKey !== "string" || !config.secretKey.trim().startsWith("sb_secret_")) throw new Error("Enter the project's Supabase secret key.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable on this device.");
    settings.supabaseUrl = config.url.trim().replace(/\/$/, "");
    settings.encryptedSupabaseKey = safeStorage.encryptString(config.secretKey.trim()).toString("base64");
    saveSettings();
    scheduleWorkspaceSync(0);
    return { configured: true };
  });

  ipcMain.handle("mosaic:api-key-save", async (event, provider, key) => {
    if (!trustedAppSender(event)) throw new Error("AI settings are only available inside Mosaic.");
    const allowed = new Set(["deepseek", "openai", "openrouter", "gemini"]);
    if (!allowed.has(provider) || typeof key !== "string" || key.trim().length > 500) throw new Error("Enter a valid AI provider key.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable on this device.");
    settings.encryptedApiKeys ||= {};
    if (key.trim()) settings.encryptedApiKeys[provider] = safeStorage.encryptString(key.trim()).toString("base64");
    else delete settings.encryptedApiKeys[provider];
    saveSettings();
    localAppOptions.apiKeys = decryptApiKeys();
    await localAppServer?.stop();
    localAppServer = await startLocalAppServer(localAppOptions);
    APP_ORIGIN = new URL(localAppServer.url).origin;
    await mainWindow.loadURL(localAppServer.url);
    return publicWorkspaceSettings();
  });

  ipcMain.handle("mosaic:groq-transcription-import", async (event) => {
    if (!trustedAppSender(event)) throw new Error("Transcription settings are only available inside Mosaic.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable on this device.");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select the transcription .env file",
      defaultPath: path.join(__dirname, "..", "app", ".env"),
      properties: ["openFile"],
      filters: [{ name: "Environment files", extensions: ["env", "txt"] }, { name: "All files", extensions: ["*"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const keys = require("./groq-env-import.cjs").readGroqTranscriptionKeys(result.filePaths[0]);
    if (!keys.length) throw new Error("No GROQ_API_KEY or GROQ_API_KEY_1 through GROQ_API_KEY_20 values were found in that file.");
    settings.encryptedGroqTranscriptionKeys = keys.map((key) => safeStorage.encryptString(key).toString("base64"));
    saveSettings();
    localAppOptions.transcriptionKeys = keys;
    await localAppServer?.stop();
    localAppServer = await startLocalAppServer(localAppOptions);
    APP_ORIGIN = new URL(localAppServer.url).origin;
    await mainWindow.loadURL(localAppServer.url);
    return { importedCount: keys.length };
  });

  ipcMain.handle("mosaic:supabase-sync-now", async (event) => {
    if (!trustedAppSender(event)) throw new Error("Sync is only available inside Mosaic.");
    return runWorkspaceSync();
  });

  watchWorkspaceFolder();
}

function isAppOrigin(value) {
  try {
    return Boolean(APP_ORIGIN) && new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function isClickUpPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === CLICKUP_HOST || url.hostname.endsWith(`.${CLICKUP_HOST}`));
  } catch {
    return false;
  }
}

function setPermissionPolicy() {
  const mosaicSession = session.fromPartition(APP_PARTITION);
  mosaicSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const isTrustedFrame = webContents && webContents.getURL() && isAppOrigin(webContents.getURL());
    if (!isTrustedFrame || !requestingOrigin || !isAppOrigin(requestingOrigin)) return false;
    if (permission === "media") return settings.mediaPermissionGranted;
    return permission === "display-capture";
  });
  mosaicSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const pageUrl = webContents && webContents.getURL();
    const requestingUrl = details && (details.requestingUrl || details.securityOrigin);
    const isTrustedRequest = Boolean(pageUrl && isAppOrigin(pageUrl) && requestingUrl && isAppOrigin(requestingUrl));
    if (!isTrustedRequest) return callback(false);
    if (permission === "display-capture") return callback(true);
    if (permission !== "media") return callback(false);
    if (settings.mediaPermissionGranted) return callback(true);

    const result = dialog.showMessageBoxSync(mainWindow || undefined, {
      type: "question",
      title: "Allow media access?",
      message: "Allow Mosaic to use this device's microphone or camera?",
      detail: "You can reset this permission from the Mosaic tray menu.",
      buttons: ["Don't allow", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    settings.mediaPermissionGranted = result === 1;
    saveSettings();
    callback(settings.mediaPermissionGranted);
  });

  mosaicSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const frame = request.frame;
    const isTopLevelMosaicRequest = Boolean(
      APP_ORIGIN && frame && frame === frame.top && isAppOrigin(request.securityOrigin) &&
      request.userGesture && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    );
    if (!isTopLevelMosaicRequest) return callback(null);

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: true,
      });
      if (sources.length === 0) return callback(null);
      const selectedSource = await chooseDisplaySource(sources);
      if (!selectedSource) return callback(null);
      callback({
        video: selectedSource,
        ...(request.audioRequested ? { audio: "loopback" } : {}),
      });
    } catch (error) {
      console.error("Screen selection failed:", error.message);
      callback(null);
    }
  });
}

function createMainWindow() {
  const startHidden = process.argv.includes("--hidden");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: !startHidden,
    backgroundColor: "#FFFCFB",
      icon: path.join(__dirname, "..", "build", "mosaic.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      session: session.fromPartition(APP_PARTITION),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  if (!startHidden) {
    mainWindow.maximize();
    mainWindowWasShown = true;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isClickUpPage(url)) {
      mainWindow.webContents.loadURL(url).catch(showConnectionError);
    } else {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppOrigin(url) || isClickUpPage(url) || url.startsWith("data:text/html")) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (isAppOrigin(url) || isClickUpPage(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) showConnectionError(description);
  });

  mainWindow.webContents.on("render-process-gone", () => showConnectionError("Mosaic had to restart this page."));

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!settings.closeToTrayNoticeShown) {
      settings.closeToTrayNoticeShown = true;
      saveSettings();
      dialog.showMessageBox({
        type: "info",
        title: "Mosaic is still running",
        message: "Mosaic is in the system tray. Choose Open Mosaic to return, or Quit Mosaic to close it.",
        buttons: ["Got it"],
      });
    }
  });

  if (APP_ORIGIN) {
    const startUrl = developmentRun ? new URL("/notebook", APP_ORIGIN).toString() : APP_ORIGIN;
    mainWindow.loadURL(startUrl).catch(showConnectionError);
  } else {
    showConnectionError("Mosaic's local app server is not ready.");
  }
}

function showConnectionError(reason = "Mosaic could not connect to the workspace.") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeReason = String(reason).replace(/[<>&"']/g, "");
  const retryScript = APP_ORIGIN ? `location.href=${JSON.stringify(APP_ORIGIN)}` : "location.reload()";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mosaic connection</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FFFCFB;color:#003366;font:16px Arial,sans-serif"><main style="max-width:480px;padding:32px;text-align:center"><h1 style="font-size:28px">Mosaic is unavailable</h1><p>${safeReason}</p><button onclick="${retryScript}" style="border:0;background:#003366;color:white;padding:12px 22px;font-size:15px;cursor:pointer">Try again</button></main></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`).catch(() => {});
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || (url.protocol === "mailto:" && !url.pathname.startsWith("//"))) {
      shell.openExternal(url.toString()).catch((error) => console.error("Could not open external link:", error.message));
    }
  } catch {
    // Invalid and non-web schemes stay blocked.
  }
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "build", "mosaic.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Mosaic");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", showMainWindow);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open Mosaic", click: showMainWindow },
    { label: "Export local backup…", click: () => exportLocalBackup() },
    { label: "Restore local backup…", click: () => restoreLocalBackup() },
    { type: "separator" },
    { label: `Desktop version ${app.getVersion()}`, enabled: false },
    { label: "Updates are disabled for this local pilot", enabled: false },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: settings.startWithWindows,
      click: (item) => {
        settings.startWithWindows = item.checked;
        saveSettings();
        applyStartupSetting();
        tray.setContextMenu(buildTrayMenu());
      },
    },
    {
      label: "Reset microphone and camera permission",
      enabled: settings.mediaPermissionGranted,
      click: () => {
        settings.mediaPermissionGranted = false;
        saveSettings();
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: "separator" },
    { label: "Quit Mosaic", click: confirmQuit },
  ]);
}

function dataDirectory() {
  return path.join(app.getPath("userData"), "data");
}

async function createDataBackup(destination) {
  const target = path.join(destination, "data");
  await fs.promises.mkdir(target, { recursive: true });
  const source = workspaceDirectory();
  if (!fs.existsSync(source)) throw new Error("There is no local Mosaic workspace to back up yet.");
  await fs.promises.cp(source, path.join(target, "Mosaic"), { recursive: true });
  await fs.promises.writeFile(path.join(destination, "manifest.json"), JSON.stringify({ app: "mosaic-desktop", formatVersion: 1, createdAt: new Date().toISOString() }, null, 2), { encoding: "utf8", mode: 0o600 });
}

async function tryDailyBackup() {
  if (dailyBackupInProgress || !fs.existsSync(workspaceDirectory())) return;
  dailyBackupInProgress = true;
  const backupRoot = path.join(app.getPath("userData"), "backups", "daily");
  const date = new Date().toISOString().slice(0, 10);
  const target = path.join(backupRoot, date);
  try {
    if (fs.existsSync(path.join(target, "manifest.json"))) return;
    await fs.promises.mkdir(backupRoot, { recursive: true });
    if (fs.existsSync(target)) await fs.promises.rm(target, { recursive: true, force: true });
    await createDataBackup(target);
    const entries = await fs.promises.readdir(backupRoot, { withFileTypes: true });
    const backups = entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: path.join(backupRoot, entry.name) })).sort((a, b) => b.name.localeCompare(a.name));
    for (const old of backups.slice(7)) await fs.promises.rm(old.path, { recursive: true, force: true });
  } catch (error) {
    console.error("Mosaic daily backup failed:", error);
  } finally {
    dailyBackupInProgress = false;
  }
}

async function exportLocalBackup() {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Choose a folder for the Mosaic backup", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return;
  const name = `Mosaic Backup ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const target = path.join(result.filePaths[0], name);
  try {
    await createDataBackup(target);
    dialog.showMessageBox(mainWindow, { type: "info", title: "Backup exported", message: `Mosaic data was exported to:\n${target}` });
  } catch (error) {
    dialog.showErrorBox("Backup export failed", error instanceof Error ? error.message : String(error));
  }
}

async function restoreLocalBackup() {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Select a Mosaic backup folder", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return;
  const backup = path.resolve(result.filePaths[0]);
  const manifestPath = path.join(backup, "manifest.json");
  const backupData = path.join(backup, "data");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.app !== "mosaic-desktop" || manifest.formatVersion !== 1 || !fs.existsSync(path.join(backupData, "Mosaic"))) throw new Error("This folder is not a valid Mosaic backup.");
  } catch (error) {
    dialog.showErrorBox("Backup could not be restored", error instanceof Error ? error.message : String(error));
    return;
  }
  const choice = await dialog.showMessageBox(mainWindow, { type: "warning", title: "Restore Mosaic backup?", message: "Restoring replaces this desktop app’s current local data.", detail: `Backup date: ${JSON.parse(fs.readFileSync(manifestPath, "utf8")).createdAt || "unknown"}`, buttons: ["Cancel", "Restore backup"], defaultId: 0, cancelId: 0, noLink: true });
  if (choice.response !== 1) return;
  try {
    const target = workspaceDirectory();
    if (!localAppServer || !settings.workspaceParentDirectory) throw new Error("The local app is not ready to restore data.");
    await localAppServer.stop();
    localAppServer = null;
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(backupData, "Mosaic"), target, { recursive: true });
    localAppServer = await startLocalAppServer(localAppOptions);
    APP_ORIGIN = new URL(localAppServer.url).origin;
    await mainWindow.loadURL(localAppServer.url);
    dialog.showMessageBox(mainWindow, { type: "info", title: "Backup restored", message: "Mosaic reopened with the restored local data." });
  } catch (error) {
    dialog.showErrorBox("Backup restore failed", error instanceof Error ? error.message : String(error));
  }
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
}

function applyStartupSetting() {
  app.setLoginItemSettings({
    openAtLogin: settings.startWithWindows,
    args: settings.startWithWindows ? ["--hidden"] : [],
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindowWasShown) {
    mainWindow.maximize();
    mainWindowWasShown = true;
  }
  mainWindow.show();
  mainWindow.focus();
}

function confirmQuit() {
  if (isQuitting) return;
  const result = dialog.showMessageBoxSync(mainWindow || undefined, {
    type: "warning",
    title: "Quit Mosaic?",
    message: "Quit Mosaic and close any work still open in the app?",
    detail: "Unsaved changes or active recording may be interrupted.",
    buttons: ["Keep Mosaic running", "Quit Mosaic"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (result !== 1) return;
  isQuitting = true;
  app.quit();
}

function registerReminderBridge() {
  ipcMain.on("mosaic:reminder-schedule", (event, input) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !isAppOrigin(event.senderFrame?.url || "")) return;
    if (!input || typeof input.enabled !== "boolean") return;
    const intervalSeconds = Math.floor(Number(input.intervalSeconds));
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 359999) return;
    settings.reminder = input.enabled ? {
      enabled: true,
      intervalSeconds,
      tasks: normalizeReminderTasks(input.tasks),
      nextAt: settings.reminder?.enabled && settings.reminder.intervalSeconds === intervalSeconds && settings.reminder.nextAt > Date.now()
        ? settings.reminder.nextAt : Date.now() + intervalSeconds * 1000,
    } : null;
    saveSettings();
    if (!settings.reminder && reminderWindow && !reminderWindow.isDestroyed()) {
      reminderCanClose = true;
      reminderWindow.close();
    }
    scheduleNextReminder();
  });
  ipcMain.on("mosaic:reminder-response", (event, action, requestedSeconds) => {
    const fromReminder = Boolean(reminderWindow && !reminderWindow.isDestroyed() && event.sender === reminderWindow.webContents);
    const fromMain = Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && isAppOrigin(event.senderFrame?.url || ""));
    if ((!fromReminder && !fromMain) || (action !== "dismiss" && action !== "snooze")) return;
    if (fromReminder && reminderWindow && !reminderWindow.isDestroyed()) {
      reminderCanClose = true;
      reminderWindow.close();
    }
    if (!settings.reminder?.enabled) return;
    if (action === "snooze") {
      const seconds = Number(requestedSeconds);
      if (![3600, 7200, 10800, 14400, 18000].includes(seconds)) return;
      settings.reminder.nextAt = Date.now() + seconds * 1000;
    } else {
      settings.reminder.nextAt = Date.now() + settings.reminder.intervalSeconds * 1000;
    }
    saveSettings();
    scheduleNextReminder();
  });
  const reminderTaskRequest = (event) => Boolean(reminderWindow && !reminderWindow.isDestroyed() && event.sender === reminderWindow.webContents);
  ipcMain.handle("mosaic:reminder-task-update", async (event, input) => {
    if (!reminderTaskRequest(event) || !APP_ORIGIN) throw new Error("Reminder task changes are unavailable.");
    const taskId = typeof input?.taskId === "string" ? input.taskId : "";
    const notebookDate = typeof input?.notebookDate === "string" ? input.notebookDate : "";
    if (!taskId || !/^\d{4}-\d{2}-\d{2}$/.test(notebookDate) || typeof input?.completed !== "boolean") throw new Error("A valid task update is required.");
    const now = new Date();
    const completedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const response = await fetch(new URL("/api/my-day", APP_ORIGIN), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", taskId, date: notebookDate, completed: input.completed, completedDate: input.completed ? completedDate : null, status: input.completed ? "complete" : "to do" }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Task could not be updated.");
    return { success: true };
  });
  ipcMain.handle("mosaic:reminder-task-reorder", async (event, taskIds) => {
    if (!reminderTaskRequest(event) || !APP_ORIGIN) throw new Error("Reminder task ordering is unavailable.");
    if (!Array.isArray(taskIds) || taskIds.length > 500 || taskIds.some((id) => typeof id !== "string")) throw new Error("A valid task order is required.");
    const response = await fetch(new URL("/api/my-day", APP_ORIGIN), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reorder", taskIds }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Task order could not be saved.");
    return body;
  });
  ipcMain.on("mosaic:reminder-window-minimize", (event) => {
    if (reminderWindow && !reminderWindow.isDestroyed() && event.sender === reminderWindow.webContents) reminderWindow.minimize();
  });
  ipcMain.on("mosaic:reminder-window-toggle-maximize", (event) => {
    if (!reminderWindow || reminderWindow.isDestroyed() || event.sender !== reminderWindow.webContents) return;
    if (reminderWindow.isMaximized()) reminderWindow.unmaximize();
    else reminderWindow.maximize();
    reminderWindow.webContents.send("mosaic:reminder-window-state", reminderWindow.isMaximized());
  });
  ipcMain.on("mosaic:reminder-open-notebook", (event) => {
    if (!reminderWindow || reminderWindow.isDestroyed() || event.sender !== reminderWindow.webContents) return;
    reminderCanClose = true;
    reminderWindow.close();
    if (settings.reminder?.enabled) {
      settings.reminder.nextAt = Date.now() + settings.reminder.intervalSeconds * 1000;
      saveSettings();
      scheduleNextReminder();
    }
    showMainWindow();
    if (APP_ORIGIN) void mainWindow?.loadURL(new URL("/notebook", APP_ORIGIN).toString());
  });
}

function chooseDisplaySource(sources) {
  return new Promise((resolve) => {
    const requestId = `capture-${++displayCaptureSequence}`;
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const finish = (source) => {
      const pending = pendingDisplayCaptures.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingDisplayCaptures.delete(requestId);
      resolve(source);
    };
    const timeout = setTimeout(() => finish(null), 120_000);
    pendingDisplayCaptures.set(requestId, { timeout, finish, sourceById });
    mainWindow.webContents.send("mosaic:display-capture-request", {
      requestId,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      })),
    });
  });
}

function registerRecordingBridge() {
  ipcMain.handle("mosaic:display-capture-select", (event, requestId, sourceId) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !isAppOrigin(event.senderFrame?.url || "")) return false;
    const pending = pendingDisplayCaptures.get(requestId);
    if (!pending) return false;
    const source = typeof sourceId === "string" ? pending.sourceById.get(sourceId) : null;
    if (sourceId !== null && !source) return false;
    pending.finish(source || null);
    return true;
  });

  ipcMain.handle("mosaic:open-recording-location", (event, fileName) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !isAppOrigin(event.senderFrame?.url || "")) return false;
    if (typeof fileName !== "string" || path.basename(fileName) !== fileName) return false;
    const directory = path.resolve(localAppOptions.recordingsDirectory);
    const filePath = path.resolve(directory, fileName);
    if (!filePath.startsWith(`${directory}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
}

function registerCodexBridge() {
  const isTrustedSender = (event) => Boolean(
    mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
    isAppOrigin(event.senderFrame?.url || ""),
  );
  const getCodexServer = () => {
    codexAppServer ||= new CodexAppServer((payload) => {
      if (mainWindow && !mainWindow.isDestroyed() && isAppOrigin(mainWindow.webContents.getURL())) {
        mainWindow.webContents.send("mosaic:codex-event", payload);
      }
    }, () => APP_ORIGIN);
    return codexAppServer;
  };
  const readSkills = () => {
    const roots = [
      settings.codexWorkspaceDirectory ? path.join(settings.codexWorkspaceDirectory, ".agents", "skills") : null,
      process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "skills") : null,
      path.join(app.getPath("home"), ".codex", "skills"),
    ].filter((value) => typeof value === "string");
    const seenRoots = new Set();
    const skills = [];
    for (const rootValue of roots) {
      const root = path.resolve(rootValue);
      if (seenRoots.has(root.toLowerCase()) || !fs.existsSync(root)) continue;
      seenRoots.add(root.toLowerCase());
      let rootReal;
      try { rootReal = fs.realpathSync(root); } catch { continue; }
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        const skillFile = path.join(directory, "SKILL.md");
        try {
          const realDirectory = fs.realpathSync(directory);
          if (!realDirectory.toLowerCase().startsWith(`${rootReal.toLowerCase()}${path.sep.toLowerCase()}`)) continue;
          const stat = fs.statSync(skillFile);
          if (!stat.isFile() || stat.size > 128_000) continue;
          const source = root.includes(`${path.sep}.agents${path.sep}`) ? "Workspace" : "Codex home";
          skills.push({ id: `${source}:${entry.name}`, name: entry.name, source, instructions: fs.readFileSync(skillFile, "utf8") });
        } catch { /* Ignore inaccessible or malformed skill directories. */ }
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  };

  ipcMain.handle("mosaic:codex-status", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    try {
      const accountResponse = await getCodexServer().readAccount();
      const account = accountResponse.account;
      return {
        available: true,
        connected: Boolean(account),
        email: account?.email || null,
        accountType: account?.type || null,
        planType: account?.planType || null,
        workspaceDirectory: settings.codexWorkspaceDirectory,
      };
    } catch (error) {
      return { available: false, connected: false, email: null, workspaceDirectory: settings.codexWorkspaceDirectory, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("mosaic:codex-list-models", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    return getCodexServer().listModels();
  });

  ipcMain.handle("mosaic:codex-choose-workspace", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a folder Codex can work in",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.codexWorkspaceDirectory = path.resolve(result.filePaths[0]);
    saveSettings();
    return { workspaceDirectory: settings.codexWorkspaceDirectory };
  });

  ipcMain.handle("mosaic:codex-start-thread", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (!settings.codexWorkspaceDirectory) throw new Error("Choose a workspace folder first.");
    return getCodexServer().startThread(settings.codexWorkspaceDirectory);
  });

  ipcMain.handle("mosaic:codex-list-skills", (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    return readSkills();
  });

  ipcMain.handle("mosaic:codex-list-threads", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (!settings.codexWorkspaceDirectory) return [];
    return getCodexServer().listThreads(settings.codexWorkspaceDirectory);
  });

  ipcMain.handle("mosaic:codex-resume-thread", async (event, threadId) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (!settings.codexWorkspaceDirectory) throw new Error("Choose a workspace folder first.");
    return getCodexServer().resumeThread(threadId, settings.codexWorkspaceDirectory);
  });

  ipcMain.handle("mosaic:codex-undo-created-action", async (event, action) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (!action || typeof action !== "object" || typeof action.kind !== "string") throw new Error("The creation action could not be verified.");
    const id = typeof action.id === "string" ? action.id.trim() : "";
    const date = typeof action.date === "string" ? action.date : "";
    const title = typeof action.title === "string" ? action.title.trim() : "";
    const api = async (route, init = {}) => {
      if (!APP_ORIGIN) throw new Error("The local Mosaic API is unavailable.");
      const response = await fetch(new URL(route, APP_ORIGIN), { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error) throw new Error(body.error || "The created item could not be undone.");
      return body;
    };
    const post = (route, body) => api(route, { method: "POST", body: JSON.stringify(body) });
    if (action.kind === "task" && id && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const board = await api("/api/my-day?board=1");
      const task = Array.isArray(board.tasks) ? board.tasks.find((entry) => entry?.id === id && entry?.notebookDate === date) : null;
      if (!task || (title && task.name !== title)) throw new Error("This task changed or moved since it was created. Undo was cancelled.");
      await post("/api/my-day", { action: "delete", date, taskId: id });
      return { undone: true };
    }
    if (action.kind === "list" && id && title) {
      const board = await api("/api/my-day?board=1");
      const list = Array.isArray(board.lists) ? board.lists.find((entry) => entry?.id === id && entry?.name === title) : null;
      if (!list) throw new Error("This list changed since it was created. Undo was cancelled.");
      if (Array.isArray(board.tasks) && board.tasks.some((task) => task?.listId === id)) throw new Error("This list now contains tasks. Move them elsewhere before undoing its creation.");
      await post("/api/my-day", { action: "delete-list", listId: id });
      return { undone: true };
    }
    if (action.kind === "note" && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof action.previousNotes === "string" && typeof action.createdNotes === "string") {
      const current = await api(`/api/my-day?date=${encodeURIComponent(date)}`);
      if (current.notes !== action.createdNotes) throw new Error("These notes changed since they were created. Undo was cancelled.");
      await post("/api/my-day", { action: "note", date, notes: action.previousNotes });
      return { undone: true };
    }
    if (action.kind === "meeting" && id && title) {
      const current = await api(`/api/meetings?meetingId=${encodeURIComponent(id)}`);
      if (current.meeting?.title !== title) throw new Error("This meeting changed since it was created. Undo was cancelled.");
      await api(`/api/meetings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      return { undone: true };
    }
    if (action.kind === "project" && id && title) {
      const current = await api("/api/business-analysis");
      if (!current.state?.projects?.some((project) => project.id === id && project.name === title)) throw new Error("This project changed since it was created. Undo was cancelled.");
      await api("/api/business-analysis", { method: "DELETE", body: JSON.stringify({ projectId: id }) });
      return { undone: true };
    }
    if (action.kind === "report" && typeof action.path === "string" && typeof action.sha256 === "string") {
      const root = path.resolve(settings.codexWorkspaceDirectory || "");
      const target = path.resolve(root, action.path.replace(/[\\/]+/g, path.sep));
      const relative = path.relative(root, target);
      if (!relative.toLowerCase().startsWith(`outputs${path.sep}`.toLowerCase()) || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.lstatSync(target).isFile()) throw new Error("The created report is outside Outputs or no longer exists.");
      const realRoot = fs.realpathSync(root);
      const realTarget = fs.realpathSync(target);
      const outputsPath = path.join(root, "Outputs");
      if (fs.lstatSync(outputsPath).isSymbolicLink()) throw new Error("The Outputs folder path could not be verified.");
      const outputsRoot = fs.realpathSync(outputsPath);
      const outputsRelative = path.relative(realRoot, outputsRoot);
      if (outputsRelative.toLowerCase() !== "outputs" || !realTarget.toLowerCase().startsWith(`${outputsRoot}${path.sep}`.toLowerCase())) throw new Error("The created report path could not be verified.");
      const digest = createHash("sha256").update(fs.readFileSync(realTarget)).digest("hex");
      if (digest.toLowerCase() !== action.sha256.toLowerCase()) throw new Error("This report changed after it was created. Undo was cancelled.");
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const archive = path.join(root, "Recycle Bin", stamp, relative);
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      const archiveDirectory = fs.realpathSync(path.dirname(archive));
      const archiveRelative = path.relative(realRoot, archiveDirectory);
      if (archiveRelative.startsWith("..") || path.isAbsolute(archiveRelative)) throw new Error("The undo archive path could not be verified.");
      fs.renameSync(realTarget, archive);
      return { undone: true, archivedTo: path.relative(root, archive) };
    }
    throw new Error("This creation action is unsupported or could not be verified.");
  });

  ipcMain.handle("mosaic:codex-send", async (event, prompt, model) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200_000) throw new Error("The message and selected skill instructions must stay under 200,000 characters.");
    if (typeof model !== "string" || model.length > 200) throw new Error("Choose an available Codex model first.");
    return getCodexServer().sendMessage(prompt.trim(), model);
  });

  ipcMain.handle("mosaic:codex-interrupt", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    return getCodexServer()?.interruptTurn() || false;
  });

  ipcMain.handle("mosaic:codex-approval", (event, id, accepted) => {
    if (!isTrustedSender(event) || typeof accepted !== "boolean" || (typeof id !== "number" && typeof id !== "string")) return false;
    return getCodexServer()?.respondToApproval(id, accepted) || false;
  });
}

function setUpdateState(nextState) {
  Object.assign(updateState, nextState, { currentVersion: app.getVersion() });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mosaic:update-state", { ...updateState });
  }
}

function normalizeReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === "string") return releaseNotes.trim() || null;
  if (!Array.isArray(releaseNotes)) return null;
  const notes = releaseNotes.map((item) => typeof item?.note === "string" ? item.note.trim() : "").filter(Boolean).join("\n\n");
  return notes || null;
}

function registerUpdateBridge() {
  const isTrustedSender = (event) => Boolean(
    mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
    isAppOrigin(event.senderFrame?.url || ""),
  );

  ipcMain.handle("mosaic:update-state", (event) => {
    if (!isTrustedSender(event)) throw new Error("Updates are only available inside Mosaic.");
    return { ...updateState };
  });

  ipcMain.handle("mosaic:update-check", async (event) => {
    if (!isTrustedSender(event)) throw new Error("Updates are only available inside Mosaic.");
    if (!app.isPackaged || process.platform !== "win32") {
      setUpdateState({ status: "unsupported", error: null });
      return { ...updateState };
    }
    if (["checking", "downloading", "downloaded", "installing"].includes(updateState.status)) return { ...updateState };
    setUpdateState({ status: "checking", version: null, percent: 0, error: null });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setUpdateState({ status: "error", error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
    }
    return { ...updateState };
  });

  ipcMain.handle("mosaic:update-install", (event) => {
    if (!isTrustedSender(event)) throw new Error("Updates are only available inside Mosaic.");
    if (updateState.status !== "downloaded") return false;
    setUpdateState({ status: "installing", error: null });
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 300);
    return true;
  });
}

function startUpdateChecks() {
  if (!app.isPackaged || process.platform !== "win32") return;

  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", error: null }));
  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version, percent: 0, releaseNotes: normalizeReleaseNotes(info.releaseNotes), error: null });
  });
  autoUpdater.on("update-not-available", (info) => setUpdateState({ status: "up-to-date", version: null, percent: 0, releaseNotes: normalizeReleaseNotes(info.releaseNotes), error: null }));
  autoUpdater.on("download-progress", (progress) => setUpdateState({
    status: "downloading",
    percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
    bytesPerSecond: Math.max(0, Math.round(progress.bytesPerSecond || 0)),
    error: null,
  }));
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ status: "downloaded", version: info.version, percent: 100, error: null }));
  autoUpdater.on("error", (error) => {
    console.error("Mosaic update check failed:", error);
    setUpdateState({ status: "error", error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
  });

  const check = () => {
    if (["checking", "downloading", "downloaded", "installing"].includes(updateState.status)) return;
    setUpdateState({ status: "checking", error: null });
    void autoUpdater.checkForUpdates().catch((error) => {
      setUpdateState({ status: "error", error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
    });
  };
  setTimeout(check, 12_000).unref?.();
  updatePollTimer = setInterval(check, 4 * 60 * 60 * 1000);
  updatePollTimer.unref?.();
}

function scheduleNextReminder() {
  if (reminderTimer) clearTimeout(reminderTimer);
  if (!settings.reminder?.enabled || isQuitting) return;
  reminderTimer = setTimeout(() => {
    if (!settings.reminder?.enabled) return;
    const intervalSeconds = settings.reminder.intervalSeconds;
    settings.reminder.nextAt = Date.now() + intervalSeconds * 1000;
    saveSettings();
    scheduleNextReminder();
    void prepareReminderWindow();
  }, Math.max(0, settings.reminder.nextAt - Date.now()));
}

async function prepareReminderWindow() {
  if (!settings.reminder?.enabled || isQuitting) return;
  let tasks = settings.reminder.tasks || [];
  if (APP_ORIGIN) {
    try {
      const response = await fetch(new URL("/api/my-day?reminders=1", APP_ORIGIN), { cache: "no-store" });
      if (!response.ok) throw new Error(`Reminder task refresh returned ${response.status}.`);
      const payload = await response.json();
      tasks = normalizeReminderTasks(payload.tasks);
      settings.reminder.tasks = tasks;
    } catch (error) {
      console.error("Could not refresh reminder tasks:", error);
    }
  }
  if (!tasks.length || !settings.reminder?.enabled || isQuitting) return;
  showReminderWindow(tasks);
}

function showReminderWindow(tasks) {
  if (reminderWindow && !reminderWindow.isDestroyed()) return focusReminderWindow();
  const { x, y, width: displayWidth, height: displayHeight } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.max(1, Math.min(680, displayWidth - 32));
  const height = Math.max(1, Math.min(560, displayHeight - 32));
  reminderWindow = new BrowserWindow({
    x: Math.round(x + (displayWidth - width) / 2),
    y: Math.round(y + (displayHeight - height) / 2),
    width, height, minWidth: Math.min(420, width), minHeight: Math.min(360, height),
    show: false, frame: false, resizable: true, maximizable: true, backgroundColor: "#1E1E1E",
    alwaysOnTop: true, focusable: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.cjs"), webSecurity: true },
  });
  reminderWindow.setAlwaysOnTop(true, "screen-saver");
  reminderCanClose = false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  reminderWindow.loadFile(path.join(__dirname, "reminder.html"), { query: { tasks: JSON.stringify(tasks), date: today } });
  reminderWindow.on("maximize", () => reminderWindow?.webContents.send("mosaic:reminder-window-state", true));
  reminderWindow.on("unmaximize", () => reminderWindow?.webContents.send("mosaic:reminder-window-state", false));
  reminderWindow.once("ready-to-show", focusReminderWindow);
  reminderWindow.on("close", (event) => {
    if (!reminderCanClose && !isQuitting) event.preventDefault();
  });
  reminderWindow.on("closed", () => { reminderWindow = null; scheduleNextReminder(); });
}

function focusReminderWindow() {
  if (!reminderWindow || reminderWindow.isDestroyed()) return;
  reminderWindow.setAlwaysOnTop(true, "screen-saver");
  if (!reminderWindow.isVisible()) reminderWindow.show();
  reminderWindow.moveTop();
  reminderWindow.focus();
}
