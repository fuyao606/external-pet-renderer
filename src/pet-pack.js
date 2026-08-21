const fs = require("fs");
const os = require("os");
const path = require("path");

const REGISTRY_FILE = "registry.json";
const RUNTIME_MANIFEST_FILE = "external-renderer-pack.json";
const CODEX_PET_METADATA_FILE = "pet.json";
const PACKS_DIRECTORY = "packs";
const REGISTRY_VERSION = 1;
const DEFAULT_CELL_SIZE = { width: 192, height: 208 };
const CODEX_SPRITESHEET_COLUMNS = 8;
const CODEX_SPRITESHEET_ROW_COUNTS = new Set([9, 11]);
const CODEX_SPRITESHEET_EXTENSIONS = new Set([".png", ".webp"]);
const CODEX_ANIMATION_ROWS = {
  idle: { row: 0, count: 6 },
  runningRight: { row: 1, count: 8 },
  runningLeft: { row: 2, count: 8 },
  mouseWave: { row: 3, count: 4, loop: false },
  failed: { row: 5, count: 8, loop: false },
  waiting: { row: 6, count: 6 },
  running: { row: 7, count: 6 },
  review: { row: 8, count: 6 },
};
const GENERATED_ROW_NAMES = new Set([
  "idle",
  "running",
  "running-left",
  "running-right",
  "waving",
  "jumping",
  "waiting",
  "review",
  "failed",
]);
const GENERATED_ROOT_SEARCH_ANCESTORS = 2;

function petStorageRoot(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".codex", "external-pet-renderer");
}

