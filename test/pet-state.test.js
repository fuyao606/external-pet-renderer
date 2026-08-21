const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePetState } = require("../src/pet-state");

test("forces the working form whenever Codex has active tasks", () => {
  assert.equal(resolvePetState({
    activeTasks: [{ id: "task-1" }],
    autoMonitoring: false,
    monitorState: "rest",
    manualState: "waiting",
  }), "running");
});

test("returns to the selected manual state after all tasks finish", () => {
  assert.equal(resolvePetState({
    activeTasks: [],
    autoMonitoring: false,
    monitorState: "running",
    manualState: "waiting",
  }), "waiting");
});

test("uses the monitor state when automatic monitoring is enabled", () => {
  assert.equal(resolvePetState({
    activeTasks: [],
    autoMonitoring: true,
    monitorState: "review",
    manualState: "rest",
  }), "review");
});
