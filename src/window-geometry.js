function clampWindowBounds(bounds, workArea) {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
  };
}

function resizeWindowBounds(bounds, width, height, workArea) {
  return clampWindowBounds({
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - height) / 2),
    width,
    height,
  }, workArea);
}

function taskPanelBoundsForAnchor(anchor, width, height, workArea, gap = 8) {
  const preferredBounds = {
    x: Math.round(anchor.right - width),
    y: Math.round(anchor.top - height - gap),
    width,
    height,
  };
  if (preferredBounds.y < workArea.y) {
    preferredBounds.y = Math.round(anchor.bottom + gap);
  }
  return clampWindowBounds(preferredBounds, workArea);
}

module.exports = {
  clampWindowBounds,
  resizeWindowBounds,
  taskPanelBoundsForAnchor,
};
