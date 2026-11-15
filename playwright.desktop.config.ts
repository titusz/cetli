/**
 * Playwright configuration for tests against the real desktop app: the Tauri
 * binary is launched with WebView2 remote debugging enabled and Playwright
 * attaches over CDP (Windows only). The start-up check (startup.spec.ts) runs
 * on every system. Build first (separate "org.cetli.dev" identifier, so an
 * installed Cetli is never touched):
 * npx tauri build --debug --no-bundle --config src-tauri/tauri.dev.conf.json
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/desktop",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
});
