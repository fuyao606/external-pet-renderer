const PET_STATES = new Set(["rest", "running", "waiting", "review", "failed"]);

function knownState(state) {
  return PET_STATES.has(state) ? state : "rest";
}

function resolvePetState({ activeTasks, autoMonitoring, monitorState, manualState }) {
  if (Array.isArray(activeTasks) && activeTasks.length > 0) {
    return "running";
  }
  return autoMonitoring ? knownState(monitorState) : knownState(manualState);
}

module.exports = {
  resolvePetState,
};
