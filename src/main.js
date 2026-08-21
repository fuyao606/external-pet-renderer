const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, ipcMain, screen, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { CodexSessionMonitor } = require("./status-monitor");
const { DeepSeekHarnessMonitor } = require("./deepseek-monitor");
const {
  centerPointForBounds,
  createDragAnchor,
  dragPositionFor,
  isScreenPoint,
  isWindowPosition,
} = require("./drag-geometry");
const { resizeWindowBounds, taskPanelBoundsForAnchor } = require("./window-geometry");
const { acceptsDragUpdate, isCurrentDragSession, startDragSession } = require("./drag-session");
const { codexThreadUrl } = require("./codex-links");
const { focusHarnessWindow } = require("./browser-window");
const { resolvePetState } = require("./pet-state");
const {
  defaultPackRoots,
  importGeneratedPetPack,
  loadPetCatalog,
  petStorageRoot,
  setActivePetPack,
} = require("./pet-pack");

const APP_NAME = "External Pet Renderer";
const PET_WINDOW_SCALE = 1.25;
const TERMINAL_HOLD_MS = 4000;
const ZOOM_LEVELS = [0.3, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
const TASK_PANEL_WIDTH = 288;
const TASK_PANEL_MIN_HEIGHT = 72;
const TASK_PANEL_ROW_HEIGHT = 54;
const TASK_PANEL_MAX_HEIGHT = 360;
const HIT_TEST_POLL_INTERVAL_MS = 50;

// Keep the transparent pet surface from expanding into a large invisible hit target on Windows.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "EnableTransparentHwndEnlargement");
}

app.setName(APP_NAME);

