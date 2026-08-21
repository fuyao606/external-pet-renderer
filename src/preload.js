const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petBridge", {
  getBootstrap: () => ipcRenderer.invoke("pet:get-bootstrap"),
  startDrag: (dragId) => ipcRenderer.send("pet:drag-start", dragId),
  updateDrag: (dragId, sequence, screenX, screenY) => ipcRenderer.send(
    "pet:drag-move",
    dragId,
    sequence,
    screenX,
    screenY,
  ),
  endDrag: (dragId) => ipcRenderer.send("pet:drag-end", dragId),
  setHitTestPassthrough: (passthrough) => ipcRenderer.send("pet:set-hit-test-passthrough", Boolean(passthrough)),
  recordInputDiagnostic: (entry) => ipcRenderer.send("pet:input-diagnostic", entry),
  openDeepSeekHarness: () => ipcRenderer.invoke("pet:open-deepseek-harness"),
  getTaskPanelBootstrap: () => ipcRenderer.invoke("pet:get-task-panel-bootstrap"),
  toggleTaskPanel: (anchor) => ipcRenderer.send("pet:toggle-task-panel", anchor),
  updateTaskBubbleAnchor: (anchor) => ipcRenderer.send("pet:task-bubble-anchor", anchor),
  setTaskPanelHover: (hovering) => ipcRenderer.send("pet:task-panel-hover", Boolean(hovering)),
  closeTaskPanel: () => ipcRenderer.send("pet:close-task-panel"),
  openTask: (taskId) => ipcRenderer.send("pet:open-task", taskId),
  showContextMenu: () => ipcRenderer.send("pet:show-context-menu"),
  onState: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:state", handler);
    return () => ipcRenderer.removeListener("pet:state", handler);
  },
  onPointerPosition: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:pointer-position", handler);
    return () => ipcRenderer.removeListener("pet:pointer-position", handler);
  },
  onTasks: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:tasks", handler);
    return () => ipcRenderer.removeListener("pet:tasks", handler);
  },
});
