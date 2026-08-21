const DURATIONS = {
  idle: 220,
  movement: 100,
  interact: 120,
  active: 130,
  waiting: 170,
  review: 160,
  failed: 120,
};

const PET_STATES = new Set(["rest", "running", "waiting", "review", "failed"]);
const DRAG_DIRECTION_HYSTERESIS_PX = 8;

function elementScreenBounds(element) {
  const rect = element.getBoundingClientRect();
  return {
    left: window.screenX + rect.left,
    top: window.screenY + rect.top,
    right: window.screenX + rect.right,
    bottom: window.screenY + rect.bottom,
  };
}

function taskCountLabel(tasks) {
  const count = Array.isArray(tasks) ? tasks.length : 0;
  return count > 99 ? "99+" : String(count);
}

function taskBubbleAnchorElement(taskBubble) {
  return taskBubble?.querySelector?.(".task-count-badge") ?? taskBubble;
}

function nextDragMovementDirection(pointer, deltaX, threshold = DRAG_DIRECTION_HYSTERESIS_PX) {
  if (!pointer || !Number.isFinite(deltaX) || deltaX === 0) {
    return null;
  }

  const candidate = deltaX > 0 ? "right" : "left";
  if (candidate === pointer.movementDirection) {
    pointer.pendingMovementDirection = null;
    pointer.pendingMovementDistance = 0;
    return null;
  }
  if (candidate !== pointer.pendingMovementDirection) {
    pointer.pendingMovementDirection = candidate;
    pointer.pendingMovementDistance = 0;
  }
  pointer.pendingMovementDistance += Math.abs(deltaX);
  if (pointer.pendingMovementDistance < threshold) {
    return null;
  }

  pointer.movementDirection = candidate;
  pointer.pendingMovementDirection = null;
  pointer.pendingMovementDistance = 0;
  return candidate;
}

function pointIsInsideElement(element, clientX, clientY) {
  if (!element || element.hidden) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom;
}

function isSpriteSheetFrameEntry(entry) {
  return Boolean(entry)
    && typeof entry === "object"
    && typeof entry.spritesheet === "string"
    && Number.isInteger(entry.row)
    && Number.isInteger(entry.columns)
    && entry.columns > 0;
}

class DragUpdateScheduler {
  constructor(send, requestFrame, cancelFrame) {
    this.send = send;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.frame = null;
    this.pending = null;
    this.latestSequence = -1;
  }

  begin() {
    this.reset();
  }

  queue(update) {
    if (update.sequence < this.latestSequence) {
      return false;
    }
    this.latestSequence = update.sequence;
    this.pending = update;
    if (this.frame !== null) {
      return true;
    }
    this.frame = this.requestFrame(() => {
      this.frame = null;
      const nextUpdate = this.pending;
      this.pending = null;
      if (nextUpdate) {
        this.send(nextUpdate);
      }
    });
    return true;
  }

  flush() {
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    const nextUpdate = this.pending;
    this.pending = null;
    if (nextUpdate) {
      this.send(nextUpdate);
    }
  }

  reset() {
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    this.pending = null;
    this.latestSequence = -1;
  }
}

class PetRenderer {
  constructor({ image, stage, spriteViewport, assetBaseUrl, manifest, zoom }) {
    this.image = image;
    this.stage = stage;
    this.spriteViewport = spriteViewport ?? image;
    this.assetBaseUrl = assetBaseUrl;
    this.manifest = manifest;
    this.zoom = zoom;
    this.mode = manifest.rendererMode === "single" ? "single" : "dual";
    this.form = "normal";
    // The first requested state must render even when it is "rest".
    this.desiredState = null;
    this.moving = false;
    this.dragging = false;
    this.timer = null;
    this.token = 0;
    this.hitCanvas = null;
    this.hitContext = null;
    this.hitFrame = null;
    this.hitData = null;
    this.hitWidth = 0;
    this.hitHeight = 0;
    this.spriteSheetFrame = null;
    this.lastPointerPosition = null;
    this.hitTestPassthrough = null;
    if (typeof this.image.addEventListener === "function") {
      this.image.addEventListener("load", () => {
        this.applySpriteSheetFrame();
        this.hitFrame = null;
        this.hitData = null;
        if (!this.moving && !this.dragging && this.lastPointerPosition) {
          this.updatePointerHitTest(this.lastPointerPosition.clientX, this.lastPointerPosition.clientY);
        }
      });
    }
    this.applyZoom(zoom);
    // Keep the native window interactive until the first pointer hit test completes.
    this.setHitTestPassthrough(false);
  }

