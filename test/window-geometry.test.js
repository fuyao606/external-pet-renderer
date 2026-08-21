const test = require("node:test");
const assert = require("node:assert/strict");
const { resizeWindowBounds, taskPanelBoundsForAnchor } = require("../src/window-geometry");

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test("keeps an enlarged pet window fully visible at the work area edge", () => {
  const result = resizeWindowBounds(
    { x: 1816, y: 914, width: 72, height: 78 },
    420,
    455,
    workArea,
  );

  assert.deepEqual(result, { x: 1500, y: 585, width: 420, height: 455 });
});

test("preserves the pet center when the resized window still fits", () => {
  const result = resizeWindowBounds(
    { x: 600, y: 300, width: 120, height: 130 },
    240,
    260,
    workArea,
  );

  assert.deepEqual(result, { x: 540, y: 235, width: 240, height: 260 });
});

test("opens a task panel below a bubble when there is no room above it", () => {
  const result = taskPanelBoundsForAnchor(
    { right: 100, top: 20, bottom: 38 },
    288,
    126,
    workArea,
  );

  assert.deepEqual(result, { x: 0, y: 46, width: 288, height: 126 });
});

test("keeps a task panel aligned to the bubble right edge when it fits above", () => {
  const result = taskPanelBoundsForAnchor(
    { right: 1900, top: 900, bottom: 918 },
    288,
    126,
    workArea,
  );

  assert.deepEqual(result, { x: 1612, y: 766, width: 288, height: 126 });
});
