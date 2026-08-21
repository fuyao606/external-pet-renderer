function isScreenPoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y);
}

function isWindowPosition(value) {
  return Number.isSafeInteger(value?.x)
    && Number.isSafeInteger(value?.y)
    && value.x >= -(2 ** 31)
    && value.x < 2 ** 31
    && value.y >= -(2 ** 31)
    && value.y < 2 ** 31;
}

function createDragAnchor(bounds, point) {
  return {
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  };
}

function centerPointForBounds(bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function dragPositionFor(point, anchor) {
  return {
    x: Math.round(point.x - anchor.x),
    y: Math.round(point.y - anchor.y),
  };
}

module.exports = {
  centerPointForBounds,
  createDragAnchor,
  dragPositionFor,
  isScreenPoint,
  isWindowPosition,
};
