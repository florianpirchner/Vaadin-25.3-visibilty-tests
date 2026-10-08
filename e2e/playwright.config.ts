import { defineConfig } from "@playwright/test";

// The app is started outside (see ../run-matrix.sh), one Vaadin version at a time.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    browserName: "chromium",
    headless: true,
  },
});
