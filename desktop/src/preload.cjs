const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mosaicDesktop", Object.freeze({
  onDisplayCaptureRequest: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mosaic:display-capture-request", handler);
    return () => ipcRenderer.removeListener("mosaic:display-capture-request", handler);
  },
  selectDisplayCaptureSource: (requestId, sourceId) => ipcRenderer.invoke("mosaic:display-capture-select", requestId, sourceId),
  openRecordingLocation: (fileName) => ipcRenderer.invoke("mosaic:open-recording-location", fileName),
  getWorkspaceSettings: () => ipcRenderer.invoke("mosaic:workspace-settings"),
  chooseWorkspaceFolder: () => ipcRenderer.invoke("mosaic:workspace-choose-folder"),
  openWorkspaceFolder: () => ipcRenderer.invoke("mosaic:open-workspace-folder"),
  openCredentialManager: () => ipcRenderer.invoke("mosaic:open-credential-manager"),
  saveSupabaseConfig: (config) => ipcRenderer.invoke("mosaic:supabase-config", config),
  saveApiKey: (provider, key) => ipcRenderer.invoke("mosaic:api-key-save", provider, key),
  importGroqTranscriptionKeys: () => ipcRenderer.invoke("mosaic:groq-transcription-import"),
  syncWorkspaceNow: () => ipcRenderer.invoke("mosaic:supabase-sync-now"),
  onSyncStatus: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mosaic:supabase-sync-status", handler);
    return () => ipcRenderer.removeListener("mosaic:supabase-sync-status", handler);
  },
  scheduleReminder: (input) => ipcRenderer.send("mosaic:reminder-schedule", input),
  respondToReminder: (action, seconds) => {
    if (action === "dismiss" || action === "snooze") ipcRenderer.send("mosaic:reminder-response", action, seconds);
  },
  minimizeReminderWindow: () => ipcRenderer.send("mosaic:reminder-window-minimize"),
  toggleReminderWindowMaximize: () => ipcRenderer.send("mosaic:reminder-window-toggle-maximize"),
  openNotebookFromReminder: () => ipcRenderer.send("mosaic:reminder-open-notebook"),
  updateReminderTask: (input) => ipcRenderer.invoke("mosaic:reminder-task-update", input),
  reorderReminderTasks: (taskIds) => ipcRenderer.invoke("mosaic:reminder-task-reorder", taskIds),
  onReminderWindowState: (listener) => {
    const handler = (_event, maximized) => listener(maximized);
    ipcRenderer.on("mosaic:reminder-window-state", handler);
    return () => ipcRenderer.removeListener("mosaic:reminder-window-state", handler);
  },
  getCodexStatus: () => ipcRenderer.invoke("mosaic:codex-status"),
  listCodexModels: () => ipcRenderer.invoke("mosaic:codex-list-models"),
  chooseCodexWorkspace: () => ipcRenderer.invoke("mosaic:codex-choose-workspace"),
  startCodexThread: () => ipcRenderer.invoke("mosaic:codex-start-thread"),
  listCodexThreads: () => ipcRenderer.invoke("mosaic:codex-list-threads"),
  resumeCodexThread: (threadId) => ipcRenderer.invoke("mosaic:codex-resume-thread", threadId),
  listCodexSkills: () => ipcRenderer.invoke("mosaic:codex-list-skills"),
  undoCodexCreatedAction: (action) => ipcRenderer.invoke("mosaic:codex-undo-created-action", action),
  sendCodexMessage: (prompt, model) => ipcRenderer.invoke("mosaic:codex-send", prompt, model),
  interruptCodexTurn: () => ipcRenderer.invoke("mosaic:codex-interrupt"),
  respondToCodexApproval: (id, accepted) => ipcRenderer.invoke("mosaic:codex-approval", id, accepted),
  onCodexEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mosaic:codex-event", handler);
    return () => ipcRenderer.removeListener("mosaic:codex-event", handler);
  },
  getUpdateState: () => ipcRenderer.invoke("mosaic:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("mosaic:update-check"),
  installUpdate: () => ipcRenderer.invoke("mosaic:update-install"),
  onUpdateState: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mosaic:update-state", handler);
    return () => ipcRenderer.removeListener("mosaic:update-state", handler);
  },
}));
