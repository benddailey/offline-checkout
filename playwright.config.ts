import { defineConfig } from "@playwright/test";
import { CHROMIUM_ARGS } from "./e2e/helpers/app";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    headless: false,
    browserName: "chromium",
    launchOptions: { args: CHROMIUM_ARGS },
  },
});