let mainWindow;
let taskPanelWindow;
let tray;
let pack;
let monitors = [];
let currentState = "rest";
let manualState = "rest";
let autoMonitoring = true;
let clickThrough = false;
let hitTestPassthrough = true;
let zoom = 0.3;
let dragAnchor;
let dragSession;
let terminalTimer;
let overrideTimer;
let pointerHitTestTimer;
let overrideMtimeMs = 0;
let activeTasks = [];
const monitorSnapshots = new Map();
let taskPanelAnchor = null;
let taskPanelPointerActive = false;
const storageRoot = petStorageRoot();
const inputDiagnosticsEnabled = process.env.EXTERNAL_PET_INPUT_DIAGNOSTICS === "1";
const inputDiagnosticsFile = path.join(storageRoot, "input-diagnostics.log");
const inputDiagnosticId = `pet_input_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
let packCatalog;

function writeInputDiagnostic(functionName, context, keyData, sourceFile = __filename, sourceLine = 0) {
  if (!inputDiagnosticsEnabled) {
    return;
  }
  const payload = JSON.stringify(keyData ?? {});
  const entry = [
    `===== [LOG_ID: ${inputDiagnosticId}] =====`,
    `[文件：${sourceFile}:${sourceLine}]`,
    `[函数：${functionName}]`,
    `[上下文：${context}]`,
    `[关键数据：${payload}]`,
    "===== [LOG_ID_END] =====",
    "",
  ].join("\n");
  try {
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.appendFileSync(inputDiagnosticsFile, entry, "utf8");
  } catch {
    // Diagnostics must never affect desktop-pet input behavior.
  }
}

function loadPackCatalog() {
  packCatalog = loadPetCatalog({
    storageRoot,
    builtinRoots: defaultPackRoots(),
  });
  pack = packCatalog.active;
  pack.baseUrl = pathToFileURL(`${pack.root}${path.sep}`).href;
  return pack;
}

function isSpriteSheetFrameEntry(entry) {
  return Boolean(entry)
    && typeof entry === "object"
    && typeof entry.spritesheet === "string"
    && Number.isInteger(entry.row)
    && Number.isInteger(entry.columns)
    && entry.columns > 0;
}

function frameImage(entry, index = 0) {
  if (isSpriteSheetFrameEntry(entry)) {
    const sheetPath = path.join(pack.root, ...entry.spritesheet.replace(/\\/g, "/").split("/"));
    const sheet = nativeImage.createFromPath(sheetPath);
    if (sheet.isEmpty()) {
      return nativeImage.createEmpty();
    }
    const sheetSize = sheet.getSize();
    const cellWidth = Math.floor(sheetSize.width / entry.columns);
    const cellHeight = pack.manifest.cellSize?.height ?? 208;
    const column = index % entry.columns;
    if (!cellWidth || !cellHeight || (entry.row + 1) * cellHeight > sheetSize.height) {
      return nativeImage.createEmpty();
    }
    return sheet.crop({
      x: column * cellWidth,
      y: entry.row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    });
  }
  const fileName = Array.isArray(entry.files)
    ? entry.files[index] ?? entry.files[0]
    : `${String(index).padStart(2, "0")}.png`;
  return nativeImage.createFromPath(path.join(pack.root, ...entry.frames.split("/"), fileName));
}

function fallbackTrayImage() {
  const packagedIcon = process.resourcesPath
    ? path.join(process.resourcesPath, "tray-fallback.ico")
    : null;
  const sourceIcon = path.join(__dirname, "..", "resources", "icon.ico");
  const iconPath = [packagedIcon, sourceIcon].find((candidate) => candidate && fs.existsSync(candidate));
  return iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
}

function trayImage(entry) {
  const image = frameImage(entry);
  return image.isEmpty() ? fallbackTrayImage() : image;
}

function petDisplayName() {
  return pack?.displayName ?? "桌宠";
}

function refreshTray() {
  if (!tray) {
    return;
  }
  const icon = trayImage(pack.manifest.normal.idle);
  tray.setImage(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(`${petDisplayName()}桌宠 - ${stateLabel(currentState)}`);
  tray.setContextMenu(buildTrayMenu());
}

function reloadPetWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    resetPetInputState();
    restorePetWindowSize();
    mainWindow.webContents.reloadIgnoringCache();
  }
}

function selectPet(id) {
  setActivePetPack(id, {
    storageRoot,
    builtinRoots: defaultPackRoots(),
  });
  loadPackCatalog();
  overrideMtimeMs = 0;
  refreshTray();
  reloadPetWindow();
}

async function importPetFolder() {
  const result = await dialog.showOpenDialog({
    title: "选择桌宠文件夹",
    buttonLabel: "导入桌宠",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }
  try {
    const importedPack = importGeneratedPetPack(result.filePaths[0], {
      storageRoot,
      builtinRoots: defaultPackRoots(),
    });
    loadPackCatalog();
    overrideMtimeMs = 0;
    refreshTray();
    reloadPetWindow();
    await dialog.showMessageBox({
      type: "info",
      title: "桌宠已导入",
      message: `已导入并切换为“${importedPack.displayName}”。`,
    });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "无法导入桌宠",
      message: error.message,
    });
  }
}

function petWindowSize() {
  const cellSize = pack?.manifest?.cellSize ?? { width: 192, height: 208 };
  return {
    width: Math.round(cellSize.width * PET_WINDOW_SCALE * zoom),
    height: Math.round(cellSize.height * PET_WINDOW_SCALE * zoom),
  };
}

function lockPetWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const { width, height } = petWindowSize();
  mainWindow.setMinimumSize(width, height);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setResizable(false);
}

function restorePetWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const bounds = mainWindow.getBounds();
  const { width, height } = petWindowSize();
  if (bounds.width === width && bounds.height === height) {
    return;
  }
  // Allow both growth and shrinkage before restoring the fixed dimensions for a new pet pack.
  mainWindow.setMinimumSize(Math.min(bounds.width, width), Math.min(bounds.height, height));
  mainWindow.setMaximumSize(Math.max(bounds.width, width), Math.max(bounds.height, height));
  mainWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  lockPetWindowSize();
}

function createWindow() {
  resetPetInputState();
  const display = screen.getPrimaryDisplay();
  const { width, height } = petWindowSize();
  const workArea = display.workArea;
  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 32,
    y: workArea.y + workArea.height - height - 48,
    frame: false,
    transparent: true,
    resizable: false,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockPetWindowSize();
  applyMouseIgnore();
  mainWindow.webContents.on("did-start-loading", resetPetInputState);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("will-resize", (event) => event.preventDefault());
  mainWindow.on("resize", restorePetWindowSize);
  mainWindow.on("closed", () => {
    closeTaskPanel();
    mainWindow = null;
    clearDrag();
  });
}

function taskPanelHeight() {
  return Math.min(
    TASK_PANEL_MAX_HEIGHT,
    TASK_PANEL_MIN_HEIGHT + Math.max(1, activeTasks.length) * TASK_PANEL_ROW_HEIGHT,
  );
}

function sendTasksToPanel() {
  if (taskPanelWindow && !taskPanelWindow.isDestroyed()) {
    taskPanelWindow.webContents.send("pet:tasks", { tasks: activeTasks });
  }
}

function isTaskPanelAnchor(value) {
  return Number.isFinite(value?.right)
    && Number.isFinite(value?.top)
    && Number.isFinite(value?.bottom);
}

function fallbackTaskPanelAnchor(bounds) {
  return {
    right: bounds.x + bounds.width,
    top: bounds.y,
    bottom: bounds.y + bounds.height,
  };
}

function positionTaskPanel() {
  if (!taskPanelWindow || taskPanelWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const petBounds = mainWindow.getBounds();
  const anchor = isTaskPanelAnchor(taskPanelAnchor)
    ? taskPanelAnchor
    : fallbackTaskPanelAnchor(petBounds);
  const display = screen.getDisplayNearestPoint({ x: anchor.right, y: anchor.top })
    ?? screen.getDisplayMatching(petBounds)
    ?? screen.getPrimaryDisplay();
  const height = taskPanelHeight();
  taskPanelWindow.setBounds(taskPanelBoundsForAnchor(
    anchor,
    TASK_PANEL_WIDTH,
    height,
    display.workArea,
  ));
}

function closeTaskPanel() {
  setTaskPanelPointerActive(false);
  if (taskPanelWindow && !taskPanelWindow.isDestroyed() && taskPanelWindow.isVisible()) {
    taskPanelWindow.hide();
  }
}

function taskPanelIsVisible() {
  return Boolean(taskPanelWindow && !taskPanelWindow.isDestroyed() && taskPanelWindow.isVisible());
}

function prepareTaskPanel() {
  if (taskPanelWindow && !taskPanelWindow.isDestroyed()) {
    return taskPanelWindow;
  }
  taskPanelWindow = new BrowserWindow({
    width: TASK_PANEL_WIDTH,
    height: taskPanelHeight(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  taskPanelWindow.setAlwaysOnTop(true, "screen-saver");
  taskPanelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  taskPanelWindow.loadFile(path.join(__dirname, "renderer", "task-panel.html"));
  taskPanelWindow.once("ready-to-show", () => {
    sendTasksToPanel();
  });
  taskPanelWindow.on("closed", () => {
    taskPanelPointerActive = false;
    applyMouseIgnore();
    taskPanelWindow = null;
  });
  return taskPanelWindow;
}

function createTaskPanel() {
  if (!mainWindow || mainWindow.isDestroyed() || activeTasks.length === 0) {
    return;
  }
  const panel = prepareTaskPanel();
  const reveal = () => {
    if (!taskPanelWindow || taskPanelWindow !== panel || panel.isDestroyed()) {
      return;
    }
    positionTaskPanel();
    panel.showInactive();
    if (typeof panel.moveTop === "function") {
      panel.moveTop();
    }
    sendTasksToPanel();
  };
  if (panel.webContents.isLoading()) {
    panel.once("ready-to-show", reveal);
  } else {
    reveal();
  }
}

function toggleTaskPanel(anchor) {
  if (isTaskPanelAnchor(anchor)) {
    taskPanelAnchor = anchor;
  }
  if (taskPanelIsVisible()) {
    closeTaskPanel();
    return;
  }
  createTaskPanel();
}

function updateTaskPanelAnchor(_event, anchor) {
  if (!isTaskPanelAnchor(anchor)) {
    return;
  }
  taskPanelAnchor = anchor;
  positionTaskPanel();
}

function updateActiveTasks(tasks) {
  activeTasks = Array.isArray(tasks)
    ? tasks.filter((task) => typeof task?.id === "string" && typeof task?.threadId === "string")
    : [];
  if (activeTasks.length === 0) {
    closeTaskPanel();
    return;
  }
  positionTaskPanel();
  sendTasksToPanel();
}

async function openDeepSeekHarness() {
  const harnessWindow = await focusHarnessWindow();
  if (!harnessWindow.found) {
    await shell.openExternal("http://127.0.0.1:3080").catch(() => {});
  }
}

async function openTask(_event, taskId) {
  const task = activeTasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return;
  }
  closeTaskPanel();
  if (task.source === "deepseek-harness") {
    await openDeepSeekHarness();
    return;
  }
  shell.openExternal(codexThreadUrl(task.threadId)).catch(() => {});
}

function stateLabel(state) {
  return {
    rest: "常态",
    running: "工作中",
    waiting: "等待输入",
    review: "审查结果",
    failed: "受阻",
  }[state] ?? state;
}

function emitState(state, source) {
  currentState = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pet:state", { state, source, zoom, tasks: activeTasks });
  }
  if (tray) {
    tray.setToolTip(`${petDisplayName()}桌宠 - ${stateLabel(state)}`);
    tray.setContextMenu(buildTrayMenu());
  }
}

function clearTerminalTimer() {
  if (terminalTimer) {
    clearTimeout(terminalTimer);
    terminalTimer = null;
  }
}

function setState(state, source = "manual") {
  clearTerminalTimer();
  emitState(state, source);
  if ((source === "codex-session-log" || source === "deepseek-harness-session-log")
    && (state === "review" || state === "failed")) {
    terminalTimer = setTimeout(() => {
      terminalTimer = null;
      emitState("rest", "terminal-timeout");
    }, TERMINAL_HOLD_MS);
  }
}

function syncAutoState() {
  if (!autoMonitoring) {
    return;
  }
  for (const monitor of monitors) {
    monitor.poll({ force: true }).catch(() => {});
  }
}

function setManualState(state) {
  manualState = state;
  autoMonitoring = false;
  setState(resolvePetState({
    activeTasks,
    autoMonitoring,
    monitorState: currentState,
    manualState,
  }), "manual");
}

function setZoom(nextZoom) {
  zoom = nextZoom;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay();
    const { width, height } = petWindowSize();
    if (width > bounds.width || height > bounds.height) {
      mainWindow.setMaximumSize(width, height);
    } else {
      mainWindow.setMinimumSize(width, height);
    }
    mainWindow.setBounds(resizeWindowBounds(bounds, width, height, display.workArea));
    lockPetWindowSize();
    positionTaskPanel();
  }
  emitState(currentState, "zoom");
}

function setClickThrough(nextValue) {
  clickThrough = nextValue;
  if (clickThrough) {
    clearDrag();
    closeTaskPanel();
  }
  applyMouseIgnore();
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function shouldIgnoreMouseEvents() {
  return clickThrough || hitTestPassthrough || taskPanelPointerActive;
}

function applyMouseIgnore() {
  const ignoreMouseEvents = shouldIgnoreMouseEvents();
  writeInputDiagnostic("applyMouseIgnore", "更新原生鼠标忽略状态", {
    clickThrough,
    hitTestPassthrough,
    taskPanelPointerActive,
    ignoreMouseEvents,
  }, __filename, 493);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(
      ignoreMouseEvents,
      ignoreMouseEvents ? { forward: true } : undefined,
    );
  }
}

function forwardPointerForHitTest() {
  if (!mainWindow || mainWindow.isDestroyed() || clickThrough || taskPanelPointerActive
    || !hitTestPassthrough || dragAnchor) {
    return;
  }
  try {
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const clientX = cursor.x - bounds.x;
    const clientY = cursor.y - bounds.y;
    writeInputDiagnostic("forwardPointerForHitTest", "原生光标位置转发到渲染器", {
      cursor,
      bounds,
      clientX,
      clientY,
      scaleFactor: screen.getDisplayMatching(bounds)?.scaleFactor,
    }, __filename, 512);
    if (clientX < 0 || clientY < 0 || clientX >= bounds.width || clientY >= bounds.height) {
      return;
    }
    mainWindow.webContents.send("pet:pointer-position", { clientX, clientY });
  } catch {
    // A transient screen or WebContents failure must not interrupt the desktop pet.
  }
}

function startPointerHitTestPolling() {
  if (pointerHitTestTimer) {
    clearInterval(pointerHitTestTimer);
  }
  pointerHitTestTimer = setInterval(forwardPointerForHitTest, HIT_TEST_POLL_INTERVAL_MS);
}

function resetPetInputState() {
  clearDrag();
  taskPanelPointerActive = false;
  hitTestPassthrough = false;
  applyMouseIgnore();
}

function setHitTestPassthrough(nextValue) {
  const nextPassthrough = Boolean(nextValue);
  if (hitTestPassthrough !== nextPassthrough) {
    hitTestPassthrough = nextPassthrough;
    if (hitTestPassthrough) {
      clearDrag();
    }
  }
  applyMouseIgnore();
}

function setTaskPanelPointerActive(nextValue) {
  const nextActive = Boolean(nextValue);
  if (taskPanelPointerActive === nextActive) {
    return;
  }
  taskPanelPointerActive = nextActive;
  if (nextActive) {
    clearDrag();
    hitTestPassthrough = true;
  } else {
    // Leaving or closing the task panel must never leave the pet window click-through.
    hitTestPassthrough = false;
  }
  applyMouseIgnore();
}

function clearDrag() {
  dragAnchor = null;
  dragSession = null;
}

function startDrag(_event, dragId) {
  if (!mainWindow || mainWindow.isDestroyed() || clickThrough) {
    return;
  }
  taskPanelAnchor = null;
  closeTaskPanel();
  hitTestPassthrough = false;
  applyMouseIgnore();
  const bounds = mainWindow.getBounds();
  dragAnchor = createDragAnchor(bounds, centerPointForBounds(bounds));
  dragSession = startDragSession(dragId);
}

function updateDrag(_event, dragId, sequence, screenX, screenY) {
  if (!mainWindow || mainWindow.isDestroyed() || !dragAnchor || clickThrough) {
    return;
  }
  if (!acceptsDragUpdate(dragSession, dragId, sequence)) {
    return;
  }
  try {
    // Renderer pointer coordinates are sampled in the same animation frame that emits this update.
    const pointerPoint = { x: screenX, y: screenY };
    if (!isScreenPoint(pointerPoint)) {
      clearDrag();
      return;
    }
    const position = dragPositionFor(pointerPoint, dragAnchor);
    if (!isWindowPosition(position)) {
      clearDrag();
      return;
    }
    mainWindow.setPosition(position.x, position.y);
  } catch {
    clearDrag();
  }
}

function endDrag(_event, dragId) {
  if (!isCurrentDragSession(dragSession, dragId)) {
    return;
  }
  clearDrag();
}

function buildTrayMenu() {
  const petItems = (packCatalog?.packs ?? []).map((candidate) => ({
    label: candidate.displayName,
    type: "radio",
    checked: candidate.id === pack?.id,
    click: () => {
      try {
        selectPet(candidate.id);
      } catch (error) {
        dialog.showErrorBox("无法切换桌宠", error.message);
      }
    },
  }));
  return Menu.buildFromTemplate([
    { label: `${petDisplayName()} - ${stateLabel(currentState)}`, enabled: false },
    {
      label: "桌宠形象",
      submenu: [
        ...petItems,
        { type: "separator" },
        { label: "导入桌宠文件夹...", click: () => importPetFolder() },
      ],
    },
    { type: "separator" },
    {
      label: "自动监听 Codex 和 DeepSeek Harness",
      type: "checkbox",
      checked: autoMonitoring,
      click: (item) => {
        autoMonitoring = item.checked;
        clearTerminalTimer();
        if (autoMonitoring) {
          syncAutoState();
        } else {
          manualState = currentState;
        }
        if (tray) tray.setContextMenu(buildTrayMenu());
      },
    },
    {
      label: "手动状态",
      submenu: [
        { label: "常态", click: () => setManualState("rest") },
        { label: "开始工作", click: () => setManualState("running") },
        { label: "等待输入", click: () => setManualState("waiting") },
        { label: "审查结果", click: () => setManualState("review") },
        { label: "受阻", click: () => setManualState("failed") },
      ],
    },
    { type: "separator" },
    {
      label: "缩放",
      submenu: [
        ...ZOOM_LEVELS.map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: "radio",
          checked: zoom === value,
          click: () => setZoom(value),
        })),
      ],
    },
    {
      label: "鼠标穿透",
      type: "checkbox",
      checked: clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: "打开状态文件夹",
      click: () => {
        if (fs.existsSync(pack.stateFile)) {
          shell.showItemInFolder(pack.stateFile);
        } else {
          shell.openPath(path.dirname(pack.stateFile));
        }
      },
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = trayImage(pack.manifest.normal.idle);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(`${petDisplayName()}桌宠`);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    mainWindow.showInactive();
  });
}

function applyBridgeOverride() {
  let stat;
  try {
    stat = fs.statSync(pack.stateFile);
  } catch {
    return;
  }
  if (stat.mtimeMs <= overrideMtimeMs) {
    return;
  }
  overrideMtimeMs = stat.mtimeMs;
  try {
    const override = JSON.parse(fs.readFileSync(pack.stateFile, "utf8"));
    const state = override?.state;
    if (state === "auto") {
      autoMonitoring = true;
      syncAutoState();
    } else if (["rest", "running", "waiting", "review", "failed"].includes(state)) {
      setManualState(state);
    }
  } catch {
    // Ignore a partially written bridge file and retry when its timestamp changes.
  }
}

function handleMonitorStatus({ status, source, tasks }) {
  monitorSnapshots.set(source, {
    status,
    tasks: Array.isArray(tasks) ? tasks : [],
    updatedAt: Date.now(),
  });
  const monitoredTasks = [...monitorSnapshots.values()].flatMap((snapshot) => snapshot.tasks);
  updateActiveTasks(monitoredTasks);
  const latest = [...monitorSnapshots.entries()]
    .filter(([, snapshot]) => snapshot.status !== "rest")
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)[0];
  const monitorState = activeTasks.length > 0 ? "running" : latest?.[1].status ?? "rest";
  const stateSource = activeTasks.length > 0 ? source : latest?.[0] ?? source;
  const nextState = resolvePetState({
    activeTasks,
    autoMonitoring,
    monitorState,
    manualState,
  });
  setState(nextState, autoMonitoring || activeTasks.length > 0 ? stateSource : "manual");
}

function dshHomePath() {
  const configured = process.env.DSH_HOME?.trim();
  if (!configured) {
    return path.join(os.homedir(), ".dsh");
  }
  if (configured === "~") {
    return os.homedir();
  }
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return path.join(os.homedir(), configured.slice(2));
  }
  return path.resolve(configured);
}

function startStatusSources() {
  const codexMonitor = new CodexSessionMonitor({
    sessionRoot: path.join(os.homedir(), ".codex", "sessions"),
  });
  const deepSeekHarnessMonitor = new DeepSeekHarnessMonitor({
    sessionRoot: path.join(dshHomePath(), "sessions"),
  });
  monitors = [codexMonitor, deepSeekHarnessMonitor];
  for (const monitor of monitors) {
    monitor.on("status", handleMonitorStatus);
    monitor.on("warning", () => {});
    monitor.start().catch(() => {});
  }
  overrideTimer = setInterval(applyBridgeOverride, 1000);
}

function installIpcHandlers() {
  ipcMain.handle("pet:get-bootstrap", () => ({
    assetBaseUrl: pack.baseUrl,
    manifest: pack.manifest,
    displayName: pack.displayName,
    state: currentState,
    zoom,
    tasks: activeTasks,
  }));
  ipcMain.handle("pet:get-task-panel-bootstrap", () => ({ tasks: activeTasks }));
  ipcMain.on("pet:drag-start", startDrag);
  ipcMain.on("pet:drag-move", updateDrag);
  ipcMain.on("pet:drag-end", endDrag);
  ipcMain.on("pet:show-context-menu", () => {
    const menu = buildTrayMenu();
    menu.popup({ window: mainWindow });
  });
  ipcMain.handle("pet:open-deepseek-harness", () => openDeepSeekHarness());
  ipcMain.on("pet:toggle-task-panel", (_event, anchor) => toggleTaskPanel(anchor));
  ipcMain.on("pet:task-bubble-anchor", updateTaskPanelAnchor);
  ipcMain.on("pet:task-panel-hover", (_event, hovering) => setTaskPanelPointerActive(hovering));
  ipcMain.on("pet:close-task-panel", () => closeTaskPanel());
  ipcMain.on("pet:open-task", openTask);
  ipcMain.on("pet:set-hit-test-passthrough", (_event, passthrough) => {
    setHitTestPassthrough(passthrough);
  });
  ipcMain.on("pet:input-diagnostic", (_event, entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    writeInputDiagnostic(
      typeof entry.functionName === "string" ? entry.functionName : "renderer-input",
      typeof entry.context === "string" ? entry.context : "渲染器输入事件",
      entry.keyData,
      path.join(__dirname, "renderer", "renderer.js"),
      Number.isInteger(entry.sourceLine) ? entry.sourceLine : 0,
    );
  });
}

app.whenReady().then(() => {
  try {
    loadPackCatalog();
  } catch (error) {
    app.showErrorBox(APP_NAME, error.message);
    app.quit();
    return;
  }
  installIpcHandlers();
  createWindow();
  startPointerHitTestPolling();
  createTray();
  prepareTaskPanel();
  startStatusSources();
  emitState("rest", "startup");
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  clearDrag();
  clearTerminalTimer();
  if (overrideTimer) clearInterval(overrideTimer);
  if (pointerHitTestTimer) clearInterval(pointerHitTestTimer);
  for (const monitor of monitors) {
    monitor.stop();
  }
});
