const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  CodexSessionMonitor,
  latestRelevantEvent,
  parseRelevantEvent,
  sessionIsFresh,
  sessionIdFromPath,
  taskTitleFromMessage,
  tasksForSession,
} = require("../src/status-monitor");

function line(eventType, turnId) {
  return JSON.stringify({
    timestamp: "2026-08-05T10:00:00.000Z",
    type: "event_msg",
    payload: { type: eventType, ...(turnId ? { turn_id: turnId } : {}) },
  });
}

function sessionMeta(id) {
  return JSON.stringify({
    timestamp: "2026-08-05T10:00:00.000Z",
    type: "session_meta",
    payload: { session_id: id },
  });
}

function userMessage(message) {
  return JSON.stringify({
    timestamp: "2026-08-05T10:00:00.000Z",
    type: "event_msg",
    payload: { type: "user_message", message },
  });
}

test("maps Codex task lifecycle events to pet states", () => {
  assert.equal(parseRelevantEvent(line("task_started")).status, "running");
  assert.equal(parseRelevantEvent(line("task_complete")).status, "review");
  assert.equal(parseRelevantEvent(line("turn_aborted")).status, "failed");
  assert.equal(parseRelevantEvent(line("agent_reasoning")), null);
});

test("uses the latest lifecycle event from a session", () => {
  const latest = latestRelevantEvent([
    line("task_started"),
    line("agent_reasoning"),
    line("task_complete"),
  ]);
  assert.equal(latest.status, "review");
  assert.equal(latest.eventType, "task_complete");
});