function defaultPackRoots({
  homeDirectory = os.homedir(),
  environment = process.env,
  bundledPackRoot = process.resourcesPath ? path.join(process.resourcesPath, "default-pet") : null,
} = {}) {
  return [
    environment.EXTERNAL_PET_PACK,
    bundledPackRoot,
    path.resolve(__dirname, "..", "resources", "default-pet"),
  ].filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${description}: ${error.message}`);
  }
}

function safePetId(value, fallback = "imported-pet") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function safeDisplayName(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  const normalized = value.replace(/\\/g, "/");
  return !normalized.startsWith("/")
    && !normalized.startsWith("../")
    && !normalized.includes("/../")
    && !path.win32.isAbsolute(value)
    && !path.posix.isAbsolute(normalized);
}

function normalizeSafeRelativePath(value) {
  if (!isSafeRelativePath(value)) {
    return null;
  }
  return value.replace(/\\/g, "/");
}

function pathForRelativeFile(root, relativePath) {
  const normalized = normalizeSafeRelativePath(relativePath);
  if (!normalized) {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...normalized.split("/"));
  return candidate.startsWith(`${resolvedRoot}${path.sep}`) ? candidate : null;
}

function isCodexSpriteSheetPath(value) {
  const normalized = normalizeSafeRelativePath(value);
  return Boolean(normalized) && CODEX_SPRITESHEET_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function isSpriteSheetFrameEntry(entry) {
  return isPlainObject(entry) && entry.spritesheet !== undefined;
}

function validateSpriteSheetFrameEntry(entry, description) {
  if (!isPlainObject(entry)
    || !isCodexSpriteSheetPath(entry.spritesheet)
    || !Number.isInteger(entry.row)
    || entry.row < 0
    || entry.row > 10
    || entry.columns !== CODEX_SPRITESHEET_COLUMNS
    || !Number.isInteger(entry.count)
    || entry.count < 1
    || entry.count > CODEX_SPRITESHEET_COLUMNS) {
    throw new Error(`${description} is not a valid spritesheet animation entry.`);
  }
}

function validateFrameEntry(entry, description) {
  if (isSpriteSheetFrameEntry(entry)) {
    validateSpriteSheetFrameEntry(entry, description);
    return;
  }
  if (!isPlainObject(entry)
    || !isSafeRelativePath(entry.frames)
    || !Number.isInteger(entry.count)
    || entry.count < 1) {
    throw new Error(`${description} is not a valid animation entry.`);
  }
  if (entry.files !== undefined && (!Array.isArray(entry.files)
    || entry.files.length !== entry.count
    || entry.files.some((file) => typeof file !== "string" || path.basename(file) !== file))) {
    throw new Error(`${description} has invalid frame file names.`);
  }
}

function validateDualStateManifest(manifest) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.normal)
    || !isPlainObject(manifest.transformed) || !isPlainObject(manifest.transitions)) {
    throw new Error("The dual-state pack manifest has an unsupported structure.");
  }
  const requiredEntries = [
    [manifest.normal.idle, "normal.idle"],
    [manifest.normal.runningRight, "normal.runningRight"],
    [manifest.normal.runningLeft, "normal.runningLeft"],
    [manifest.normal.mouseWave, "normal.mouseWave"],
    [manifest.transformed.taskActive, "transformed.taskActive"],
    [manifest.transformed.waiting, "transformed.waiting"],
    [manifest.transformed.review, "transformed.review"],
    [manifest.transformed.failed, "transformed.failed"],
    [manifest.transformed.runningRight, "transformed.runningRight"],
    [manifest.transformed.runningLeft, "transformed.runningLeft"],
    [manifest.transformed.mouseInteract, "transformed.mouseInteract"],
    [manifest.transitions.toTransformed, "transitions.toTransformed"],
    [manifest.transitions.toNormal, "transitions.toNormal"],
  ];
  requiredEntries.forEach(([entry, name]) => validateFrameEntry(entry, name));
  return {
    ...manifest,
    rendererMode: "dual",
    petId: safePetId(manifest.petId, "dual-state-pet"),
    displayName: safeDisplayName(manifest.displayName, safePetId(manifest.petId, "桌宠")),
    cellSize: normalizeCellSize(manifest.cellSize),
  };
}

function normalizeCellSize(value) {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16
    || width > 2048 || height > 2048) {
    return { ...DEFAULT_CELL_SIZE };
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function frameFilesForRow(root, state) {
  if (!GENERATED_ROW_NAMES.has(state)) {
    return [];
  }
  const directory = path.join(root, "frames", state);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".png")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function entryFromGeneratedRow(root, rowsByState, state, { loop = true, fallback } = {}) {
  const row = rowsByState.get(state);
  if (!row) {
    return fallback;
  }
  const files = frameFilesForRow(root, state);
  if (files.length === 0) {
    throw new Error(`The imported pack is missing PNG frames for '${state}'.`);
  }
  if (Array.isArray(row.frames) && row.frames.length > 0 && row.frames.length !== files.length) {
    throw new Error(`The imported pack has an inconsistent frame count for '${state}'.`);
  }
  return {
    frames: `frames/${state}`,
    files,
    count: files.length,
    loop,
  };
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function hasGeneratedPackFiles(root) {
  return isDirectory(root)
    && fs.existsSync(path.join(root, "pet_request.json"))
    && fs.existsSync(path.join(root, "frames", "frames-manifest.json"));
}

function codexSpriteSheetPath(root, metadata) {
  const relativePath = normalizeSafeRelativePath(metadata?.spritesheetPath);
  if (!relativePath || !isCodexSpriteSheetPath(relativePath)) {
    return null;
  }
  return pathForRelativeFile(root, relativePath);
}

function hasCodexSpriteSheetPackFiles(root) {
  if (!isDirectory(root)) {
    return false;
  }
  const metadataPath = path.join(root, CODEX_PET_METADATA_FILE);
  if (!fs.existsSync(metadataPath)) {
    return false;
  }
  try {
    const metadata = readJson(metadataPath, CODEX_PET_METADATA_FILE);
    const spriteSheetPath = codexSpriteSheetPath(root, metadata);
    return Boolean(spriteSheetPath && fs.existsSync(spriteSheetPath));
  } catch {
    return false;
  }
}

function supportedImportPackFormat(root) {
  if (hasGeneratedPackFiles(root)) {
    return "generated-v2-run";
  }
  if (hasCodexSpriteSheetPackFiles(root)) {
    return "codex-spritesheet";
  }
  return null;
}

function unsupportedGeneratedPackError(selectedRoot, candidates = []) {
  if (candidates.length > 1) {
    return new Error(
      `Multiple supported desk-pet folders were found below '${selectedRoot}': ${candidates.join(", ")}. Select one folder directly.`,
    );
  }
  return new Error(
    `Could not find a supported desk-pet folder from '${selectedRoot}'. Expected pet_request.json with frames/frames-manifest.json, or pet.json with a PNG/WebP spritesheet.`,
  );
}

/**
 * Resolve a user-selected folder to an importable pack root.
 * The folder picker may return the pack itself, its parent, or a frames child.
 * Search is deliberately shallow so QA/output copies are not picked by accident.
 */
function resolveGeneratedPetRoot(inputRoot) {
  if (typeof inputRoot !== "string" || inputRoot.trim() === "") {
    throw new Error("A desk-pet folder must be selected before importing.");
  }
  const selectedRoot = path.resolve(inputRoot);
  if (supportedImportPackFormat(selectedRoot)) {
    return selectedRoot;
  }

  const childCandidates = [];
  if (isDirectory(selectedRoot)) {
    try {
      for (const entry of fs.readdirSync(selectedRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidate = path.join(selectedRoot, entry.name);
        if (supportedImportPackFormat(candidate)) {
          childCandidates.push(candidate);
        }
      }
    } catch {
      // The final error below includes the selected path and expected files.
    }
  }
  if (childCandidates.length > 0) {
    childCandidates.sort((left, right) => left.localeCompare(right));
    if (childCandidates.length === 1) {
      return childCandidates[0];
    }
    throw unsupportedGeneratedPackError(selectedRoot, childCandidates);
  }

  let ancestor = selectedRoot;
  for (let depth = 1; depth <= GENERATED_ROOT_SEARCH_ANCESTORS; depth += 1) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      break;
    }
    ancestor = parent;
    if (supportedImportPackFormat(ancestor)) {
      return ancestor;
    }
  }

  throw unsupportedGeneratedPackError(selectedRoot);
}

function buildGeneratedPackManifest(root) {
  const requestPath = path.join(root, "pet_request.json");
  const frameManifestPath = path.join(root, "frames", "frames-manifest.json");
  if (!fs.existsSync(requestPath) || !fs.existsSync(frameManifestPath)) {
    throw new Error("This folder is not a supported v2 desk-pet run. Expected pet_request.json and frames/frames-manifest.json.");
  }

  const request = readJson(requestPath, "pet_request.json");
  const frameManifest = readJson(frameManifestPath, "frames/frames-manifest.json");
  if (!isPlainObject(request) || !Array.isArray(frameManifest?.rows)) {
    throw new Error("This desk-pet run has an invalid metadata file.");
  }

  const rowsByState = new Map();
  for (const row of frameManifest.rows) {
    if (isPlainObject(row) && GENERATED_ROW_NAMES.has(row.state) && !rowsByState.has(row.state)) {
      rowsByState.set(row.state, row);
    }
  }

  const idle = entryFromGeneratedRow(root, rowsByState, "idle");
  if (!idle) {
    throw new Error("The imported pack must include an 'idle' animation.");
  }
  const runningRight = entryFromGeneratedRow(root, rowsByState, "running-right", { fallback: idle });
  const runningLeft = entryFromGeneratedRow(root, rowsByState, "running-left", { fallback: runningRight });
  const waving = entryFromGeneratedRow(root, rowsByState, "waving", { loop: false, fallback: idle });
  const running = entryFromGeneratedRow(root, rowsByState, "running", { fallback: idle });
  const waiting = entryFromGeneratedRow(root, rowsByState, "waiting", { fallback: idle });
  const review = entryFromGeneratedRow(root, rowsByState, "review", { fallback: idle });
  const failed = entryFromGeneratedRow(root, rowsByState, "failed", { loop: false, fallback: idle });
  const requestedSize = request.atlas
    ? { width: request.atlas.cell_width, height: request.atlas.cell_height }
    : undefined;
  const petId = safePetId(request.pet_id, path.basename(root));

  return {
    schemaVersion: 1,
    sourceFormat: "generated-v2-run",
    rendererMode: "single",
    petId,
    displayName: safeDisplayName(request.display_name, petId),
    description: typeof request.description === "string" ? request.description : "",
    cellSize: normalizeCellSize(requestedSize),
    normal: {
      idle,
      runningRight,
      runningLeft,
      mouseWave: waving,
    },
    stateEntries: {
      running,
      waiting,
      review,
      failed,
    },
  };
}

function readSpriteSheetDimensions(filePath) {
  const header = Buffer.alloc(64 * 1024);
  let descriptor;
  let bytesRead;
  try {
    descriptor = fs.openSync(filePath, "r");
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } catch (error) {
    throw new Error(`Could not read the Codex spritesheet: ${error.message}`);
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
  const bytes = header.subarray(0, bytesRead);
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.length >= 24 && bytes.subarray(0, 8).toString("hex") === pngSignature) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("The Codex spritesheet must be a readable PNG or WebP image.");
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunk === "VP8X" && chunkSize >= 10 && dataOffset + 10 <= bytes.length) {
      return {
        width: 1 + bytes[dataOffset + 4] + (bytes[dataOffset + 5] << 8) + (bytes[dataOffset + 6] << 16),
        height: 1 + bytes[dataOffset + 7] + (bytes[dataOffset + 8] << 8) + (bytes[dataOffset + 9] << 16),
      };
    }
    if (chunk === "VP8 " && chunkSize >= 10 && dataOffset + 10 <= bytes.length
      && bytes[dataOffset + 3] === 0x9d && bytes[dataOffset + 4] === 0x01 && bytes[dataOffset + 5] === 0x2a) {
      return {
        width: (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff,
        height: (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && chunkSize >= 5 && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2f) {
      const packedSize = (bytes[dataOffset + 1]
        | (bytes[dataOffset + 2] << 8)
        | (bytes[dataOffset + 3] << 16)
        | (bytes[dataOffset + 4] << 24)) >>> 0;
      return {
        width: (packedSize & 0x3fff) + 1,
        height: ((packedSize >>> 14) & 0x3fff) + 1,
      };
    }
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > bytes.length) {
      break;
    }
    offset = nextOffset;
  }
  throw new Error("The Codex spritesheet must be a readable PNG or WebP image.");
}

function spriteSheetAnimationEntry(spritesheet, row, count, loop = true) {
  return {
    spritesheet,
    row,
    columns: CODEX_SPRITESHEET_COLUMNS,
    count,
    loop,
  };
}

function buildCodexSpriteSheetPackManifest(root) {
  const metadataPath = path.join(root, CODEX_PET_METADATA_FILE);
  const metadata = readJson(metadataPath, CODEX_PET_METADATA_FILE);
  if (!isPlainObject(metadata)) {
    throw new Error("The Codex pet.json file has an invalid structure.");
  }
  const spritesheet = normalizeSafeRelativePath(metadata.spritesheetPath);
  const spritesheetPath = codexSpriteSheetPath(root, metadata);
  if (!spritesheet || !spritesheetPath) {
    throw new Error("The Codex pet.json file must reference a relative PNG or WebP spritesheet.");
  }
  if (!fs.existsSync(spritesheetPath) || !fs.statSync(spritesheetPath).isFile()) {
    throw new Error(`The Codex spritesheet '${spritesheet}' does not exist.`);
  }

  const dimensions = readSpriteSheetDimensions(spritesheetPath);
  const rowCount = dimensions.height / DEFAULT_CELL_SIZE.height;
  if (dimensions.width !== DEFAULT_CELL_SIZE.width * CODEX_SPRITESHEET_COLUMNS
    || !Number.isInteger(rowCount)
    || !CODEX_SPRITESHEET_ROW_COUNTS.has(rowCount)) {
    throw new Error(
      "The Codex spritesheet must be an 8x9 or 8x11 atlas using 192x208 pixel cells.",
    );
  }
  const spriteVersionNumber = metadata.spriteVersionNumber;
  if (spriteVersionNumber !== undefined && spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
    throw new Error("The Codex pet.json spriteVersionNumber must be 1 or 2.");
  }
  if (spriteVersionNumber === 1 && rowCount !== 9) {
    throw new Error("A Codex v1 pet must use an 8x9 spritesheet atlas.");
  }
  if (spriteVersionNumber === 2 && rowCount !== 11) {
    throw new Error("A Codex v2 pet must use an 8x11 spritesheet atlas.");
  }

  const petId = safePetId(metadata.id, path.basename(root));
  const entry = (name) => {
    const animation = CODEX_ANIMATION_ROWS[name];
    return spriteSheetAnimationEntry(spritesheet, animation.row, animation.count, animation.loop !== false);
  };
  return {
    schemaVersion: 1,
    sourceFormat: "codex-spritesheet",
    rendererMode: "single",
    spriteVersionNumber: spriteVersionNumber ?? (rowCount === 11 ? 2 : 1),
    petId,
    displayName: safeDisplayName(metadata.displayName, petId),
    description: typeof metadata.description === "string" ? metadata.description : "",
    cellSize: { ...DEFAULT_CELL_SIZE },
    normal: {
      idle: entry("idle"),
      runningRight: entry("runningRight"),
      runningLeft: entry("runningLeft"),
      mouseWave: entry("mouseWave"),
    },
    stateEntries: {
      running: entry("running"),
      waiting: entry("waiting"),
      review: entry("review"),
      failed: entry("failed"),
    },
  };
}

function readRuntimeManifest(root) {
  const runtimeManifestPath = path.join(root, RUNTIME_MANIFEST_FILE);
  if (fs.existsSync(runtimeManifestPath)) {
    const manifest = readJson(runtimeManifestPath, RUNTIME_MANIFEST_FILE);
    if (manifest?.rendererMode !== "single") {
      throw new Error("The imported desk-pet runtime manifest is not supported.");
    }
    validateFrameEntry(manifest?.normal?.idle, "normal.idle");
    validateFrameEntry(manifest?.normal?.runningRight, "normal.runningRight");
    validateFrameEntry(manifest?.normal?.runningLeft, "normal.runningLeft");
    validateFrameEntry(manifest?.normal?.mouseWave, "normal.mouseWave");
    ["running", "waiting", "review", "failed"].forEach((state) => {
      validateFrameEntry(manifest?.stateEntries?.[state], `stateEntries.${state}`);
    });
    return {
      ...manifest,
      petId: safePetId(manifest.petId, "imported-pet"),
      displayName: safeDisplayName(manifest.displayName, safePetId(manifest.petId, "桌宠")),
      cellSize: normalizeCellSize(manifest.cellSize),
    };
  }
  return null;
}

function buildImportPackManifest(root) {
  if (hasGeneratedPackFiles(root)) {
    return buildGeneratedPackManifest(root);
  }
  if (fs.existsSync(path.join(root, CODEX_PET_METADATA_FILE))) {
    return buildCodexSpriteSheetPackManifest(root);
  }
  throw new Error(
    "This folder is not a supported desk-pet pack. Expected pet_request.json with frames/frames-manifest.json, or pet.json with a PNG/WebP spritesheet.",
  );
}

function loadPetPack(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Desk-pet folder does not exist: ${resolvedRoot}`);
  }

  const runtimeManifest = readRuntimeManifest(resolvedRoot);
  let manifest = runtimeManifest;
  if (!manifest) {
    const dualStatePath = path.join(resolvedRoot, "manifest.json");
    if (fs.existsSync(dualStatePath)) {
      manifest = validateDualStateManifest(readJson(dualStatePath, "manifest.json"));
    } else {
      manifest = buildImportPackManifest(resolvedRoot);
    }
  }

  return {
    id: manifest.petId,
    displayName: manifest.displayName,
    root: resolvedRoot,
    manifest,
    stateFile: path.join(resolvedRoot, "external-renderer-state.json"),
  };
}

