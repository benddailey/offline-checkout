import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";

// Separate single-file build of the QR test harness; keeps dist/ at exactly one file.
export default defineConfig({
  root: "e2e/fixtures",
  plugins: lazyPlugins(() => [vue(), viteSingleFile()]),
  build: {
    outDir: "../../dist-harness",
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    rollupOptions: { input: "e2e/fixtures/qr-harness.html" },
  },
});
