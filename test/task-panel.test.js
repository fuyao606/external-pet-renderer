const test = require("node:test");
const assert = require("node:assert/strict");
const { createPanelHoverController, taskCountLabel } = require("../src/renderer/task-panel");

test("formats the task panel heading count", () => {
  assert.equal(taskCountLabel([]), "0");
  assert.equal(taskCountLabel([{ id: "a" }]), "1");
  assert.equal(taskCountLabel(Array.from({ length: 100 }, () => ({}))), "99+");
});

test("keeps the pet window click-through while the pointer remains in the task panel", () => {
  const hoverEvents = [];
  const timers = new Map();
  let nextTimerId = 0;
  const controller = createPanelHoverController(
    (hovering) => hoverEvents.push(hovering),
    {
      setTimer: (callback) => {
        nextTimerId += 1;
        timers.set(nextTimerId, callback);
        return nextTimerId;
      },
      clearTimer: (timerId) => timers.delete(timerId),
    },
  );

  controller.activate();
  controller.deactivate();
  controller.activate();
  assert.deepEqual(hoverEvents, [true]);

  controller.deactivate();
  const [timerId, callback] = timers.entries().next().value;
  timers.delete(timerId);
  callback();
  assert.deepEqual(hoverEvents, [true, false]);

  controller.activate(true);
  controller.dispose();
  assert.deepEqual(hoverEvents, [true, false, true, false]);
});