function emptyRegistry() {
  return {
    schemaVersion: REGISTRY_VERSION,
    activePetId: null,
    importedPacks: [],
  };
}

function registryPath(storageRoot) {
  return path.join(storageRoot, REGISTRY_FILE);
}

function readPetRegistry(storageRoot) {
  const filePath = registryPath(storageRoot);
  if (!fs.existsSync(filePath)) {
    return emptyRegistry();
  }
  const registry = readJson(filePath, "desk-pet registry");
  if (!isPlainObject(registry) || !Array.isArray(registry.importedPacks)) {
    throw new Error("The desk-pet registry has an unsupported format.");
  }
  return {
    schemaVersion: REGISTRY_VERSION,
    activePetId: typeof registry.activePetId === "string" ? registry.activePetId : null,
    importedPacks: registry.importedPacks.filter((pack) => isPlainObject(pack)),
  };
}

function writePetRegistry(storageRoot, registry) {
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.writeFileSync(registryPath(storageRoot), `${JSON.stringify(registry, null, 2)}\n`);
}

function importedPackRoot(storageRoot, directory) {
  const packRoot = path.resolve(storageRoot, PACKS_DIRECTORY);
  const candidate = path.resolve(packRoot, directory);
  if (candidate !== packRoot && !candidate.startsWith(`${packRoot}${path.sep}`)) {
    return null;
  }
  return candidate;
}

