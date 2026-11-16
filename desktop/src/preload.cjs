const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mosaicDesktop", Object.freeze({
  onDisplayCaptureRequest: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mosaic:display-capture-request", handler);
    return () => ipcRenderer.removeListener("mosaic:display-capture-request", handler);
  },
  selectDisplayCaptureSource: (requestId, sourceId) => ipcRenderer.invoke("mosaic:display-capture-select", requestId, sourceId),
  openRecordingLocation: (fileName) => ipcRenderer.invoke("mosaic:open-recording-location", fileName),
  scheduleReminder: (input) => ipcRenderer.send("mosaic:reminder-schedule", input),
  respondToReminder: (action) => {
    if (action === "dismiss" || action === "snooze") ipcRenderer.send("mosaic:reminder-response", action);
  },
  getCodexStatus: () => ipcRenderer.invoke("mosaic:codex-status"),
  chooseCodexWorkspace: () => ipcRenderer.invoke("mosaic:codex-choose-workspace"),
  startCodexThread: () => ipcRenderer.invoke("mosaic:codex-start-thread"),
  sendCodexMessage: (prompt) => ipcRenderer.invoke("mosaic:codex-send", prompt),
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
