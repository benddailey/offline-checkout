import { defineConfig } from "@playwright/test";
import { CHROMIUM_ARGS, HEADLESS } from "./e2e/helpers/app";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    headless: HEADLESS,
    browserName: "chromium",
    launchOptions: { args: CHROMIUM_ARGS },
  },
});