function catalogRecord(pack, origin) {
  return {
    ...pack,
    origin,
  };
}

function loadPetCatalog({ storageRoot = petStorageRoot(), builtinRoots = defaultPackRoots() } = {}) {
  const registry = readPetRegistry(storageRoot);
  const packs = [];
  const warnings = [];
  const ids = new Set();

  for (const root of builtinRoots) {
    try {
      const pack = loadPetPack(root);
      if (!ids.has(pack.id)) {
        packs.push(catalogRecord(pack, "built-in"));
        ids.add(pack.id);
      }
    } catch (error) {
      if (fs.existsSync(root)) {
        warnings.push(error.message);
      }
    }
  }

  for (const record of registry.importedPacks) {
    const directory = typeof record.directory === "string" ? record.directory : "";
    const root = importedPackRoot(storageRoot, directory);
    if (!root) {
      warnings.push("Ignored an imported desk-pet registry entry outside the managed packs directory.");
      continue;
    }
    try {
      const pack = loadPetPack(root);
      if (!ids.has(pack.id)) {
        packs.push(catalogRecord(pack, "imported"));
        ids.add(pack.id);
      }
    } catch (error) {
      warnings.push(error.message);
    }
  }

  if (packs.length === 0) {
    throw new Error("Could not find a desk-pet pack. Import a supported folder or set EXTERNAL_PET_PACK.");
  }
  const active = packs.find((pack) => pack.id === registry.activePetId) ?? packs[0];
  return { active, packs, registry, warnings };
}