test("derives task identity and compact titles for the task list", () => {
  assert.equal(
    sessionIdFromPath("C:/sessions/rollout-2026-08-05T10-00-00-11111111-2222-3333-4444-555555555555.jsonl"),
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(taskTitleFromMessage("  Build\n  the desktop pet  "), "Build the desktop pet");
});

test("uses rest for an empty or stale session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-pet-monitor-"));
  const events = [];
  const monitor = new CodexSessionMonitor({ sessionRoot: root, staleAfterMs: 100 });
  monitor.on("status", (event) => events.push(event));

  try {
    await monitor.poll();
    assert.equal(events.at(-1).status, "rest");

    const session = path.join(root, "session.jsonl");
    await fs.writeFile(session, `${line("task_started")}\n`);
    await monitor.poll();
    assert.equal(events.at(-1).status, "running");

    const oldTime = new Date(Date.now() - 10_000);
    await fs.utimes(session, oldTime, oldTime);
    await monitor.poll();
    assert.equal(events.at(-1).status, "rest");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reports every fresh running session and updates the count while status stays running", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-pet-monitor-"));
  const firstId = "11111111-2222-3333-4444-555555555555";
  const secondId = "66666666-7777-8888-9999-aaaaaaaaaaaa";
  const first = path.join(root, `rollout-2026-08-05T10-00-00-${firstId}.jsonl`);
  const second = path.join(root, `rollout-2026-08-05T10-00-01-${secondId}.jsonl`);
  const events = [];
  const monitor = new CodexSessionMonitor({ sessionRoot: root, staleAfterMs: 60_000 });
  monitor.on("status", (event) => events.push(event));

  try {
    await fs.writeFile(first, `${sessionMeta(firstId)}\n${userMessage("First active task")}\n${line("task_started")}\n`);
    await fs.writeFile(second, `${sessionMeta(secondId)}\n${userMessage("Second active task")}\n${line("task_started")}\n`);
    await monitor.poll();

    assert.equal(events.at(-1).status, "running");
    assert.deepEqual(events.at(-1).tasks.map((task) => task.id).sort(), [firstId, secondId].sort());
    assert.deepEqual(events.at(-1).tasks.map((task) => task.title).sort(), ["First active task", "Second active task"]);

    await fs.appendFile(second, `${line("task_complete")}\n`);
    await monitor.poll();
    assert.equal(events.at(-1).status, "running");
    assert.deepEqual(events.at(-1).tasks.map((task) => task.id), [firstId]);

    await fs.appendFile(first, `${line("task_complete")}\n`);
    await monitor.poll();
    assert.equal(events.at(-1).status, "review");
    assert.deepEqual(events.at(-1).tasks, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("counts concurrent turns in the same fresh Codex session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-pet-monitor-"));
  const threadId = "11111111-2222-3333-4444-555555555555";
  const firstTurnId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const secondTurnId = "ffffffff-1111-2222-3333-444444444444";
  const session = path.join(root, `rollout-2026-08-05T10-00-00-${threadId}.jsonl`);
  const events = [];
  const monitor = new CodexSessionMonitor({ sessionRoot: root, staleAfterMs: 60_000 });
  monitor.on("status", (event) => events.push(event));

  try {
    await fs.writeFile(session, [
      sessionMeta(threadId),
      userMessage("First concurrent task"),
      line("task_started", firstTurnId),
      userMessage("Second concurrent task"),
      line("task_started", secondTurnId),
      "",
    ].join("\n"));
    await monitor.poll();

    assert.equal(events.at(-1).status, "running");
    assert.deepEqual(
      events.at(-1).tasks.map((task) => task.id).sort(),
      [`${threadId}:${firstTurnId}`, `${threadId}:${secondTurnId}`].sort(),
    );
    assert.deepEqual(events.at(-1).tasks.map((task) => task.threadId), [threadId, threadId]);
    assert.deepEqual(events.at(-1).tasks.map((task) => task.title).sort(), [
      "First concurrent task",
      "Second concurrent task",
    ]);

    await fs.appendFile(session, `${line("task_complete", firstTurnId)}\n`);
    await monitor.poll();
    assert.deepEqual(events.at(-1).tasks.map((task) => task.id), [`${threadId}:${secondTurnId}`]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("keeps a running task visible when Codex reports fresh thread activity", () => {
  const now = Date.now();
  const session = {
    mtimeMs: now - 10 * 60_000,
    threadUpdatedAtMs: now - 2_000,
  };

  assert.equal(sessionIsFresh(session, now, 60_000), true);
  assert.equal(sessionIsFresh({ ...session, threadUpdatedAtMs: now - 2 * 60_000 }, now, 60_000), false);
});

test("uses the rollout filename task id when session metadata points to a parent session", () => {
  const now = Date.now();
  const taskId = "11111111-2222-3333-4444-555555555555";
  const tasks = tasksForSession({
    fallbackThreadId: taskId,
    threadId: "66666666-7777-8888-9999-aaaaaaaaaaaa",
    mtimeMs: now,
    turns: new Map([["legacy", { status: "running", title: "Active task", updatedAt: now }]]),
  }, now, 60_000);

  assert.deepEqual(tasks, [{
    id: taskId,
    threadId: taskId,
    title: "Active task",
    updatedAt: now,
  }]);
});

test("prefers the readable Codex thread title over a raw user prompt", () => {
  const now = Date.now();
  const threadId = "11111111-2222-3333-4444-555555555555";
  const tasks = tasksForSession({
    fallbackThreadId: threadId,
    threadTitle: "Repair pet task labels",
    mtimeMs: now,
    turns: new Map([["legacy", {
      status: "running",
      title: "${neat-freak}(C:\\Users\\15458\\.agents\\skills\\neat-freak\\SKILL.md)",
      updatedAt: now,
    }]]),
  }, now, 60_000);

  assert.equal(tasks[0].title, "Repair pet task labels");
});

test("can force a status refresh after manual mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-pet-monitor-"));
  const monitor = new CodexSessionMonitor({ sessionRoot: root });
  const events = [];
  monitor.on("status", (event) => events.push(event));

  try {
    await monitor.poll();
    await monitor.poll({ force: true });

    assert.equal(events.length, 2);
    assert.equal(events[0].status, "rest");
    assert.equal(events[1].status, "rest");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
