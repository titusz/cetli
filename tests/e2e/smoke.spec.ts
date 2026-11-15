/** Smoke test: the app boots in the browser build and renders the sample document. */
import { expect, test } from "@playwright/test";

test("boots and shows the sample document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("Inbox:");
  await page.screenshot({ path: "test-results/smoke.png" });
  expect(errors).toEqual([]);
});