  applyZoom(zoom) {
    this.zoom = zoom;
    const cellSize = this.manifest.cellSize ?? { width: 192, height: 208 };
    document.documentElement.style.setProperty("--pet-width", `${cellSize.width}px`);
    document.documentElement.style.setProperty("--pet-height", `${cellSize.height}px`);
    const taskBubbleSize = Math.max(18, Math.round(14 + zoom * 12));
    document.documentElement.style.setProperty("--pet-scale", String(zoom));
    document.documentElement.style.setProperty("--task-bubble-size", `${taskBubbleSize}px`);
    document.documentElement.style.setProperty("--task-bubble-hit-size", `${Math.max(32, taskBubbleSize + 12)}px`);
    this.applySpriteSheetFrame();
  }

  frameUrl(framesPath, index) {
    const entry = typeof framesPath === "string" ? null : framesPath;
    if (isSpriteSheetFrameEntry(entry)) {
      return new URL(entry.spritesheet, this.assetBaseUrl).href;
    }
    const directory = entry?.frames ?? framesPath;
    const fileName = Array.isArray(entry?.files)
      ? entry.files[index] ?? entry.files[0]
      : `${String(index).padStart(2, "0")}.png`;
    return new URL(`${directory}/${fileName}`, this.assetBaseUrl).href;
  }

  applySpriteSheetFrame() {
    const frame = this.spriteSheetFrame;
    if (!frame || !this.image.style || !this.image.naturalWidth || !this.image.naturalHeight) {
      return;
    }
    const sourceCellWidth = this.image.naturalWidth / frame.entry.columns;
    const sourceCellHeight = this.manifest.cellSize?.height ?? 208;
    if (!Number.isInteger(sourceCellWidth) || sourceCellWidth < 1 || sourceCellHeight < 1
      || (frame.entry.row + 1) * sourceCellHeight > this.image.naturalHeight) {
      return;
    }
    const displayCellWidth = (this.manifest.cellSize?.width ?? 192) * this.zoom;
    const displayCellHeight = (this.manifest.cellSize?.height ?? 208) * this.zoom;
    const scaleX = displayCellWidth / sourceCellWidth;
    const scaleY = displayCellHeight / sourceCellHeight;
    const column = frame.index % frame.entry.columns;
    this.image.style.width = `${this.image.naturalWidth * scaleX}px`;
    this.image.style.height = `${this.image.naturalHeight * scaleY}px`;
    this.image.style.transform = `translate(${-column * sourceCellWidth * scaleX}px, ${-frame.entry.row * sourceCellHeight * scaleY}px)`;
  }

  setFrame(entry, index = 0) {
    if (isSpriteSheetFrameEntry(entry)) {
      this.spriteSheetFrame = { entry, index };
      this.image.classList?.add("spritesheet-frame");
      const source = this.frameUrl(entry, index);
      if (this.image.src !== source) {
        this.image.src = source;
      }
      this.applySpriteSheetFrame();
      return;
    }
    this.spriteSheetFrame = null;
    this.image.classList?.remove("spritesheet-frame");
    if (this.image.style) {
      this.image.style.width = "";
      this.image.style.height = "";
      this.image.style.transform = "";
    }
    this.image.src = this.frameUrl(entry, index);
  }

