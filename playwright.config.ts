/**
 * Playwright end-to-end test configuration: runs the browser build in the two engines Cetli's webview uses,
 * Chromium (WebView2 on Windows; the installed Edge, or PW_CHANNEL=chrome|chromium) and WebKit (macOS and Linux;
 * install it once with `npx playwright install webkit`).
 */
import { defineConfig } from "@playwright/test";

const PORT = 45834;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1100, height: 760 },
  },
  projects: [
    { name: "chromium", use: { channel: process.env.PW_CHANNEL ?? "msedge" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "npx vite",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