function uniquePetId(preferredId, usedIds) {
  const base = safePetId(preferredId);
  if (!usedIds.has(base)) {
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function replaceManifestIdentity(manifest, id) {
  return {
    ...manifest,
    petId: id,
  };
}

function copyGeneratedPackAssets(source, destination) {
  fs.cpSync(path.join(source, "frames"), path.join(destination, "frames"), {
    recursive: true,
    dereference: true,
    errorOnExist: true,
  });
  fs.copyFileSync(path.join(source, "pet_request.json"), path.join(destination, "pet_request.json"));
}

function copyCodexSpriteSheetPackAssets(source, destination) {
  const metadataPath = path.join(source, CODEX_PET_METADATA_FILE);
  const metadata = readJson(metadataPath, CODEX_PET_METADATA_FILE);
  const spritesheet = normalizeSafeRelativePath(metadata?.spritesheetPath);
  const sourceSheet = codexSpriteSheetPath(source, metadata);
  const destinationSheet = spritesheet ? pathForRelativeFile(destination, spritesheet) : null;
  if (!spritesheet || !sourceSheet || !destinationSheet) {
    throw new Error("The Codex pet.json file must reference a relative PNG or WebP spritesheet.");
  }
  fs.mkdirSync(path.dirname(destinationSheet), { recursive: true });
  fs.copyFileSync(metadataPath, path.join(destination, CODEX_PET_METADATA_FILE));
  fs.copyFileSync(sourceSheet, destinationSheet);
}

function importGeneratedPetPack(
  sourceRoot,
  { storageRoot = petStorageRoot(), builtinRoots = defaultPackRoots() } = {},
) {
  const source = resolveGeneratedPetRoot(sourceRoot);
  const sourceManifest = buildImportPackManifest(source);
  const registry = readPetRegistry(storageRoot);
  const usedIds = new Set(registry.importedPacks
    .map((record) => typeof record.id === "string" ? record.id : null)
    .filter(Boolean));
  for (const root of builtinRoots) {
    try {
      usedIds.add(loadPetPack(root).id);
    } catch {
      // A missing optional built-in pack must not prevent importing another pet.
    }
  }
  const id = uniquePetId(sourceManifest.petId, usedIds);
  const packsRoot = path.join(storageRoot, PACKS_DIRECTORY);
  const destination = path.join(packsRoot, id);
  const temporaryDestination = path.join(
    packsRoot,
    `${id}.importing-${process.pid}-${Date.now()}`,
  );

  fs.mkdirSync(packsRoot, { recursive: true });
  if (fs.existsSync(destination)) {
    throw new Error(`The managed desk-pet folder '${id}' already exists. Please import again after removing the conflicting pack.`);
  }
  try {
    fs.mkdirSync(temporaryDestination, { recursive: true });
    if (sourceManifest.sourceFormat === "codex-spritesheet") {
      copyCodexSpriteSheetPackAssets(source, temporaryDestination);
    } else {
      copyGeneratedPackAssets(source, temporaryDestination);
    }
    const manifest = replaceManifestIdentity(buildImportPackManifest(temporaryDestination), id);
    fs.writeFileSync(
      path.join(temporaryDestination, RUNTIME_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    fs.renameSync(temporaryDestination, destination);
  } catch (error) {
    fs.rmSync(temporaryDestination, { recursive: true, force: true });
    throw error;
  }

  const nextRegistry = {
    ...registry,
    activePetId: id,
    importedPacks: [
      ...registry.importedPacks,
      {
        id,
        directory: id,
        displayName: sourceManifest.displayName,
        importedAt: new Date().toISOString(),
      },
    ],
  };
  writePetRegistry(storageRoot, nextRegistry);
  try {
    return loadPetPack(destination);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function setActivePetPack(id, { storageRoot = petStorageRoot(), builtinRoots = defaultPackRoots() } = {}) {
  const catalog = loadPetCatalog({ storageRoot, builtinRoots });
  const selected = catalog.packs.find((pack) => pack.id === id);
  if (!selected) {
    throw new Error(`Desk-pet '${id}' is not available.`);
  }
  writePetRegistry(storageRoot, {
    ...catalog.registry,
    activePetId: selected.id,
  });
  return selected;
}

module.exports = {
  RUNTIME_MANIFEST_FILE,
  buildCodexSpriteSheetPackManifest,
  buildGeneratedPackManifest,
  defaultPackRoots,
  importGeneratedPetPack,
  loadPetCatalog,
  loadPetPack,
  petStorageRoot,
  readPetRegistry,
  resolveGeneratedPetRoot,
  setActivePetPack,
};
