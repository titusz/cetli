/** Vite build/dev configuration for the Cetli frontend; also hosts the Vitest config. */
import { defineConfig } from "vitest/config";

const DEV_PORT = 45834; // derived from crc32("cetli") to avoid clashes with other projects

export default defineConfig({
  clearScreen: false,
  server: { port: DEV_PORT, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
