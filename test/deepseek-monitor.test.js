const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { zstdCompressSync } = require("node:zlib");
const {
  DeepSeekHarnessMonitor,
  parseDshSession,
  readDshLog,
  statusFromTurnEnd,
} = require("../src/deepseek-monitor");

const sessionId = "session-11111111-2222-3333-4444-555555555555";

function sessionHeader() {
  return {
    type: "session",
    version: 0,
    id: sessionId,
    createdAt: 1000,
    cwd: "D:\\Code\\external-pet-renderer",
    delegationDepth: 0,
  };
}

function event(type, seq, data, time = 1000 + seq) {
  return { type, seq, data, time };
}

function log(...events) {
  return Buffer.from([sessionHeader(), ...events].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

test("maps open and completed DeepSeek Harness turns to pet states", () => {
  const open = parseDshSession("C:/sessions/session.jsonl", log(
    event("user/message", 0, {
      content: "Implement DSH monitoring",
      source: { kind: "user" },
    }),
    event("turn/start", 1, { turn: 1 }),
  ), 2000);
  assert.equal(open.latest.status, "running");
  assert.deepEqual(open.task, {
    id: `${sessionId}:1`,
    threadId: sessionId,
    source: "deepseek-harness",
    title: "Implement DSH monitoring",
    updatedAt: 1001,
  });

  const completed = parseDshSession("C:/sessions/session.jsonl", log(
    event("turn/start", 0, { turn: 1 }),
    event("turn/end", 1, { turn: 1, reason: { kind: "completed" } }),
  ), 2000);
  assert.equal(completed.latest.status, "review");
  assert.equal(completed.task, null);
});

test("maps failed DeepSeek Harness turn endings to failed", () => {
  assert.equal(statusFromTurnEnd(event("turn/end", 1, { reason: { kind: "aborted" } })), "failed");
  assert.equal(statusFromTurnEnd(event("turn/end", 1, { reason: { kind: "error" } })), "failed");
  assert.equal(statusFromTurnEnd(event("turn/end", 1, { reason: { kind: "interrupted" } })), "failed");
  assert.equal(statusFromTurnEnd(event("turn/end", 1, { reason: { kind: "completed" } })), "review");
});

test("reads concatenated DSH Zstandard frames", () => {
  const content = Buffer.concat([
    zstdCompressSync(Buffer.from(`${JSON.stringify(sessionHeader())}\n`)),
    zstdCompressSync(Buffer.from(`${JSON.stringify(event("turn/start", 0, { turn: 1 }))}\n`)),
  ]);
  const entries = readDshLog("C:/sessions/session.jsonl.zstd", content);
  assert.deepEqual(entries.map((entry) => entry.type), ["session", "turn/start"]);
});

test("publishes active DeepSeek Harness tasks from fresh logs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "external-pet-dsh-monitor-"));
  const sessionDirectory = path.join(root, "project", sessionId);
  const filePath = path.join(sessionDirectory, "session.jsonl.zstd");
  const events = [];
  const monitor = new DeepSeekHarnessMonitor({ sessionRoot: root, staleAfterMs: 60_000 });
  monitor.on("status", (snapshot) => events.push(snapshot));

  try {
    await fs.mkdir(sessionDirectory, { recursive: true });
    await fs.writeFile(filePath, Buffer.concat([
      zstdCompressSync(Buffer.from(`${JSON.stringify(sessionHeader())}\n`)),
      zstdCompressSync(Buffer.from([
        JSON.stringify(event("user/message", 0, {
          content: "Run the desktop pet",
          source: { kind: "user" },
        })),
        JSON.stringify(event("turn/start", 1, { turn: 1 })),
        "",
      ].join("\n"))),
    ]));
    await monitor.poll();
    assert.equal(events.at(-1).status, "running");
    assert.deepEqual(events.at(-1).tasks.map((task) => task.title), ["Run the desktop pet"]);

    await fs.writeFile(filePath, Buffer.concat([
      await fs.readFile(filePath),
      zstdCompressSync(Buffer.from(`${JSON.stringify(event("turn/end", 2, {
        turn: 1,
        reason: { kind: "completed" },
      }))}\n`)),
    ]));
    await monitor.poll();
    assert.equal(events.at(-1).status, "review");
    assert.deepEqual(events.at(-1).tasks, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
