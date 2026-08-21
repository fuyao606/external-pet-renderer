const test = require("node:test");
const assert = require("node:assert/strict");
const {
  centerPointForBounds,
  createDragAnchor,
  dragPositionFor,
  isScreenPoint,
  isWindowPosition,
} = require("../src/drag-geometry");

test("moves the character center directly under the pointer", () => {
  const initialBounds = { x: 800, y: -340 };
  const petCenter = { x: 836, y: -301 };
  const anchor = createDragAnchor(initialBounds, petCenter);

  assert.deepEqual(anchor, { x: 36, y: 39 });

  for (const point of [
    { x: 930, y: -240 },
    { x: 1046, y: -181 },
    { x: 1200, y: -80 },
  ]) {
    const position = dragPositionFor(point, anchor);
    assert.equal(position.x + anchor.x, point.x);
    assert.equal(position.y + anchor.y, point.y);
  }
});

test("uses the window center as the stable character anchor", () => {
  assert.deepEqual(
    centerPointForBounds({ x: 894, y: -279, width: 72, height: 78 }),
    { x: 930, y: -240 },
  );
});

test("accepts only finite pointer screen coordinates", () => {
  assert.equal(isScreenPoint({ x: 0, y: -1 }), true);
  assert.equal(isScreenPoint({ x: Number.NaN, y: 1 }), false);
  assert.equal(isScreenPoint({ x: 1 }), false);
});

test("allows only positions Electron can convert to window coordinates", () => {
  assert.equal(isWindowPosition({ x: 0, y: -1 }), true);
  assert.equal(isWindowPosition({ x: 12.5, y: 8 }), false);
  assert.equal(isWindowPosition({ x: 2 ** 31, y: 0 }), false);
  assert.equal(isWindowPosition({ x: 0, y: -(2 ** 31) - 1 }), false);
  assert.equal(isWindowPosition({ x: Number.NaN, y: 0 }), false);
});
