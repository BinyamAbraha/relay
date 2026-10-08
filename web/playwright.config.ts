import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8000",
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  webServer: {
    command:
      "cd .. && .venv/bin/python -m relay.cli --data-dir .relay/e2e serve --port 8000",
    url: "http://127.0.0.1:8000/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
