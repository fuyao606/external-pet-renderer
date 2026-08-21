const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultPackRoots,
  importGeneratedPetPack,
  loadPetCatalog,
  loadPetPack,
  resolveGeneratedPetRoot,
  setActivePetPack,
} = require("../src/pet-pack");

function makeTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "external-pet-renderer-"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createGeneratedPack(root, { id = "sample-pet", name = "示例桌宠" } = {}) {
  const rows = [
    ["idle", 2],
    ["running-right", 2],
    ["running-left", 2],
    ["waving", 1],
    ["running", 2],
    ["waiting", 2],
    ["review", 2],
    ["failed", 2],
  ];
  for (const [state, count] of rows) {
    const directory = path.join(root, "frames", state);
    fs.mkdirSync(directory, { recursive: true });
    for (let index = 0; index < count; index += 1) {
      fs.writeFileSync(path.join(directory, `${String(index).padStart(2, "0")}.png`), "frame");
    }
  }
  writeJson(path.join(root, "pet_request.json"), {
    pet_id: id,
    display_name: name,
    description: "test pet",
    atlas: { cell_width: 192, cell_height: 208 },
  });
  writeJson(path.join(root, "frames", "frames-manifest.json"), {
    rows: rows.map(([state, count]) => ({
      state,
      frames: Array.from({ length: count }, (_, index) => `${state}/${String(index).padStart(2, "0")}.png`),
    })),
  });
}

function writeWebpHeader(filePath, width, height) {
  const file = Buffer.alloc(30);
  file.write("RIFF", 0, "ascii");
  file.writeUInt32LE(file.length - 8, 4);
  file.write("WEBP", 8, "ascii");
  file.write("VP8X", 12, "ascii");
  file.writeUInt32LE(10, 16);
  file[24] = (width - 1) & 0xff;
  file[25] = ((width - 1) >> 8) & 0xff;
  file[26] = ((width - 1) >> 16) & 0xff;
  file[27] = (height - 1) & 0xff;
  file[28] = ((height - 1) >> 8) & 0xff;
  file[29] = ((height - 1) >> 16) & 0xff;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, file);
}

function createCodexSpriteSheetPack(root, {
  id = "yingyu-aima",
  name = "樱羽艾玛",
  rows = 9,
  spriteVersionNumber,
} = {}) {
  const metadata = {
    id,
    displayName: name,
    description: "Codex spritesheet test pet",
    spritesheetPath: "spritesheet.webp",
  };
  if (spriteVersionNumber !== undefined) {
    metadata.spriteVersionNumber = spriteVersionNumber;
  }
  writeJson(path.join(root, "pet.json"), metadata);
  writeWebpHeader(path.join(root, "spritesheet.webp"), 1536, 208 * rows);
}

test("keeps the bundled default pack after optional environment overrides", () => {
  const roots = defaultPackRoots({
    homeDirectory: "C:\\Users\\test",
    environment: { EXTERNAL_PET_PACK: "D:\\pets\\custom" },
    bundledPackRoot: "D:\\app\\resources\\default-pet",
  });

  assert.deepEqual(roots.slice(0, 2), ["D:\\pets\\custom", "D:\\app\\resources\\default-pet"]);
  assert.equal(roots.at(-1).endsWith(path.join("resources", "default-pet")), true);
});