  getHitData() {
    const spriteFrame = this.spriteSheetFrame;
    const imageSource = this.image.currentSrc || this.image.src;
    const width = spriteFrame
      ? this.image.naturalWidth / spriteFrame.entry.columns
      : this.image.naturalWidth;
    const height = spriteFrame
      ? this.manifest.cellSize?.height ?? 208
      : this.image.naturalHeight;
    const frame = spriteFrame
      ? `${imageSource}#${spriteFrame.entry.row}:${spriteFrame.index % spriteFrame.entry.columns}`
      : imageSource;
    if (!frame || !width || !height || !this.image.complete) {
      return null;
    }
    if (this.hitFrame === frame) {
      return this.hitData;
    }

    try {
      if (!this.hitCanvas) {
        this.hitCanvas = document.createElement("canvas");
        this.hitContext = this.hitCanvas.getContext("2d", { willReadFrequently: true });
      }
      this.hitCanvas.width = width;
      this.hitCanvas.height = height;
      this.hitContext.clearRect(0, 0, width, height);
      if (spriteFrame) {
        const sourceX = (spriteFrame.index % spriteFrame.entry.columns) * width;
        const sourceY = spriteFrame.entry.row * height;
        this.hitContext.drawImage(this.image, sourceX, sourceY, width, height, 0, 0, width, height);
      } else {
        this.hitContext.drawImage(this.image, 0, 0, width, height);
      }
      this.hitData = this.hitContext.getImageData(0, 0, width, height).data;
      this.hitWidth = width;
      this.hitHeight = height;
    } catch {
      // A browser that cannot read local image alpha still restricts input to the image bounds.
      this.hitData = false;
      this.hitWidth = width;
      this.hitHeight = height;
    }
    this.hitFrame = frame;
    return this.hitData;
  }

  isOpaqueAt(clientX, clientY) {
    const hitElement = this.spriteSheetFrame ? this.spriteViewport : this.image;
    const rect = hitElement.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top
      || clientX >= rect.right || clientY >= rect.bottom) {
      return false;
    }

    const hitData = this.getHitData();
    if (hitData === false) {
      return true;
    }
    if (!hitData) {
      return false;
    }

