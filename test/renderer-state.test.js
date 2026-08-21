const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DragUpdateScheduler,
  PetRenderer,
  elementScreenBounds,
  nextDragMovementDirection,
  taskBubbleAnchorElement,
  taskCountLabel,
} = require("../src/renderer/renderer");

const manifest = {
  normal: {
    idle: { frames: "normal/idle", count: 1, loop: true },
    runningRight: { frames: "normal/running-right", count: 1, loop: true },
    runningLeft: { frames: "normal/running-left", count: 1, loop: true },
    mouseWave: { frames: "normal/interact-wave", count: 1, loop: false },
  },
  transformed: {
    taskActive: { frames: "transformed/task-active", count: 1, loop: true },
    waiting: { frames: "transformed/waiting", count: 1, loop: true },
    review: { frames: "transformed/review", count: 1, loop: true },
    failed: { frames: "transformed/failed", count: 1, loop: false },
    runningRight: { frames: "transformed/running-right", count: 1, loop: true },
    runningLeft: { frames: "transformed/running-left", count: 1, loop: true },
    mouseInteract: { frames: "transformed/interact", count: 1, loop: false },
  },
  transitions: {
    toTransformed: { frames: "transitions/to-transformed", count: 1, loop: false },
    toNormal: { frames: "transitions/to-normal", count: 1, loop: false },
  },
};

const singleManifest = {
  rendererMode: "single",
  normal: {
    idle: { frames: "frames/idle", files: ["00.png"], count: 1, loop: true },
    runningRight: { frames: "frames/running-right", files: ["00.png"], count: 1, loop: true },
    runningLeft: { frames: "frames/running-left", files: ["00.png"], count: 1, loop: true },
    mouseWave: { frames: "frames/waving", files: ["00.png"], count: 1, loop: false },
  },
  stateEntries: {
    running: { frames: "frames/running", files: ["00.png"], count: 1, loop: true },
    waiting: { frames: "frames/waiting", files: ["00.png"], count: 1, loop: true },
    review: { frames: "frames/review", files: ["00.png"], count: 1, loop: true },
    failed: { frames: "frames/failed", files: ["00.png"], count: 1, loop: false },
  },
};

function createRenderer({ image = {}, document = null, petManifest = manifest, spriteViewport } = {}) {
  global.document = document ?? {
    documentElement: { style: { setProperty() {} } },
  };
  const renderer = new PetRenderer({
    image,
    stage: {},
    spriteViewport,
    assetBaseUrl: "file:///pet/",
    manifest: petManifest,
    zoom: 1,
  });
  const plays = [];
  renderer.play = (entry, duration, options) => plays.push({ entry, duration, options });
  return { renderer, plays };
}

test("renders the first rest state instead of leaving the pet blank", () => {
  const { renderer, plays } = createRenderer();

  renderer.setDesired("rest");

  assert.equal(renderer.form, "normal");
  assert.equal(plays.at(-1).entry, manifest.normal.idle);
});

test("uses generated v2 animations without running a dual-form transition", () => {
  const { renderer, plays } = createRenderer({ petManifest: singleManifest });

  renderer.setDesired("running");

  assert.equal(renderer.mode, "single");
  assert.equal(plays.at(-1).entry, singleManifest.stateEntries.running);
});

test("returns a generated v2 pet to its active state after dragging", () => {
  const { renderer, plays } = createRenderer({ petManifest: singleManifest });
  renderer.setDesired("waiting");
  renderer.startMovement("right");

  renderer.stopMovement();

  assert.equal(plays.at(-1).entry, singleManifest.stateEntries.waiting);
});

test("returns to the desired animation after dragging", () => {
  const { renderer, plays } = createRenderer();
  renderer.setDesired("rest");
  renderer.startMovement("right");

  renderer.stopMovement();

  assert.equal(renderer.moving, false);
  assert.equal(plays.at(-1).entry, manifest.normal.idle);
});

