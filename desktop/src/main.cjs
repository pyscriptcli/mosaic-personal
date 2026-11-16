const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { startLocalAppServer } = require("./local-app-server.cjs");
const { CodexAppServer } = require("./codex-app-server.cjs");

let APP_ORIGIN = null;
let localAppServer;
let localAppOptions;
let codexAppServer;
let backupTimer;
const APP_PARTITION = "persist:mosaic-local-first";
const CLICKUP_HOST = "clickup.com";
let mainWindow;
let mainWindowWasShown = false;
let reminderWindow;
let reminderTimer;
let reminderCanClose = false;
let tray;
let isQuitting = false;
let updatePollTimer;
const updateState = { status: "idle", currentVersion: app.getVersion(), version: null, percent: 0, error: null };
let settings = { startWithWindows: false, closeToTrayNoticeShown: false, mediaPermissionGranted: false, codexWorkspaceDirectory: null };
let displayCaptureSequence = 0;
const pendingDisplayCaptures = new Map();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
  app.on("session-end", () => { isQuitting = true; });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.primephilippines.mosaic");
    readSettings();
    const appPath = app.isPackaged
      ? path.join(process.resourcesPath, "local-app")
      : path.join(__dirname, "..", "build", "local-app");
    localAppOptions = {
      appPath,
      runtimePath: process.execPath,
      dataDirectory: path.join(app.getPath("userData"), "data"),
      recordingsDirectory: path.join(app.getPath("documents"), "Mosaic Meetings"),
    };

    try {
      // Start the local web app before opening its desktop window.
      localAppServer = await startLocalAppServer(localAppOptions);
      APP_ORIGIN = new URL(localAppServer.url).origin;
    } catch (error) {
      dialog.showErrorBox("Mosaic could not start", error instanceof Error ? error.message : String(error));
      isQuitting = true;
      app.quit();
      return;
    }

    setPermissionPolicy();
    registerReminderBridge();
    registerRecordingBridge();
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
      codexWorkspaceDirectory: typeof saved.codexWorkspaceDirectory === "string" && fs.existsSync(saved.codexWorkspaceDirectory) && fs.statSync(saved.codexWorkspaceDirectory).isDirectory()
        ? path.resolve(saved.codexWorkspaceDirectory) : null,
      reminder: saved.reminder && saved.reminder.enabled === true && Number.isFinite(Number(saved.reminder.intervalSeconds))
        ? { enabled: true, intervalSeconds: Math.max(1, Math.min(359999, Number(saved.reminder.intervalSeconds))), nextAt: Number.isFinite(Number(saved.reminder.nextAt)) ? Number(saved.reminder.nextAt) : Date.now() + 30 * 60_000, taskNames: [] }
        : null,
    };
  } catch {
    // A missing or unreadable preference file uses safe defaults.
  }
}

function saveSettings() {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const saved = { ...settings, reminder: settings.reminder ? { enabled: true, intervalSeconds: settings.reminder.intervalSeconds, nextAt: settings.reminder.nextAt, taskNames: [] } : null };
  fs.writeFileSync(settingsPath, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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
    mainWindow.loadURL(APP_ORIGIN).catch(showConnectionError);
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

function createDataBackup(destination) {
  const source = dataDirectory();
  const sourceDatabase = path.join(source, "mosaic.sqlite");
  const target = path.join(destination, "data");
  fs.mkdirSync(target, { recursive: true });
  if (!fs.existsSync(sourceDatabase)) throw new Error("There is no local Mosaic data to back up yet.");
  const targetDatabase = path.join(target, "mosaic.sqlite").replace(/'/g, "''");
  const database = new DatabaseSync(sourceDatabase);
  try {
    database.exec("PRAGMA busy_timeout = 10000");
    database.exec(`VACUUM INTO '${targetDatabase}'`);
  } finally {
    database.close();
  }
  for (const name of ["recordings"]) {
    const folder = path.join(source, name);
    if (fs.existsSync(folder)) fs.cpSync(folder, path.join(target, name), { recursive: true });
  }
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ app: "mosaic-desktop", formatVersion: 1, createdAt: new Date().toISOString() }, null, 2), { encoding: "utf8", mode: 0o600 });
}

