function taskCountLabel(tasks) {
  const count = Array.isArray(tasks) ? tasks.length : 0;
  return count > 99 ? "99+" : String(count);
}

function createPanelHoverController(
  setHover,
  { setTimer = setTimeout, clearTimer = clearTimeout, leaveDelayMs = 80 } = {},
) {
  let hovering = false;
  let leaveTimer = null;

  const activate = (force = false) => {
    if (leaveTimer !== null) {
      clearTimer(leaveTimer);
      leaveTimer = null;
    }
    if (!hovering || force) {
      hovering = true;
      setHover(true);
    }
  };
  const deactivate = () => {
    if (!hovering || leaveTimer !== null) {
      return;
    }
    leaveTimer = setTimer(() => {
      leaveTimer = null;
      if (!hovering) {
        return;
      }
      hovering = false;
      setHover(false);
    }, leaveDelayMs);
  };
  const dispose = () => {
    if (leaveTimer !== null) {
      clearTimer(leaveTimer);
      leaveTimer = null;
    }
    if (hovering) {
      hovering = false;
      setHover(false);
    }
  };

  return { activate, deactivate, dispose };
}

function renderTasks(list, title, tasks) {
  const nextTasks = Array.isArray(tasks) ? tasks : [];
  title.textContent = `进行中的任务 (${taskCountLabel(nextTasks)})`;
  list.replaceChildren();
  if (nextTasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "task-empty";
    empty.textContent = "暂无进行中的任务";
    list.append(empty);
    return;
  }
  for (const task of nextTasks) {
    const row = document.createElement("button");
    row.className = "task-row";
    row.type = "button";
    row.setAttribute("role", "listitem");
    row.title = task.title;

    const indicator = document.createElement("span");
    indicator.className = "task-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "task-copy";
    const taskTitle = document.createElement("span");
    taskTitle.className = "task-title";
    taskTitle.textContent = task.title;
    const state = document.createElement("span");
    state.className = "task-state";
    state.textContent = "进行中";
    copy.append(taskTitle, state);
    row.append(indicator, copy);
    row.addEventListener("click", () => window.petBridge.openTask(task.id));
    list.append(row);
  }
}

async function start() {
  const list = document.getElementById("task-list");
  const title = document.getElementById("task-panel-title");
  const panel = document.querySelector(".task-panel");
  const panelHover = createPanelHoverController(
    (hovering) => window.petBridge.setTaskPanelHover(hovering),
  );
  document.getElementById("task-panel-close").addEventListener("click", () => window.petBridge.closeTaskPanel());
  panel.addEventListener("pointerenter", () => panelHover.activate(true));
  panel.addEventListener("pointermove", () => panelHover.activate());
  panel.addEventListener("pointerleave", () => panelHover.deactivate());
  window.addEventListener("beforeunload", () => panelHover.dispose());
  window.petBridge.onTasks((payload) => renderTasks(list, title, payload.tasks));
  const bootstrap = await window.petBridge.getTaskPanelBootstrap();
  renderTasks(list, title, bootstrap.tasks);
}

if (typeof window !== "undefined") {
  start().catch((error) => {
    console.error(error);
  });
}

if (typeof module !== "undefined") {
  module.exports = { createPanelHoverController, renderTasks, taskCountLabel };
}