test("requires sustained horizontal movement before switching the drag animation", () => {
  const pointer = {
    movementDirection: null,
    pendingMovementDirection: null,
    pendingMovementDistance: 0,
  };

  assert.deepEqual([2, 2, 2, 2].map((deltaX) => nextDragMovementDirection(pointer, deltaX)), [
    null,
    null,
    null,
    "right",
  ]);
  assert.deepEqual([-4, 4, -4, 4, -4, 4].map((deltaX) => nextDragMovementDirection(pointer, deltaX)), [
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual([-2, -2, -2, -2].map((deltaX) => nextDragMovementDirection(pointer, deltaX)), [
    null,
    null,
    null,
    "left",
  ]);
});

test("maps element bounds into screen coordinates for the task panel anchor", () => {
  const previousWindow = global.window;
  global.window = { screenX: 800, screenY: -340 };

  try {
    assert.deepEqual(
      elementScreenBounds({
        getBoundingClientRect: () => ({ left: 7, top: 8, right: 65, bottom: 26 }),
      }),
      { left: 807, top: -332, right: 865, bottom: -314 },
    );
  } finally {
    global.window = previousWindow;
  }
});

test("anchors the task panel to the visual badge instead of its larger hit target", () => {
  const previousWindow = global.window;
  const badge = {
    getBoundingClientRect: () => ({ left: 51, top: 8, right: 69, bottom: 26 }),
  };
  const button = {
    getBoundingClientRect: () => ({ left: 37, top: 8, right: 69, bottom: 40 }),
    querySelector: (selector) => (selector === ".task-count-badge" ? badge : null),
  };
  global.window = { screenX: 800, screenY: -340 };

  try {
    assert.equal(taskBubbleAnchorElement(button), badge);
    assert.deepEqual(elementScreenBounds(taskBubbleAnchorElement(button)), {
      left: 851,
      top: -332,
      right: 869,
      bottom: -314,
    });
  } finally {
    global.window = previousWindow;
  }
});

test("keeps the task bubble visual size separate from its clickable target", () => {
  const previousDocument = global.document;
  const cssVariables = new Map();
  const document = {
    documentElement: {
      style: {
        setProperty: (name, value) => cssVariables.set(name, value),
      },
    },
  };

  try {
    const { renderer } = createRenderer({ document });
    renderer.applyZoom(0.3);

    assert.equal(cssVariables.get("--task-bubble-size"), "18px");
    assert.equal(cssVariables.get("--task-bubble-hit-size"), "32px");
  } finally {
    global.document = previousDocument;
  }
});

test("coalesces fast drag updates and ignores stale updates", () => {
  const sent = [];
  let frame;
  const scheduler = new DragUpdateScheduler(
    (update) => sent.push(update),
    (callback) => {
      frame = callback;
      return 1;
    },
    () => {},
  );

  scheduler.begin();
  scheduler.queue({ sequence: 1, dragId: 4 });
  scheduler.queue({ sequence: 2, dragId: 4 });
  scheduler.queue({ sequence: 1, dragId: 4 });
  frame();

  assert.deepEqual(sent, [{ sequence: 2, dragId: 4 }]);

  scheduler.queue({ sequence: 2, dragId: 4 });
  scheduler.flush();
  assert.deepEqual(sent.at(-1), { sequence: 2, dragId: 4 });
});

test("keeps only the newest pending drag update", () => {
  const sent = [];
  let frame;
  const scheduler = new DragUpdateScheduler(
    (update) => sent.push(update),
    (callback) => {
      frame = callback;
      return 1;
    },
    () => {},
  );

  scheduler.begin();
  scheduler.queue({ sequence: 1, dragId: 4, screenX: 100, screenY: 200 });
  scheduler.queue({ sequence: 2, dragId: 4, screenX: 125, screenY: 230 });
  frame();

  assert.deepEqual(sent, [{ sequence: 2, dragId: 4, screenX: 125, screenY: 230 }]);
});

test("advances movement animation from animation-frame time without timer drift", () => {
  const priorRequestFrame = global.requestAnimationFrame;
  const priorCancelFrame = global.cancelAnimationFrame;
  const scheduled = [];
  let nextFrameId = 0;
  const rendered = [];
  global.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    scheduled.push({ id: nextFrameId, callback });
    return nextFrameId;
  };
  global.cancelAnimationFrame = (frameId) => {
    const index = scheduled.findIndex((frame) => frame.id === frameId);
    if (index >= 0) scheduled.splice(index, 1);
  };

  try {
    const { renderer } = createRenderer();
    renderer.play = PetRenderer.prototype.play.bind(renderer);
    renderer.setFrame = (_entry, index) => rendered.push(index);
    renderer.play({ count: 3 }, 100, { loop: true });

    scheduled.shift().callback(0);
    scheduled.shift().callback(99);
    scheduled.shift().callback(100);
    scheduled.shift().callback(301);

    assert.deepEqual(rendered, [0, 1, 0]);
  } finally {
    global.requestAnimationFrame = priorRequestFrame;
    global.cancelAnimationFrame = priorCancelFrame;
  }
});

test("formats the concurrent task count for the pet bubble", () => {
  assert.equal(taskCountLabel([]), "0");
  assert.equal(taskCountLabel([{ id: "a" }, { id: "b" }]), "2");
  assert.equal(taskCountLabel(Array.from({ length: 100 }, (_, index) => ({ id: String(index) }))), "99+");
});

test("treats unknown monitor states as rest", () => {
  const { renderer, plays } = createRenderer();

  renderer.setDesired("idle");

  assert.equal(renderer.desiredState, "rest");
  assert.equal(plays.at(-1).entry, manifest.normal.idle);
});

test("only enables interaction over opaque sprite pixels", () => {
  const priorWindow = global.window;
  const updates = [];
  const imageData = new Uint8ClampedArray([
    0, 0, 0, 0,
    0, 0, 0, 255,
    0, 0, 0, 255,
    0, 0, 0, 0,
  ]);
  const document = {
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({
      getContext: () => ({
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: imageData }),
      }),
    }),
  };
  const image = {
    src: "file:///pet/frame.png",
    currentSrc: "file:///pet/frame.png",
    naturalWidth: 2,
    naturalHeight: 2,
    complete: true,
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 }),
  };
  global.window = { petBridge: { setHitTestPassthrough: (value) => updates.push(value) } };

  try {
    const { renderer } = createRenderer({ image, document });

    assert.equal(renderer.updatePointerHitTest(20, 20), false);
    assert.equal(updates.at(-1), true);
    assert.equal(renderer.updatePointerHitTest(80, 20), true);
    assert.equal(updates.at(-1), false);
    assert.equal(renderer.updatePointerHitTest(120, 20), false);
    assert.equal(updates.at(-1), true);
  } finally {
    global.window = priorWindow;
  }
});