function tryDailyBackup() {
  const sourceDatabase = path.join(dataDirectory(), "mosaic.sqlite");
  if (!fs.existsSync(sourceDatabase)) return;
  const backupRoot = path.join(app.getPath("userData"), "backups", "daily");
  const date = new Date().toISOString().slice(0, 10);
  const target = path.join(backupRoot, date);
  if (fs.existsSync(path.join(target, "manifest.json"))) return;
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    createDataBackup(target);
    const backups = fs.readdirSync(backupRoot).map((name) => ({ name, path: path.join(backupRoot, name) })).filter((item) => fs.statSync(item.path).isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
    for (const old of backups.slice(7)) fs.rmSync(old.path, { recursive: true, force: true });
  } catch (error) {
    console.error("Mosaic daily backup failed:", error);
  }
}

async function exportLocalBackup() {
  const result = await dialog.showOpenDialog(mainWindow, { title: "Choose a folder for the Mosaic backup", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return;
  const name = `Mosaic Backup ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const target = path.join(result.filePaths[0], name);
  try {
    createDataBackup(target);
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
    if (manifest.app !== "mosaic-desktop" || manifest.formatVersion !== 1 || !fs.existsSync(path.join(backupData, "mosaic.sqlite"))) throw new Error("This folder is not a valid Mosaic backup.");
  } catch (error) {
    dialog.showErrorBox("Backup could not be restored", error instanceof Error ? error.message : String(error));
    return;
  }
  const choice = await dialog.showMessageBox(mainWindow, { type: "warning", title: "Restore Mosaic backup?", message: "Restoring replaces this desktop app’s current local data.", detail: `Backup date: ${JSON.parse(fs.readFileSync(manifestPath, "utf8")).createdAt || "unknown"}`, buttons: ["Cancel", "Restore backup"], defaultId: 0, cancelId: 0, noLink: true });
  if (choice.response !== 1) return;
  try {
    const target = dataDirectory();
    if (!localAppServer || path.resolve(target) !== path.resolve(app.getPath("userData"), "data")) throw new Error("The local app is not ready to restore data.");
    await localAppServer.stop();
    localAppServer = null;
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(backupData, target, { recursive: true });
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
      taskNames: Array.isArray(input.taskNames) ? input.taskNames.filter((name) => typeof name === "string").slice(0, 8).map((name) => name.slice(0, 160)) : [],
      nextAt: settings.reminder?.enabled && settings.reminder.intervalSeconds === intervalSeconds && settings.reminder.nextAt > Date.now()
        ? settings.reminder.nextAt : Date.now() + intervalSeconds * 1000,
    } : null;
    saveSettings();
    scheduleNextReminder();
  });
  ipcMain.on("mosaic:reminder-response", (event, action) => {
    if (!reminderWindow || event.sender !== reminderWindow.webContents || (action !== "dismiss" && action !== "snooze")) return;
    reminderCanClose = true;
    reminderWindow.close();
    if (settings.reminder?.enabled) {
      settings.reminder.nextAt = Date.now() + settings.reminder.intervalSeconds * 1000;
      saveSettings();
      scheduleNextReminder();
    }
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
    });
    return codexAppServer;
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

  ipcMain.handle("mosaic:codex-send", async (event, prompt) => {
    if (!isTrustedSender(event)) throw new Error("Codex is only available inside Mosaic.");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20_000) throw new Error("Enter a message under 20,000 characters.");
    return getCodexServer().sendMessage(prompt.trim());
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
  autoUpdater.on("update-available", (info) => setUpdateState({ status: "available", version: info.version, percent: 0, error: null }));
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "up-to-date", version: null, percent: 0, error: null }));
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
    settings.reminder.nextAt = Date.now() + settings.reminder.intervalSeconds * 1000;
    saveSettings();
    showReminderWindow();
  }, Math.max(0, settings.reminder.nextAt - Date.now()));
}

function showReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) return focusReminderWindow();
  const { x, y, width: displayWidth, height: displayHeight } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.max(1, Math.min(720, displayWidth - 32));
  const height = Math.max(1, Math.min(560, displayHeight - 32));
  reminderWindow = new BrowserWindow({
    x: Math.round(x + (displayWidth - width) / 2),
    y: Math.round(y + (displayHeight - height) / 2),
    width, height, minWidth: Math.min(420, width), minHeight: Math.min(360, height),
    show: false, frame: false, resizable: false, backgroundColor: "#FFFCFB",
    alwaysOnTop: true, focusable: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.cjs"), webSecurity: true },
  });
  reminderWindow.setAlwaysOnTop(true, "screen-saver");
  reminderCanClose = false;
  reminderWindow.loadFile(path.join(__dirname, "reminder.html"), { query: { tasks: JSON.stringify(settings.reminder?.taskNames || []) } });
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
