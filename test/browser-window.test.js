const test = require("node:test");
const assert = require("node:assert/strict");
const { focusHarnessWindow, isHarnessWindowTitle } = require("../src/browser-window");

test("recognizes browser windows containing the Harness title", () => {
  assert.equal(isHarnessWindowTitle("增加 DeepSeekHarness 监听支持 - DeepSeek Harness - Microsoft Edge"), true);
  assert.equal(isHarnessWindowTitle("DeepSeek Harness - Google Chrome"), true);
  assert.equal(isHarnessWindowTitle("Codex - Microsoft Edge"), false);
  assert.equal(isHarnessWindowTitle(null), false);
});

test("reports when the Harness browser window is activated", async () => {
  const result = await focusHarnessWindow({
    execFileImpl: (_file, _args, callback) => callback(null),
  });

  assert.deepEqual(result, process.platform === "win32"
    ? { found: true, focused: true }
    : { found: false, focused: false });
});

test("keeps an existing Harness window from opening a fallback browser", async () => {
  const error = new Error("foreground rejected");
  error.code = 2;
  const result = await focusHarnessWindow({
    execFileImpl: (_file, _args, callback) => callback(error),
  });

  assert.deepEqual(result, process.platform === "win32"
    ? { found: true, focused: false }
    : { found: false, focused: false });
});

test("reports when no Harness browser window exists", async () => {
  const result = await focusHarnessWindow({
    execFileImpl: (_file, _args, callback) => callback(new Error("not found")),
  });

  assert.deepEqual(result, { found: false, focused: false });
});
