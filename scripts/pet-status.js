const fs = require("fs");
const os = require("os");
const path = require("path");

const state = process.argv[2];
const validStates = new Set(["auto", "rest", "running", "waiting", "review", "failed"]);
if (!validStates.has(state)) {
  console.error("Usage: npm run status -- <auto|rest|running|waiting|review|failed>");
  process.exit(1);
}

const { defaultPackRoots, loadPetCatalog, petStorageRoot } = require("../src/pet-pack");

const catalog = loadPetCatalog({
  storageRoot: petStorageRoot(),
  builtinRoots: defaultPackRoots({ homeDirectory: os.homedir() }),
});
const packRoot = catalog.active.root;
const stateFile = path.join(packRoot, "external-renderer-state.json");
fs.writeFileSync(stateFile, `${JSON.stringify({ state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`Set ${catalog.active.displayName} state to ${state}.`);