test("crops a spritesheet animation cell before testing transparent pixels", () => {
  const priorWindow = global.window;
  const updates = [];
  const draws = [];
  const imageData = new Uint8ClampedArray([
    0, 0, 0, 0,
    0, 0, 0, 255,
  ]);
  const document = {
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({
      getContext: () => ({
        clearRect() {},
        drawImage: (...args) => draws.push(args),
        getImageData: () => ({ data: imageData }),
      }),
    }),
  };
  const image = {
    src: "file:///pet/spritesheet.webp",
    currentSrc: "file:///pet/spritesheet.webp",
    naturalWidth: 16,
    naturalHeight: 416,
    complete: true,
    getBoundingClientRect: () => ({ left: 4, top: 4, right: 20, bottom: 420, width: 16, height: 416 }),
  };
  const spriteViewport = {
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 }),
  };
  const spritesheetEntry = {
    spritesheet: "spritesheet.webp",
    row: 1,
    columns: 8,
    count: 8,
  };
  global.window = { petBridge: { setHitTestPassthrough: (value) => updates.push(value) } };

  try {
    const { renderer } = createRenderer({ image, document, spriteViewport });
    renderer.setFrame(spritesheetEntry, 3);

    assert.equal(renderer.updatePointerHitTest(20, 10), false);
    assert.equal(renderer.updatePointerHitTest(80, 10), true);
    assert.deepEqual(draws.at(-1).slice(1), [6, 208, 2, 208, 0, 0, 2, 208]);
    assert.equal(updates.at(-1), false);
  } finally {
    global.window = priorWindow;
  }
});

test("keeps a reloaded pet interactive until pointer hit testing runs", () => {
  const priorWindow = global.window;
  const updates = [];
  global.window = { petBridge: { setHitTestPassthrough: (value) => updates.push(value) } };

  try {
    const { renderer } = createRenderer();

    assert.equal(renderer.hitTestPassthrough, false);
    assert.deepEqual(updates, [false]);
  } finally {
    global.window = priorWindow;
  }
});

test("does not enable click-through when a reloaded pet blurs before receiving pointer input", () => {
  const priorWindow = global.window;
  const updates = [];
  global.window = { petBridge: { setHitTestPassthrough: (value) => updates.push(value) } };

  try {
    const { renderer } = createRenderer();

    renderer.clearPointerHitTest();

    assert.equal(renderer.hitTestPassthrough, false);
    assert.deepEqual(updates, [false]);
  } finally {
    global.window = priorWindow;
  }
});
