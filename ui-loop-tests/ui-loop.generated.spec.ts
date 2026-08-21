import { expect, test } from "@playwright/test";

test.describe("ui-loop generated web checks", () => {
  test("Open route /src/renderer", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "ui-loop-quality", description: "smoke" });
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/src/renderer", { waitUntil: "domcontentloaded", timeout: 8000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: testInfo.outputPath("route-src-renderer.png"), fullPage: true });
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("Click 查看进行中的 Codex 任务 on /src/renderer", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "ui-loop-quality", description: "interaction" });
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/src/renderer", { waitUntil: "domcontentloaded", timeout: 8000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    const uiLoopControl = page.locator("[aria-label=\"查看进行中的 Codex 任务\"]").first();
    await expect(uiLoopControl).toBeVisible({ timeout: 3000 });
    await expect(uiLoopControl).toBeEnabled({ timeout: 3000 });
    await uiLoopControl.click({ timeout: 3000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: testInfo.outputPath("click-src-renderer-查看进行中的-Codex-任务.png"), fullPage: true });
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("Open route /src/renderer/task-panel", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "ui-loop-quality", description: "smoke" });
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/src/renderer/task-panel", { waitUntil: "domcontentloaded", timeout: 8000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: testInfo.outputPath("route-src-renderer-task-panel.png"), fullPage: true });
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("Click 关闭任务列表 on /src/renderer/task-panel", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "ui-loop-quality", description: "interaction" });
    const consoleErrors = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/src/renderer/task-panel", { waitUntil: "domcontentloaded", timeout: 8000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    const uiLoopControl = page.locator("[aria-label=\"关闭任务列表\"]").first();
    await expect(uiLoopControl).toBeVisible({ timeout: 3000 });
    await expect(uiLoopControl).toBeEnabled({ timeout: 3000 });
    await uiLoopControl.click({ timeout: 3000 });
    await expect(page.locator("body")).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: testInfo.outputPath("click-src-renderer-task-panel-关闭任务列表.png"), fullPage: true });
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
