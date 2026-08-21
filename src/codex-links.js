function codexThreadUrl(threadId) {
  if (typeof threadId !== "string" || !threadId) {
    return null;
  }
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

module.exports = { codexThreadUrl };
