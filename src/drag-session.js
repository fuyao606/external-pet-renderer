function isDragValue(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function startDragSession(dragId) {
  if (!isDragValue(dragId)) {
    return null;
  }
  return { id: dragId, lastSequence: -1 };
}

function acceptsDragUpdate(session, dragId, sequence) {
  if (!session) {
    return true;
  }
  if (!isDragValue(dragId) || !isDragValue(sequence)) {
    return false;
  }
  if (session.id !== dragId || sequence < session.lastSequence) {
    return false;
  }
  session.lastSequence = sequence;
  return true;
}

function isCurrentDragSession(session, dragId) {
  return !session || (isDragValue(dragId) && session.id === dragId);
}

module.exports = {
  acceptsDragUpdate,
  isCurrentDragSession,
  startDragSession,
};