    const pixelX = Math.floor((clientX - rect.left) * this.hitWidth / rect.width);
    const pixelY = Math.floor((clientY - rect.top) * this.hitHeight / rect.height);
    const alphaOffset = (pixelY * this.hitWidth + pixelX) * 4 + 3;
    return hitData[alphaOffset] > 0;
  }

  setHitTestPassthrough(passthrough) {
    const nextPassthrough = Boolean(passthrough);
    if (this.hitTestPassthrough === nextPassthrough) {
      return;
    }
    this.hitTestPassthrough = nextPassthrough;
    if (typeof window !== "undefined" && window.petBridge?.setHitTestPassthrough) {
      window.petBridge.setHitTestPassthrough(nextPassthrough);
    }
  }

  recordInputDiagnostic(functionName, context, keyData, sourceLine) {
    if (typeof window !== "undefined" && window.petBridge?.recordInputDiagnostic) {
      window.petBridge.recordInputDiagnostic({ functionName, context, keyData, sourceLine });
    }
  }

  updatePointerHitTest(clientX, clientY) {
    this.lastPointerPosition = { clientX, clientY };
    if (this.moving || this.dragging) {
      this.setHitTestPassthrough(false);
      return true;
    }
    const opaque = this.isOpaqueAt(clientX, clientY);
    this.recordInputDiagnostic("updatePointerHitTest", "渲染器像素命中判断", {
      clientX,
      clientY,
      opaque,
      imageRect: this.image.getBoundingClientRect(),
      naturalWidth: this.image.naturalWidth,
      naturalHeight: this.image.naturalHeight,
      frame: this.image.currentSrc || this.image.src,
    }, 247);
    this.setHitTestPassthrough(!opaque);
    return opaque;
  }

  clearPointerHitTest() {
    const hadPointerPosition = this.lastPointerPosition !== null;
    this.lastPointerPosition = null;
    if (hadPointerPosition && !this.moving && !this.dragging) {
      this.setHitTestPassthrough(true);
    }
  }

  setDragging(dragging) {
    this.dragging = dragging;
    if (dragging) {
      this.setHitTestPassthrough(false);
    }
  }

  stop() {
    this.token += 1;
    if (this.timer !== null) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
  }

  play(entry, duration, { loop = false, onComplete } = {}) {
    this.stop();
    const token = this.token;
    const frameDuration = Math.max(1, Number.isFinite(duration) ? duration : 100);
    const frameCount = Math.max(1, entry.count ?? 1);
    let index = 0;
    let startedAt = null;
    let renderedIndex = -1;
    const advance = (now) => {
      if (token !== this.token) return;
      startedAt ??= now;
      const elapsedFrames = Math.floor((now - startedAt) / frameDuration);
      if (loop) {
        index = elapsedFrames % frameCount;
      } else {
        index = Math.min(elapsedFrames, frameCount - 1);
      }
      if (index !== renderedIndex) {
        renderedIndex = index;
        this.setFrame(entry, index);
      }
      if (!loop && elapsedFrames >= frameCount) {
        this.timer = null;
        onComplete?.();
        return;
      }
      this.timer = requestAnimationFrame(advance);
    };
    this.timer = requestAnimationFrame(advance);
  }

  normalIdle() {
    this.form = "normal";
    this.play(this.manifest.normal.idle, DURATIONS.idle, { loop: true });
  }

  transformedEntryFor(state) {
    if (state === "running") return this.manifest.transformed.taskActive;
    return this.manifest.transformed[state];
  }

  singleEntryFor(state) {
    if (state === "rest") return this.manifest.normal.idle;
    return this.manifest.stateEntries[state] ?? this.manifest.normal.idle;
  }

  playSingleDesired() {
    const entry = this.singleEntryFor(this.desiredState);
    const duration = {
      running: DURATIONS.active,
      waiting: DURATIONS.waiting,
      review: DURATIONS.review,
      failed: DURATIONS.failed,
    }[this.desiredState] ?? DURATIONS.idle;
    this.play(entry, duration, {
      loop: entry.loop !== false,
      onComplete: () => {
        if (this.desiredState === "failed") {
          this.setFrame(entry, entry.count - 1);
        }
      },
    });
  }

  playDesired() {
    if (this.desiredState === "rest") {
      this.normalIdle();
      return;
    }
    const entry = this.transformedEntryFor(this.desiredState);
    const duration = {
      running: DURATIONS.active,
      waiting: DURATIONS.waiting,
      review: DURATIONS.review,
      failed: DURATIONS.failed,
    }[this.desiredState] ?? DURATIONS.active;
    this.form = "transformed";
    this.play(entry, duration, {
      loop: entry.loop !== false,
      onComplete: () => {
        if (this.desiredState === "failed") {
          this.setFrame(entry, entry.count - 1);
        }
      },
    });
  }

  resumeDesired() {
    if (this.mode === "single") {
      this.playSingleDesired();
      return;
    }
    this.playDesired();
  }

  setDesired(state) {
    if (!PET_STATES.has(state)) {
      state = "rest";
    }
    if (state === this.desiredState && !this.moving) return;
    this.desiredState = state;
    this.moving = false;
    if (this.mode === "single") {
      this.playSingleDesired();
      return;
    }
    if (state === "rest") {
      if (this.form === "transformed") {
        this.play(this.manifest.transitions.toNormal, this.manifest.transitions.toNormal.frameDurationMs ?? 100, {
          onComplete: () => this.normalIdle(),
        });
      } else {
        this.normalIdle();
      }
      return;
    }

    if (this.form === "normal") {
      this.play(this.manifest.transitions.toTransformed, this.manifest.transitions.toTransformed.frameDurationMs ?? 100, {
        onComplete: () => this.playDesired(),
      });
      return;
    }
    this.playDesired();
  }

  startMovement(direction) {
    if (this.moving && this.direction === direction) return;
    this.moving = true;
    this.setHitTestPassthrough(false);
    this.direction = direction;
    const group = this.mode === "single" || this.form === "normal"
      ? this.manifest.normal
      : this.manifest.transformed;
    const entry = direction === "right" ? group.runningRight : group.runningLeft;
    this.play(entry, DURATIONS.movement, { loop: true });
  }

  stopMovement() {
    if (!this.moving) return;
    this.moving = false;
    this.resumeDesired();
  }

  interact() {
    if (this.moving) return;
    const entry = this.mode === "single"
      ? this.manifest.normal.mouseWave
      : this.form === "transformed"
      ? this.manifest.transformed.mouseInteract
      : this.manifest.normal.mouseWave;
    this.play(entry, DURATIONS.interact, {
      onComplete: () => this.resumeDesired(),
    });
  }
}

