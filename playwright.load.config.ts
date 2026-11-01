import { defineConfig } from "@playwright/test";
import { CHROMIUM_ARGS, HEADLESS } from "./e2e/helpers/app";

export default defineConfig({
  testDir: "load",
  testMatch: "*.load.ts",
  workers: 1,
  reporter: "list",
  use: {
    headless: HEADLESS,
    browserName: "chromium",
    launchOptions: { args: CHROMIUM_ARGS },
  },
});
