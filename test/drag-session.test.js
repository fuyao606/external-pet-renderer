const test = require("node:test");
const assert = require("node:assert/strict");
const { acceptsDragUpdate, isCurrentDragSession, startDragSession } = require("../src/drag-session");

test("rejects stale updates from an active drag session", () => {
  const session = startDragSession(4);

  assert.equal(acceptsDragUpdate(session, 4, 0), true);
  assert.equal(acceptsDragUpdate(session, 4, 2), true);
  assert.equal(acceptsDragUpdate(session, 4, 1), false);
  assert.equal(acceptsDragUpdate(session, 5, 3), false);
  assert.equal(isCurrentDragSession(session, 4), true);
  assert.equal(isCurrentDragSession(session, 5), false);
});
