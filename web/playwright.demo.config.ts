import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./demo-tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1440, height: 1000 },
    video: { mode: "on", size: { width: 1440, height: 1000 } },
  },
  outputDir: "demo-test-results",
  webServer: {
    command:
      "../.venv/bin/python -m http.server 4174 --bind 127.0.0.1 --directory dist-recorded",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
