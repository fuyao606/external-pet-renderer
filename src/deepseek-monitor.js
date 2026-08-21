const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { zstdDecompressSync } = require("node:zlib");

const READ_LIMIT = 48;
const ZSTD_MAGIC = 0xFD2FB528;

function parseJsonLines(content) {
  return content.toString("utf8").split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      break;
    }
    offset += 4;
    if (offset === buffer.length) break;

    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) break;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerBytes) break;
    offset += headerBytes;

    let complete = false;
    while (offset < buffer.length) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (blockType === 3 || buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (lastBlock) {
        complete = true;
        break;
      }
    }
    if (!complete || (checksum && buffer.length - offset < 4)) break;
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function readDshLog(filePath, content) {
  if (filePath.endsWith(".zstd")) {
    const frames = scanZstdFrames(content);
    return frames.flatMap((frame) => {
      try {
        return parseJsonLines(zstdDecompressSync(content.subarray(frame.start, frame.end)));
      } catch {
        return [];
      }
    });
  }
  return parseJsonLines(content);
}

function dshTitle(value, maxLength = 72) {
  if (typeof value !== "string") {
    return null;
  }
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) {
    return null;
  }
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}...` : title;
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    }).join("\n");
  }
  return null;
}

function dshTaskTitle(event) {
  return dshTitle(
    textFromContent(event?.data?.content)
    ?? textFromContent(event?.data?.message?.content)
    ?? event?.data?.text,
  );
}

function sessionIdFromDshLog(events, filePath) {
  const header = events.find((event) => event?.type === "session");
  if (typeof header?.id === "string" && header.id) {
    return header.id;
  }
  return path.basename(path.dirname(filePath));
}

function statusFromTurnEnd(event) {
  const kind = event?.data?.reason?.kind;
  return ["aborted", "error", "interrupted"].includes(kind) ? "failed" : "review";
}

function parseDshSession(filePath, content, mtimeMs) {
  const events = readDshLog(filePath, content);
  const sessionId = sessionIdFromDshLog(events, filePath);
  let latest = null;
  let activeTurn = null;
  let title = null;

  for (const event of events) {
    if (event?.type === "user/message" && event.data?.source?.kind === "user") {
      title = dshTaskTitle(event) ?? title;
    } else if (event?.type === "turn/start") {
      activeTurn = event.data?.turn;
      latest = { status: "running", eventType: "turn/start", timestamp: event.time ?? mtimeMs };
    } else if (event?.type === "turn/end") {
      activeTurn = null;
      latest = {
        status: statusFromTurnEnd(event),
        eventType: "turn/end",
        timestamp: event.time ?? mtimeMs,
      };
    }
  }

  return {
    id: sessionId,
    mtimeMs,
    latest,
    task: Number.isSafeInteger(activeTurn) ? {
      id: `${sessionId}:${activeTurn}`,
      threadId: sessionId,
      source: "deepseek-harness",
      title: title ?? `DeepSeek Harness ${sessionId.slice(-8)}`,
      updatedAt: latest?.timestamp ?? mtimeMs,
    } : null,
  };
}

async function collectDshLogs(root, limit) {
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
      } else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name === "session.jsonl.zstd")) {
        try {
          const stat = await fs.promises.stat(child);
          files.push({ path: child, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {
          // The Harness may finish or rotate a session while it is scanned.
        }
      }
    }));
  }
  await visit(root);
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
}

class DeepSeekHarnessMonitor extends EventEmitter {
  constructor({ sessionRoot, pollIntervalMs = 1500, staleAfterMs = 60000, fileLimit = READ_LIMIT }) {
    super();
    this.sessionRoot = sessionRoot;
    this.pollIntervalMs = pollIntervalMs;
    this.staleAfterMs = staleAfterMs;
    this.fileLimit = fileLimit;
    this.timer = null;
    this.polling = false;
    this.sessions = new Map();
    this.lastPublishedSnapshot = null;
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
    if (this.polling) return;
    this.polling = true;
    try {
      const now = Date.now();
      const files = await collectDshLogs(this.sessionRoot, this.fileLimit);
      const paths = new Set(files.map((file) => file.path));
      for (const filePath of this.sessions.keys()) {
        if (!paths.has(filePath)) this.sessions.delete(filePath);
      }
      for (const file of files) {
        const cached = this.sessions.get(file.path);
        if (cached?.mtimeMs === file.mtimeMs && cached.size === file.size) continue;
        try {
          const content = await fs.promises.readFile(file.path);
          const session = parseDshSession(file.path, content, file.mtimeMs);
          session.size = file.size;
          this.sessions.set(file.path, session);
        } catch {
          // A concurrent append can expose a temporary incomplete final frame.
        }
      }
      const fresh = [...this.sessions.values()].filter((session) => now - session.mtimeMs <= this.staleAfterMs);
      const tasks = fresh.flatMap((session) => session.task ? [session.task] : [])
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const latest = fresh.map((session) => session.latest).filter(Boolean)
        .sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
      this.publish(tasks.length > 0 ? "running" : latest?.status ?? "rest", latest, tasks, force);
    } finally {
      this.polling = false;
    }
  }

  publish(status, event, tasks, force) {
    const snapshot = JSON.stringify({
      status,
      eventType: event?.eventType ?? null,
      timestamp: event?.timestamp ?? null,
      tasks: tasks.map(({ id, threadId, title }) => ({ id, threadId, title })),
    });
    if (!force && snapshot === this.lastPublishedSnapshot) return;
    this.lastPublishedSnapshot = snapshot;
    this.emit("status", {
      status,
      source: "deepseek-harness-session-log",
      eventType: event?.eventType ?? null,
      timestamp: event?.timestamp ?? null,
      tasks,
    });
  }
}

module.exports = {
  DeepSeekHarnessMonitor,
  dshTaskTitle,
  parseDshSession,
  readDshLog,
  statusFromTurnEnd,
};
