const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");

const RELEVANT_EVENTS = new Map([
  ["task_started", "running"],
  ["task_complete", "review"],
  ["turn_aborted", "failed"],
  ["task_failed", "failed"],
]);

const READ_CHUNK_BYTES = 64 * 1024;
const THREAD_ID_PATTERN = /-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i;

function parseEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseRelevantEventEntry(entry) {
  if (entry?.type !== "event_msg") {
    return null;
  }

  const eventType = entry.payload?.type;
  const status = RELEVANT_EVENTS.get(eventType);
  if (!status) {
    return null;
  }

  const timestamp = Date.parse(entry.timestamp);
  return {
    eventType,
    status,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

function parseRelevantEvent(line) {
  return parseRelevantEventEntry(parseEntry(line));
}

function latestRelevantEvent(lines) {
  let latest = null;
  for (const line of lines) {
    const event = parseRelevantEvent(line);
    if (event) {
      latest = event;
    }
  }
  return latest;
}

function sessionIdFromPath(filePath) {
  return path.basename(filePath).match(THREAD_ID_PATTERN)?.[1] ?? null;
}

function normalizePath(filePath) {
  return path.resolve(filePath.replace(/^\\\\\?\\/, ""));
}

function pathIsWithinRoot(filePath, root) {
  const relativePath = path.relative(normalizePath(root), normalizePath(filePath));
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function stateDatabasePath(sessionRoot) {
  const codexRoot = path.dirname(sessionRoot);
  try {
    return fs.readdirSync(codexRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(codexRoot, entry.name);
        return { path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path ?? null;
  } catch {
    return null;
  }
}

function recentThreadActivityByPath(sessionRoot, sinceMs) {
  const databasePath = stateDatabasePath(sessionRoot);
  if (!databasePath) {
    return new Map();
  }

  let database;
  try {
    // Electron bundles Node 22's read-only SQLite API; plain Node test runs fall back to logs only.
    const { DatabaseSync } = require("node:sqlite");
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare("SELECT rollout_path, updated_at_ms, title FROM threads WHERE archived = 0 AND updated_at_ms >= ?")
      .all(sinceMs);
    const activity = new Map();
    for (const row of rows) {
      if (typeof row.rollout_path !== "string" || !Number.isFinite(row.updated_at_ms)) {
        continue;
      }
      if (pathIsWithinRoot(row.rollout_path, sessionRoot)) {
        activity.set(normalizePath(row.rollout_path), {
          updatedAtMs: row.updated_at_ms,
          title: taskTitleFromMessage(row.title),
        });
      }
    }
    return activity;
  } catch {
    return new Map();
  } finally {
    database?.close();
  }
}

function taskTitleFromMessage(message, maxLength = 72) {
  if (typeof message !== "string") {
    return null;
  }
  const title = message.replace(/\s+/g, " ").trim();
  if (!title) {
    return null;
  }
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}...` : title;
}

function createSessionState(filePath) {
  return {
    path: filePath,
    fallbackThreadId: sessionIdFromPath(filePath),
    threadId: null,
    threadTitle: null,
    pendingTitle: null,
    latest: null,
    turns: new Map(),
    offset: 0,
    pending: Buffer.alloc(0),
    mtimeMs: 0,
  };
}

function turnIdFromEvent(entry) {
  const turnId = entry?.payload?.turn_id;
  return typeof turnId === "string" && turnId ? turnId : "legacy";
}

function consumeSessionEntry(session, entry) {
  if (!entry) {
    return;
  }
  if (entry.type === "session_meta") {
    const threadId = entry.payload?.session_id ?? entry.payload?.id;
    if (typeof threadId === "string" && threadId) {
      session.threadId = threadId;
    }
  }
  if (entry.type === "event_msg" && entry.payload?.type === "user_message") {
    const title = taskTitleFromMessage(entry.payload.message);
    if (title) {
      session.pendingTitle = title;
    }
  }

  const event = parseRelevantEventEntry(entry);
  if (event) {
    session.latest = event;
    const turnId = turnIdFromEvent(entry);
    const previousTurn = session.turns.get(turnId);
    if (event.status === "running") {
      session.turns.set(turnId, {
        status: "running",
        title: session.pendingTitle ?? previousTurn?.title ?? null,
        updatedAt: event.timestamp,
      });
    } else if (previousTurn) {
      session.turns.set(turnId, {
        ...previousTurn,
        status: event.status,
        updatedAt: event.timestamp,
      });
    }
  }
}

function sessionIsFresh(session, now, staleAfterMs) {
  const latestActivityMs = Math.max(session.mtimeMs, session.threadUpdatedAtMs ?? 0);
  return now - latestActivityMs <= staleAfterMs;
}

function tasksForSession(session, now, staleAfterMs) {
  if (!sessionIsFresh(session, now, staleAfterMs)) {
    return [];
  }
  // Codex stores the UI task ID in the rollout filename; session_meta can carry an older parent session ID.
  const threadId = session.fallbackThreadId ?? session.threadId;
  if (!threadId) {
    return [];
  }
  return [...session.turns.entries()]
    .filter(([, turn]) => turn.status === "running")
    .map(([turnId, turn]) => ({
      id: turnId === "legacy" ? threadId : `${threadId}:${turnId}`,
      threadId,
      title: session.threadTitle ?? turn.title ?? `Task ${threadId.slice(0, 8)}`,
      updatedAt: turn.updatedAt,
    }));
}

async function collectSessionFiles(root, limit, threadActivityByPath = new Map()) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = await fs.promises.stat(child);
          files.push({ path: child, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // The Codex writer may rotate a session while it is being scanned.
        }
      }
    }));
  }

  await visit(root);
  const selected = files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
  const selectedPaths = new Set(selected.map((file) => normalizePath(file.path)));
  for (const [filePath] of threadActivityByPath) {
    if (selectedPaths.has(filePath)) {
      continue;
    }
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) {
        selected.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    } catch {
      // A recently updated thread can rotate its session file between the database query and this scan.
    }
  }
  return selected.map((file) => {
    const threadActivity = threadActivityByPath.get(normalizePath(file.path));
    return {
      ...file,
      threadUpdatedAtMs: threadActivity?.updatedAtMs ?? 0,
      threadTitle: threadActivity?.title ?? null,
    };
  });
}

class CodexSessionMonitor extends EventEmitter {
  constructor({ sessionRoot, pollIntervalMs = 1500, staleAfterMs = 60000, fileLimit = 48 }) {
    super();
    this.sessionRoot = sessionRoot;
    this.pollIntervalMs = pollIntervalMs;
    this.staleAfterMs = staleAfterMs;
    this.fileLimit = fileLimit;
    this.timer = null;
    this.sessions = new Map();
    this.lastPublishedSnapshot = null;
    this.polling = false;
  }

  async start() {
    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((error) => this.emit("warning", error));
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll({ force = false } = {}) {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const now = Date.now();
      const threadActivityByPath = recentThreadActivityByPath(
        this.sessionRoot,
        now - this.staleAfterMs,
      );
      const files = await collectSessionFiles(this.sessionRoot, this.fileLimit, threadActivityByPath);
      const filePaths = new Set(files.map((file) => file.path));
      for (const filePath of this.sessions.keys()) {
        if (!filePaths.has(filePath)) {
          this.sessions.delete(filePath);
        }
      }

      for (const file of files) {
        let session = this.sessions.get(file.path);
        if (!session || file.size < session.offset) {
          session = createSessionState(file.path);
          this.sessions.set(file.path, session);
        }
        session.mtimeMs = file.mtimeMs;
        session.threadUpdatedAtMs = file.threadUpdatedAtMs;
        session.threadTitle = file.threadTitle;
        await this.readAppended(file, session);
      }

      const sessions = [...this.sessions.values()];
      const tasks = sessions
        .flatMap((session) => tasksForSession(session, now, this.staleAfterMs))
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const latest = sessions
        .filter((session) => session.latest && sessionIsFresh(session, now, this.staleAfterMs))
        .map((session) => session.latest)
        .sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
      const status = tasks.length > 0 ? "running" : latest?.status ?? "rest";
      this.publish(status, latest, tasks, force);
    } finally {
      this.polling = false;
    }
  }

  async readAppended(file, session) {
    if (file.size <= session.offset) {
      return;
    }

    const handle = await fs.promises.open(file.path, "r");
    try {
      while (session.offset < file.size) {
        const length = Math.min(READ_CHUNK_BYTES, file.size - session.offset);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(chunk, 0, length, session.offset);
        if (bytesRead === 0) {
          break;
        }
        session.offset += bytesRead;
        this.consumeChunk(session, chunk.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  }

  consumeChunk(session, chunk) {
    const combined = Buffer.concat([session.pending, chunk]);
    const newline = combined.lastIndexOf(0x0a);
    if (newline < 0) {
      session.pending = combined;
      return;
    }
    const complete = combined.subarray(0, newline).toString("utf8");
    session.pending = combined.subarray(newline + 1);
    for (const line of complete.split(/\r?\n/)) {
      consumeSessionEntry(session, parseEntry(line));
    }
  }

  publish(status, event, tasks, force = false) {
    const snapshot = JSON.stringify({
      status,
      eventType: event?.eventType ?? null,
      timestamp: event?.timestamp ?? null,
      tasks: tasks.map(({ id, threadId, title }) => ({ id, threadId, title })),
    });
    if (!force && snapshot === this.lastPublishedSnapshot) {
      return;
    }
    this.lastPublishedSnapshot = snapshot;
    this.emit("status", {
      status,
      source: "codex-session-log",
      eventType: event?.eventType ?? null,
      timestamp: event?.timestamp ?? null,
      tasks,
    });
  }
}

module.exports = {
  CodexSessionMonitor,
  RELEVANT_EVENTS,
  latestRelevantEvent,
  parseRelevantEvent,
  recentThreadActivityByPath,
  sessionIsFresh,
  sessionIdFromPath,
  taskTitleFromMessage,
  tasksForSession,
};
