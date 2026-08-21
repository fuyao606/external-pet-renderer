const test = require("node:test");
const assert = require("node:assert/strict");
const { codexThreadUrl } = require("../src/codex-links");

test("builds a Codex task deep link from a thread id", () => {
  assert.equal(
    codexThreadUrl("11111111-2222-3333-4444-555555555555"),
    "codex://threads/11111111-2222-3333-4444-555555555555",
  );
  assert.equal(codexThreadUrl("thread / id"), "codex://threads/thread%20%2F%20id");
  assert.equal(codexThreadUrl(""), null);
  assert.equal(codexThreadUrl(null), null);
});