test("imports a generated v2 run and makes it the active pet", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "source");
  const storage = path.join(temporary, "storage");
  createGeneratedPack(source);

  try {
    const imported = importGeneratedPetPack(source, { storageRoot: storage });
    const catalog = loadPetCatalog({ storageRoot: storage, builtinRoots: [] });

    assert.equal(imported.id, "sample-pet");
    assert.equal(imported.manifest.rendererMode, "single");
    assert.equal(imported.manifest.normal.idle.count, 2);
    assert.equal(imported.manifest.stateEntries.failed.loop, false);
    assert.equal(catalog.active.id, "sample-pet");
    assert.equal(catalog.active.root, path.join(storage, "packs", "sample-pet"));
    assert.equal(fs.existsSync(path.join(catalog.active.root, "frames", "idle", "00.png")), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("resolves a generated run when the selected folder is its parent", () => {
  const temporary = makeTemporaryDirectory();
  const parent = path.join(temporary, "pets");
  const source = path.join(parent, "fuyou-v1-run");
  const storage = path.join(temporary, "storage");
  createGeneratedPack(source, { id: "parent-selected" });

  try {
    assert.equal(resolveGeneratedPetRoot(parent), source);
    const imported = importGeneratedPetPack(parent, { storageRoot: storage });
    assert.equal(imported.id, "parent-selected");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("resolves a generated run when the selected folder is inside frames", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "source");
  const storage = path.join(temporary, "storage");
  createGeneratedPack(source, { id: "frames-selected" });

  try {
    assert.equal(resolveGeneratedPetRoot(path.join(source, "frames")), source);
    const imported = importGeneratedPetPack(path.join(source, "frames"), { storageRoot: storage });
    assert.equal(imported.id, "frames-selected");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("reports the selected path when no generated run can be found", () => {
  const temporary = makeTemporaryDirectory();
  const selected = path.join(temporary, "not-a-pet");
  fs.mkdirSync(selected, { recursive: true });

  try {
    assert.throws(
      () => resolveGeneratedPetRoot(selected),
      (error) => error instanceof Error
        && error.message.includes(`Could not find a supported desk-pet folder from '${selected}'`),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("imports a Codex spritesheet pet and makes it the active pet", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "yingyu-aima");
  const storage = path.join(temporary, "storage");
  createCodexSpriteSheetPack(source);

  try {
    assert.equal(resolveGeneratedPetRoot(source), source);
    const sourcePack = loadPetPack(source);
    const imported = importGeneratedPetPack(source, { storageRoot: storage });
    const catalog = loadPetCatalog({ storageRoot: storage, builtinRoots: [] });

    assert.equal(sourcePack.manifest.sourceFormat, "codex-spritesheet");
    assert.equal(sourcePack.manifest.spriteVersionNumber, 1);
    assert.deepEqual(sourcePack.manifest.normal.idle, {
      spritesheet: "spritesheet.webp",
      row: 0,
      columns: 8,
      count: 6,
      loop: true,
    });
    assert.equal(imported.id, "yingyu-aima");
    assert.equal(catalog.active.id, "yingyu-aima");
    assert.equal(fs.existsSync(path.join(catalog.active.root, "spritesheet.webp")), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("accepts a v2 Codex spritesheet atlas", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "codex-v2");
  createCodexSpriteSheetPack(source, { rows: 11, spriteVersionNumber: 2 });

  try {
    const pack = loadPetPack(source);

    assert.equal(pack.manifest.spriteVersionNumber, 2);
    assert.equal(pack.manifest.stateEntries.review.row, 8);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("rejects a Codex spritesheet with an unsupported atlas size", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "invalid-codex-pet");
  createCodexSpriteSheetPack(source, { rows: 10 });

  try {
    assert.throws(
      () => loadPetPack(source),
      (error) => error instanceof Error
        && error.message.includes("8x9 or 8x11 atlas"),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("keeps imports with duplicate ids as separate selectable pets", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "source");
  const storage = path.join(temporary, "storage");
  createGeneratedPack(source, { id: "same-pet" });

  try {
    const first = importGeneratedPetPack(source, { storageRoot: storage });
    const second = importGeneratedPetPack(source, { storageRoot: storage });
    const selected = setActivePetPack(first.id, { storageRoot: storage, builtinRoots: [] });

    assert.equal(first.id, "same-pet");
    assert.equal(second.id, "same-pet-2");
    assert.equal(selected.id, "same-pet");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("avoids ids already used by built-in desk pets", () => {
  const temporary = makeTemporaryDirectory();
  const source = path.join(temporary, "source");
  const builtIn = path.join(temporary, "built-in");
  const storage = path.join(temporary, "storage");
  createGeneratedPack(source, { id: "shared-pet" });
  writeJson(path.join(builtIn, "manifest.json"), {
    petId: "shared-pet",
    displayName: "内置桌宠",
    normal: {
      idle: { frames: "normal/idle", count: 1 },
      runningRight: { frames: "normal/running-right", count: 1 },
      runningLeft: { frames: "normal/running-left", count: 1 },
      mouseWave: { frames: "normal/wave", count: 1 },
    },
    transformed: {
      taskActive: { frames: "transformed/running", count: 1 },
      waiting: { frames: "transformed/waiting", count: 1 },
      review: { frames: "transformed/review", count: 1 },
      failed: { frames: "transformed/failed", count: 1 },
      runningRight: { frames: "transformed/running-right", count: 1 },
      runningLeft: { frames: "transformed/running-left", count: 1 },
      mouseInteract: { frames: "transformed/interact", count: 1 },
    },
    transitions: {
      toTransformed: { frames: "transitions/to-transformed", count: 1 },
      toNormal: { frames: "transitions/to-normal", count: 1 },
    },
  });

  try {
    const imported = importGeneratedPetPack(source, {
      storageRoot: storage,
      builtinRoots: [builtIn],
    });

    assert.equal(imported.id, "shared-pet-2");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("reads an existing dual-state pack without changing its behavior", () => {
  const temporary = makeTemporaryDirectory();
  const root = path.join(temporary, "dual-state-pack");
  const normalEntries = {
    idle: { frames: "normal/idle", count: 1 },
    runningRight: { frames: "normal/running-right", count: 1 },
    runningLeft: { frames: "normal/running-left", count: 1 },
    mouseWave: { frames: "normal/interact-wave", count: 1 },
  };
  const transformedEntries = {
    taskActive: { frames: "transformed/task-active", count: 1 },
    waiting: { frames: "transformed/waiting", count: 1 },
    review: { frames: "transformed/review", count: 1 },
    failed: { frames: "transformed/failed", count: 1 },
    runningRight: { frames: "transformed/running-right", count: 1 },
    runningLeft: { frames: "transformed/running-left", count: 1 },
    mouseInteract: { frames: "transformed/interact", count: 1 },
  };
  writeJson(path.join(root, "manifest.json"), {
    petId: "dual-pet",
    displayName: "双形态",
    normal: normalEntries,
    transformed: transformedEntries,
    transitions: {
      toTransformed: { frames: "transitions/to-transformed", count: 1 },
      toNormal: { frames: "transitions/to-normal", count: 1 },
    },
  });

  try {
    const pack = loadPetPack(root);
    assert.equal(pack.manifest.rendererMode, "dual");
    assert.equal(pack.manifest.normal.idle.frames, "normal/idle");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