async function start() {
  let renderer;
  let pendingState;
  let taskBubble;
  let taskBubbleBadge;
  const reportTaskBubbleAnchor = () => {
    if (!taskBubble || taskBubble.hidden) {
      return;
    }
    window.petBridge.updateTaskBubbleAnchor(elementScreenBounds(taskBubbleAnchorElement(taskBubble)));
  };
  const renderTaskCount = (tasks) => {
    const nextTasks = Array.isArray(tasks) ? tasks : [];
    if (!taskBubble) {
      return;
    }
    taskBubble.hidden = nextTasks.length === 0;
    taskBubbleBadge.textContent = taskCountLabel(nextTasks);
    taskBubble.setAttribute("aria-label", `查看 ${nextTasks.length} 个进行中的任务`);
    window.requestAnimationFrame(reportTaskBubbleAnchor);
  };
  window.petBridge.onState((payload) => {
    if (!renderer) {
      pendingState = payload;
      return;
    }
    renderer.applyZoom(payload.zoom);
    renderer.setDesired(payload.state);
    renderTaskCount(payload.tasks);
  });

  const bootstrap = await window.petBridge.getBootstrap();
  document.title = `${bootstrap.displayName ?? "桌宠"}桌宠`;
  const stage = document.getElementById("pet-stage");
  stage.setAttribute("aria-label", `${bootstrap.displayName ?? "桌宠"}桌宠`);
  taskBubble = document.getElementById("task-count");
  taskBubbleBadge = document.getElementById("task-count-badge");
  renderer = new PetRenderer({
    image: document.getElementById("pet-frame"),
    stage,
    spriteViewport: document.getElementById("pet-sprite-viewport"),
    assetBaseUrl: bootstrap.assetBaseUrl,
    manifest: bootstrap.manifest,
    zoom: pendingState?.zoom ?? bootstrap.zoom,
  });

  renderer.setDesired(pendingState?.state ?? bootstrap.state);
  renderTaskCount(pendingState?.tasks ?? bootstrap.tasks);

  let pointer = null;
  let nextDragId = 0;
  const dragUpdates = new DragUpdateScheduler(
    (update) => window.petBridge.updateDrag(
      update.dragId,
      update.sequence,
      update.screenX,
      update.screenY,
    ),
    (callback) => window.requestAnimationFrame(callback),
    (frame) => window.cancelAnimationFrame(frame),
  );
  const queueDragUpdate = () => {
    if (!pointer?.moved) return;
    dragUpdates.queue({
      dragId: pointer.dragId,
      sequence: pointer.sequence,
      screenX: pointer.lastX,
      screenY: pointer.lastY,
    });
  };
  const isTaskBubbleHit = (event) => pointIsInsideElement(taskBubble, event.clientX, event.clientY);
  const updateIdleHitTest = (event) => {
    if (isTaskBubbleHit(event)) {
      renderer.setHitTestPassthrough(false);
      return true;
    }
    return renderer.updatePointerHitTest(event.clientX, event.clientY);
  };
  window.petBridge.onPointerPosition((position) => {
    if (!pointer && Number.isFinite(position?.clientX) && Number.isFinite(position?.clientY)) {
      updateIdleHitTest(position);
    }
  });
  taskBubble.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    renderer.setHitTestPassthrough(false);
    taskBubble.setPointerCapture?.(event.pointerId);
  });
  taskBubble.addEventListener("click", (event) => {
    event.stopPropagation();
    window.petBridge.toggleTaskPanel(elementScreenBounds(taskBubbleAnchorElement(taskBubble)));
  });
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(reportTaskBubbleAnchor);
  });
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (isTaskBubbleHit(event) || !updateIdleHitTest(event)) return;
    renderer.setDragging(true);
    pointer = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragId: nextDragId += 1,
      sequence: 0,
      movementDirection: null,
      pendingMovementDirection: null,
      pendingMovementDistance: 0,
      moved: false,
    };
    dragUpdates.begin();
    window.petBridge.startDrag(pointer.dragId);
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pointer || pointer.id !== event.pointerId) {
      updateIdleHitTest(event);
      return;
    }
    const deltaX = event.screenX - pointer.lastX;
    const distanceX = event.screenX - pointer.startX;
    const distanceY = event.screenY - pointer.startY;
    if (!pointer.moved && Math.hypot(distanceX, distanceY) <= 2) return;
    pointer.moved = true;
    pointer.lastX = event.screenX;
    pointer.lastY = event.screenY;
    pointer.sequence += 1;
    const movementDirection = nextDragMovementDirection(pointer, deltaX);
    queueDragUpdate();
    if (movementDirection) {
      renderer.startMovement(movementDirection);
    }
  });
  // Electron forwards native mouse-move messages while a transparent window ignores clicks.
  // Those messages do not reliably produce PointerEvents on Windows, so use MouseEvent too
  // to restore interaction when the cursor reaches an opaque frame pixel.
  stage.addEventListener("mousemove", (event) => {
    if (!pointer) {
      updateIdleHitTest(event);
    }
  });
  const finishPointer = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const activePointer = pointer;
    const didMove = activePointer.moved;
    if (didMove) {
      dragUpdates.flush();
    }
    dragUpdates.reset();
    pointer = null;
    window.petBridge.endDrag(activePointer.dragId);
    renderer.setDragging(false);
    if (didMove) renderer.stopMovement();
    else window.petBridge.openDeepSeekHarness().catch(() => {});
    renderer.updatePointerHitTest(event.clientX, event.clientY);
  };
  // Pointer capture can be released while the native transparent window is being moved.
  // Listen at the window level so a completed drag cannot remain stuck afterward.
  window.addEventListener("pointerup", finishPointer, true);
  window.addEventListener("pointercancel", finishPointer, true);
  stage.addEventListener("lostpointercapture", finishPointer);
  stage.addEventListener("pointerleave", () => {
    if (!pointer) renderer.clearPointerHitTest();
  });
  stage.addEventListener("mouseleave", () => {
    if (!pointer) renderer.clearPointerHitTest();
  });
  stage.addEventListener("contextmenu", (event) => {
    if (isTaskBubbleHit(event) || !updateIdleHitTest(event)) return;
    event.preventDefault();
    window.petBridge.showContextMenu();
  });
  window.addEventListener("blur", () => {
    if (!pointer) renderer.clearPointerHitTest();
  });
}

if (typeof window !== "undefined") {
  start().catch((error) => {
    console.error(error);
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    DragUpdateScheduler,
    PetRenderer,
    elementScreenBounds,
    nextDragMovementDirection,
    pointIsInsideElement,
    taskBubbleAnchorElement,
    taskCountLabel,
  };
}
