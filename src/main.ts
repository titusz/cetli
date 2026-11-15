/**
 * Cetli frontend entry point: picks the platform (Tauri desktop or plain
 * browser) and starts either the main app or the quick log window.
 */

import "./styles/app.css";
import { App } from "./app/app";
import { createWebPlatform } from "./platform/web";
import { captureDiagnostics } from "./app/debuglog";

/** True when running inside the Tauri desktop shell. */
function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function main(): Promise<void> {
  captureDiagnostics();
  const params = new URLSearchParams(location.search);
  if (isTauri() && params.get("window") === "quicklog") {
    const { runQuickLogWindow } = await import("./app/quicklog");
    await runQuickLogWindow();
    return;
  }
  const platform = isTauri() ? (await import("./platform/tauri")).createTauriPlatform() : createWebPlatform();
  const app = new App(platform);
  (window as unknown as { cetli: App }).cetli = app;
  await app.init();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend", `<pre class="fatal">Cetli failed to start:\n${String(err?.stack ?? err)}</pre>`);
});
