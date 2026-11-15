/** Playwright end-to-end test configuration: runs the browser build against the installed Edge/Chrome. */
import { defineConfig } from "@playwright/test";

const PORT = 45834;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1100, height: 760 },
  },
  webServer: {
    command: "npx vite",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
